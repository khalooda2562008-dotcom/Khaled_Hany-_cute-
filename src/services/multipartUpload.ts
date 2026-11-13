import type { UploadPartRecord, UploadProgress, UploadResult, UploadSession, UploadStore } from '../types/upload';
import { uploadStore } from './uploadStore';

export interface UploadOptions {
  apiBase?: string;
  fetchImpl?: typeof fetch;
  store?: UploadStore;
  onProgress?: (progress: UploadProgress) => void;
  onSession?: (session: UploadSession) => void;
  signal?: AbortSignal;
  turnstileToken?: string | null;
  /** R2 requires at least 5 MiB per non-final part. */
  partSize?: number;
  retries?: number;
}

export class UploadError extends Error {
  status: number;
  retryable: boolean;

  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.retryable = retryable;
  }
}

interface CreateResponse {
  key: string;
  uploadId: string;
  partSize: number;
  maxPartBytes: number;
}

const MIN_PART = 5 * 1024 * 1024;

function sessionId(apiBase: string, file: File): string {
  return `upload:${apiBase}:${file.name}:${file.size}`;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  errorMessage: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new UploadError(`${errorMessage}: ${(error as Error).message}`, 0, true);
  }
  if (!response.ok) {
    const body = await readJson<{ error?: string }>(response);
    const retryable = response.status >= 500 || response.status === 429;
    throw new UploadError(body.error || `${errorMessage} (${response.status})`, response.status, retryable);
  }
  return readJson<T>(response);
}

function assertFile(file: File): void {
  if (!file.size) throw new UploadError('The selected file is empty.');
}

