import type { Env, Identity, R2BucketLike, R2UploadedPart } from './env';
import { HttpError, json, parsePositiveInt } from './http';
import { userPrefix } from './auth';
import { verifyTurnstileToken } from './turnstile';

export const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB application quota (R2 free allowance)
export const DEFAULT_SMALL_UPLOAD_BYTES = 20 * 1024 * 1024; // simple form upload cap
export const DEFAULT_MULTIPART_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB per file
export const DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024; // R2 requires >= 5 MiB per non-final part
export const DEFAULT_MAX_PART_BYTES = 25 * 1024 * 1024;

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv']);
const MAX_PARTS = 10_000;

export interface StorageDeps {
  verifyTurnstile?: typeof verifyTurnstileToken;
}

function bucket(env: Env): R2BucketLike {
  if (!env.MEDIA) throw new HttpError(503, 'R2 storage is not connected to this Worker yet.');
  return env.MEDIA;
}

export function sanitizeFileName(raw: string): { base: string; extension: string } {
  const trimmed = (raw || '').trim();
  const parts = trimmed.split('.');
  const extension = (parts.length > 1 ? parts.pop()! : '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = (parts.join('.') || 'video')
    .replace(/[^a-zA-Z0-9\u0600-\u06FF._ -]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'video';
  return { base, extension: VIDEO_EXTENSIONS.has(extension) ? extension : 'mp4' };
}

export function assertOwnedKey(key: string, prefix: string): void {
  if (!key || key.length > 220 || key.includes('..') || key.startsWith('/') || !key.startsWith(prefix)) {
    throw new HttpError(403, 'Object key is not owned by this account.');
  }
}

export async function usageFor(media: R2BucketLike, prefix: string) {
  let cursor: string | undefined;
  let usedBytes = 0;
  let objectCount = 0;
  do {
    const result = await media.list({ prefix, cursor, limit: 1000 });
    for (const object of result.objects) {
      usedBytes += object.size;
      objectCount += 1;
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return { usedBytes, objectCount };
}

async function ensureQuota(env: Env, prefix: string, incomingBytes: number) {
  const quota = parsePositiveInt(env.STORAGE_QUOTA_BYTES, DEFAULT_QUOTA_BYTES);
  const usage = await usageFor(bucket(env), prefix);
  if (usage.usedBytes + incomingBytes > quota) {
    throw new HttpError(413, 'The application storage quota would be exceeded.');
  }
  return { quota, usage };
}

async function ensureTurnstile(request: Request, env: Env, deps: StorageDeps) {
  if (!env.TURNSTILE_SECRET) return; // optional: disabled unless a secret is configured
  const token = request.headers.get('cf-turnstile-response');
  const verify = deps.verifyTurnstile ?? verifyTurnstileToken;
  const result = await verify(token, env.TURNSTILE_SECRET, request.headers.get('cf-connecting-ip') ?? undefined);
  if (!result.success) throw new HttpError(403, 'Bot verification failed. Refresh the page and try again.');
}

function contentDisposition(name: string): string {
  const cleaned = name.replace(/["\\\r\n]/g, '_').slice(0, 120);
  // Header values must be a ByteString; keep the UTF-8 name in RFC 5987 form.
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, '_') || 'video.mp4';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

export async function handleStorage(
  request: Request,
  env: Env,
  identity: Identity,
  deps: StorageDeps = {},
): Promise<Response> {
  const media = bucket(env);
  const prefix = await userPrefix(identity.sub);
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/storage/, '') || '/';

  if (route === '/usage' && request.method === 'GET') {
    const quota = parsePositiveInt(env.STORAGE_QUOTA_BYTES, DEFAULT_QUOTA_BYTES);
    const usage = await usageFor(media, prefix);
    return json({ ...usage, quotaBytes: quota, remainingBytes: Math.max(0, quota - usage.usedBytes) });
  }

  if (route === '/list' && request.method === 'GET') {
    const result = await media.list({ prefix, limit: 500 });
    return json({
      objects: result.objects.map(object => ({
        key: object.key,
        name: object.key.slice(prefix.length),
        size: object.size,
        uploaded: object.uploaded.toISOString(),
        contentType: object.httpMetadata?.contentType,
      })),
    });
  }

  if (route === '/file' && request.method === 'GET') {
    const key = url.searchParams.get('key') ?? '';
    assertOwnedKey(key, prefix);
    const range = request.headers.get('range');
    const object = await media.get(key, range ? { range: request.headers } : undefined);
    if (!object) throw new HttpError(404, 'File not found.');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'private, no-store');
    headers.set('content-disposition', contentDisposition(key.slice(prefix.length)));
    let status = 200;
    if (range && object.range && 'offset' in object.range && 'length' in object.range) {
      const offset = Number(object.range.offset ?? 0);
      const length = Number(object.range.length ?? object.size);
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      status = 206;
    }
    return new Response(object.body, { status, headers });
  }

  if (route === '/upload' && request.method === 'POST') {
    await ensureTurnstile(request, env, deps);
    const maxUpload = parsePositiveInt(env.MAX_UPLOAD_BYTES, DEFAULT_SMALL_UPLOAD_BYTES);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'A file field is required.');
    if (file.size <= 0) throw new HttpError(400, 'The file is empty.');
    if (file.size > maxUpload) {
      throw new HttpError(413, `Simple uploads are limited to ${maxUpload} bytes. Use the multipart endpoint for larger media.`);
    }
    await ensureQuota(env, prefix, file.size);
    const { base, extension } = sanitizeFileName(file.name);
    const key = `${prefix}${crypto.randomUUID()}-${base}.${extension}`;
    await media.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { originalName: file.name.slice(0, 200) },
    });
    return json({ key, size: file.size }, 201);
  }

  if (route === '/multipart/create' && request.method === 'POST') {
    await ensureTurnstile(request, env, deps);
    const payload = (await request.json().catch(() => null)) as { name?: string; size?: number; type?: string } | null;
    if (!payload || typeof payload.name !== 'string') throw new HttpError(400, 'A file name is required.');
    const size = Number(payload.size);
    if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'A positive integer file size is required.');
    const maxFile = parsePositiveInt(env.MAX_UPLOAD_BYTES, DEFAULT_MULTIPART_UPLOAD_BYTES);
    // MAX_UPLOAD_BYTES is used for simple uploads too; multipart is allowed up to the larger of the two caps.
    const multipartCap = Math.max(maxFile, DEFAULT_MULTIPART_UPLOAD_BYTES);
    if (size > multipartCap) throw new HttpError(413, `Files larger than ${multipartCap} bytes are not supported.`);
    if (payload.type && !/^(video|audio|application)\//.test(payload.type)) {
      throw new HttpError(415, 'Only video or audio media can be stored.');
    }
    const { quota } = await ensureQuota(env, prefix, size);
    const { base, extension } = sanitizeFileName(payload.name);
    const key = `${prefix}${crypto.randomUUID()}-${base}.${extension}`;
    const upload = await media.createMultipartUpload(key, {
      httpMetadata: { contentType: payload.type || 'video/mp4' },
      customMetadata: { originalName: payload.name.slice(0, 200) },
    });
    const partSize = parsePositiveInt(url.searchParams.get('partSize') ?? undefined, DEFAULT_PART_SIZE_BYTES);
    return json({
      key,
      uploadId: upload.uploadId,
      partSize: Math.max(5 * 1024 * 1024, partSize),
      maxPartBytes: parsePositiveInt(env.MAX_PART_BYTES, DEFAULT_MAX_PART_BYTES),
      quotaBytes: quota,
    }, 201);
  }

  if (route === '/multipart/part' && request.method === 'PUT') {
    const key = url.searchParams.get('key') ?? '';
    const uploadId = url.searchParams.get('uploadId') ?? '';
    const partNumber = Number(url.searchParams.get('part'));
    assertOwnedKey(key, prefix);
    if (!uploadId || uploadId.length > 200) throw new HttpError(400, 'A valid uploadId is required.');
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
      throw new HttpError(400, 'Part number must be between 1 and 10000.');
    }
    const declared = Number(request.headers.get('content-length'));
    const maxPart = parsePositiveInt(env.MAX_PART_BYTES, DEFAULT_MAX_PART_BYTES);
    if (!Number.isFinite(declared) || declared <= 0) throw new HttpError(411, 'Content-Length is required for upload parts.');
    if (declared > maxPart) throw new HttpError(413, `Each part must be at most ${maxPart} bytes.`);
    if (!request.body) throw new HttpError(400, 'The part body is empty.');

    const upload = media.resumeMultipartUpload(key, uploadId);
    const uploaded = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  }

  if (route === '/multipart/complete' && request.method === 'POST') {
    const payload = (await request.json().catch(() => null)) as
      | { key?: string; uploadId?: string; parts?: Array<{ partNumber?: number; etag?: string }> }
      | null;
    if (!payload || typeof payload.key !== 'string' || typeof payload.uploadId !== 'string' || !Array.isArray(payload.parts)) {
      throw new HttpError(400, 'key, uploadId and parts are required.');
    }
    assertOwnedKey(payload.key, prefix);
    const parts: R2UploadedPart[] = payload.parts
      .map(part => ({ partNumber: Number(part.partNumber), etag: String(part.etag ?? '') }))
      .sort((a, b) => a.partNumber - b.partNumber);
    if (!parts.length || parts.length > MAX_PARTS) throw new HttpError(400, 'A non-empty parts list is required.');
    parts.forEach((part, index) => {
      if (!Number.isInteger(part.partNumber) || part.partNumber !== index + 1) {
        throw new HttpError(400, 'Parts must be numbered consecutively from 1.');
      }
      if (!part.etag || part.etag.length > 200) throw new HttpError(400, 'Every part needs its ETag.');
    });

    const upload = media.resumeMultipartUpload(payload.key, payload.uploadId);
    const object = await upload.complete(parts);
    const usage = await usageFor(media, prefix);
    return json({ key: payload.key, size: object.size, uploaded: new Date().toISOString(), usage });
  }

  if (route === '/multipart/abort' && request.method === 'POST') {
    const payload = (await request.json().catch(() => null)) as { key?: string; uploadId?: string } | null;
    if (!payload || typeof payload.key !== 'string' || typeof payload.uploadId !== 'string') {
      throw new HttpError(400, 'key and uploadId are required.');
    }
    assertOwnedKey(payload.key, prefix);
    await media.resumeMultipartUpload(payload.key, payload.uploadId).abort();
    return json({ aborted: true });
  }

  if (route === '/multipart/session' && request.method === 'GET') {
    const key = url.searchParams.get('key') ?? '';
    const uploadId = url.searchParams.get('uploadId') ?? '';
    assertOwnedKey(key, prefix);
    if (!uploadId) throw new HttpError(400, 'A valid uploadId is required.');
    // Confirms the upload id shape before the client spends mobile data on a resume attempt.
    const upload = media.resumeMultipartUpload(key, uploadId);
    return json({ key, uploadId, resumable: Boolean(upload.uploadId) });
  }

  if (route === '/delete' && request.method === 'POST') {
    const payload = (await request.json().catch(() => null)) as { key?: string } | null;
    if (!payload || typeof payload.key !== 'string') throw new HttpError(400, 'A valid object key is required.');
    assertOwnedKey(payload.key, prefix);
    await media.delete(payload.key);
    return json({ deleted: true });
  }

  throw new HttpError(405, `Method ${request.method} is not allowed on ${route}.`);
}