function partsFrom(session: UploadSession): Map<number, string> {
  return new Map(session.parts.map(part => [part.partNumber, part.etag]));
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadPart(
  fetchImpl: typeof fetch,
  apiBase: string,
  session: UploadSession,
  file: File,
  partNumber: number,
  partSize: number,
  retries: number,
  signal?: AbortSignal,
): Promise<UploadPartRecord> {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(file.size, start + partSize);
  const chunk = file.slice(start, end, 'application/octet-stream');
  const url = `${apiBase}/storage/multipart/part?key=${encodeURIComponent(session.key)}&uploadId=${encodeURIComponent(session.uploadId)}&part=${partNumber}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new UploadError('Upload cancelled.', 0, false);
    try {
      const response = await fetchImpl(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: chunk,
        signal,
      });
      if (!response.ok) {
        const body = await readJson<{ error?: string }>(response);
        const retryable = response.status >= 500 || response.status === 429;
        lastError = new UploadError(body.error || `Part ${partNumber} failed (${response.status})`, response.status, retryable);
        if (!retryable) throw lastError;
      } else {
        const result = await readJson<UploadPartRecord>(response);
        if (!result.etag) throw new UploadError(`Part ${partNumber} returned no ETag.`, 0, true);
        return { partNumber: result.partNumber ?? partNumber, etag: result.etag };
      }
    } catch (error) {
      if (error instanceof UploadError && !error.retryable) throw error;
      if (signal?.aborted) throw new UploadError('Upload cancelled.', 0, false);
      lastError = error;
    }
    if (attempt < retries) await sleep(600 * (attempt + 1));
  }
  throw lastError instanceof UploadError
    ? lastError
    : new UploadError(`Part ${partNumber} could not be uploaded: ${(lastError as Error)?.message ?? 'network error'}`, 0, true);
}

/**
 * Resumable multipart upload to the private R2 bucket.
 *
 * - 8 MiB parts by default, uploaded one at a time (mobile memory friendly).
 * - Each part ETag is persisted in IndexedDB, so a dropped connection or a
 *   closed tab can continue from the next missing part instead of starting over.
 * - The server never receives an R2 credential and the browser never sees the
 *   Access token beyond its own same-origin cookie.
 */
export async function uploadMedia(file: File, options: UploadOptions = {}): Promise<UploadResult> {
  assertFile(file);
  const apiBase = options.apiBase ?? '/api';
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = options.store ?? uploadStore;
  const retries = options.retries ?? 2;
  const id = sessionId(apiBase, file);
  let resumed = false;
  let session = await store.get(id);

  if (session && session.size !== file.size) {
    await store.delete(id);
    session = null;
  }

  if (session) {
    try {
      await requestJson<{ resumable: boolean }>(
        fetchImpl,
        `${apiBase}/storage/multipart/session?key=${encodeURIComponent(session.key)}&uploadId=${encodeURIComponent(session.uploadId)}`,
        { method: 'GET' },
        'Could not check the previous upload',
      );
      resumed = session.parts.length > 0;
    } catch (error) {
      const status = error instanceof UploadError ? error.status : 0;
      if (status === 401 || status === 403 || status === 404 || status === 410) {
        await store.delete(id);
        session = null;
      }
      // Network/server errors keep the session so the next attempt can resume it.
    }
  }

  if (!session) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.turnstileToken) headers['cf-turnstile-response'] = options.turnstileToken;
    const created = await requestJson<CreateResponse>(fetchImpl, `${apiBase}/storage/multipart/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: file.name, size: file.size, type: file.type || 'video/mp4' }),
      signal: options.signal,
    }, 'Could not start the upload');
    const partSize = Math.max(MIN_PART, options.partSize ?? created.partSize ?? MIN_PART);
    session = {
      id,
      key: created.key,
      uploadId: created.uploadId,
      name: file.name,
      size: file.size,
      type: file.type || 'video/mp4',
      partSize,
      parts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      apiBase,
    };
    await store.put(session);
    options.onSession?.(session);
  }

  const partSize = session.partSize || MIN_PART;
  const partsTotal = Math.max(1, Math.ceil(file.size / partSize));
  const uploaded = partsFrom(session);
  const report = () => {
    const bytes = [...uploaded.keys()].reduce((sum, partNumber) => {
      const start = (partNumber - 1) * partSize;
      return sum + Math.min(file.size, start + partSize) - start;
    }, 0);
    options.onProgress?.({
      fraction: Math.min(1, bytes / file.size),
      uploadedBytes: bytes,
      partsDone: uploaded.size,
      partsTotal,
    });
  };
  report();

  for (let partNumber = 1; partNumber <= partsTotal; partNumber++) {
    if (uploaded.has(partNumber)) continue;
    const part = await uploadPart(fetchImpl, apiBase, session, file, partNumber, partSize, retries, options.signal);
    uploaded.set(part.partNumber, part.etag);
    session = {
      ...session,
      parts: [...uploaded.entries()].sort((a, b) => a[0] - b[0]).map(([number, etag]) => ({ partNumber: number, etag })),
      updatedAt: Date.now(),
    };
    await store.put(session);
    options.onSession?.(session);
    report();
  }

  const parts = [...uploaded.entries()].sort((a, b) => a[0] - b[0]).map(([partNumber, etag]) => ({ partNumber, etag }));
  await requestJson<{ key: string; size: number }>(fetchImpl, `${apiBase}/storage/multipart/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: session.key, uploadId: session.uploadId, parts }),
    signal: options.signal,
  }, 'The upload could not be finalized');

  await store.delete(id);
  options.onProgress?.({ fraction: 1, uploadedBytes: file.size, partsDone: partsTotal, partsTotal });
  return { key: session.key, size: file.size, resumed };
}

/** Aborts a multipart upload and removes its resume record. */
export async function abortUpload(
  session: UploadSession,
  options: { fetchImpl?: typeof fetch; store?: UploadStore } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = options.store ?? uploadStore;
  try {
    await requestJson(fetchImpl, `${session.apiBase}/storage/multipart/abort`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: session.key, uploadId: session.uploadId }),
    }, 'Could not abort the upload');
  } finally {
    await store.delete(session.id);
  }
}

export async function pendingUploads(store: UploadStore = uploadStore): Promise<UploadSession[]> {
  const sessions = await store.list();
  return sessions
    .filter(session => session.parts.length < Math.ceil(session.size / Math.max(1, session.partSize)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
