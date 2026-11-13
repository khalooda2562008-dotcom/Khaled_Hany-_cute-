import { describe, expect, it, vi } from 'vitest';
import { uploadMedia, abortUpload } from '../src/services/multipartUpload';
import { MemoryUploadStore } from '../src/services/uploadStore';
import type { UploadSession } from '../src/types/upload';

const MiB = 1024 * 1024;

function makeFile(size: number, name = 'clip.mp4'): File {
  return new File([new Uint8Array(size)], name, { type: 'video/mp4' });
}

describe('resumable multipart uploader', () => {
  it('uploads 12 MiB in 5 MiB parts and completes the upload', async () => {
    const file = makeFile(12 * MiB);
    const store = new MemoryUploadStore();
    const calls: Array<{ url: string; method: string; size?: number; body?: unknown }> = [];
    const partSizes: number[] = [];
    let completeBody: { parts: Array<{ partNumber: number; etag: string }> } | null = null;
    const progress: number[] = [];

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      calls.push({ url, method, size: (init.body as Blob | undefined)?.size, body: init.body });
      if (url.endsWith('/storage/multipart/create')) {
        return Response.json({ key: 'users/hash/clip.mp4', uploadId: 'upload-1', partSize: 5 * MiB, maxPartBytes: 25 * MiB }, { status: 201 });
      }
      if (url.includes('/storage/multipart/part')) {
        const part = Number(new URL(url, 'https://x').searchParams.get('part'));
        partSizes.push((init.body as Blob).size);
        return Response.json({ partNumber: part, etag: `"etag-${part}"` });
      }
      if (url.endsWith('/storage/multipart/complete')) {
        completeBody = JSON.parse(String(init.body));
        return Response.json({ key: 'users/hash/clip.mp4', size: file.size });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    }) as unknown as typeof fetch;

    const result = await uploadMedia(file, {
      fetchImpl,
      store,
      onProgress: value => progress.push(value.fraction),
    });

    expect(result).toEqual({ key: 'users/hash/clip.mp4', size: 12 * MiB, resumed: false });
    expect(partSizes).toEqual([5 * MiB, 5 * MiB, 2 * MiB]);
    expect(completeBody!.parts).toHaveLength(3);
    expect(completeBody!.parts.map(part => part.partNumber)).toEqual([1, 2, 3]);
    expect(progress.at(-1)).toBe(1);
    expect(await store.list()).toHaveLength(0);
    expect(calls.some(call => call.url.includes('/multipart/part') && call.method === 'PUT')).toBe(true);
  });

  it('resumes from the first missing part after an interruption', async () => {
    const file = makeFile(12 * MiB);
    const store = new MemoryUploadStore();
    const session: UploadSession = {
      id: 'upload:/api:clip.mp4:12582912',
      key: 'users/hash/clip.mp4',
      uploadId: 'upload-1',
      name: 'clip.mp4',
      size: file.size,
      type: 'video/mp4',
      partSize: 5 * MiB,
      parts: [{ partNumber: 1, etag: '"etag-1"' }],
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 1000,
      apiBase: '/api',
    };
    await store.put(session);

    const uploadedParts: number[] = [];
    let completed: Array<{ partNumber: number; etag: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      if (url.includes('/storage/multipart/session')) return Response.json({ resumable: true });
      if (url.includes('/storage/multipart/part')) {
        const part = Number(new URL(url, 'https://x').searchParams.get('part'));
        uploadedParts.push(part);
        return Response.json({ partNumber: part, etag: `"etag-${part}"` });
      }
      if (url.endsWith('/storage/multipart/complete')) {
        completed = JSON.parse(String(init.body)).parts;
        return Response.json({ key: session.key, size: file.size });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    }) as unknown as typeof fetch;

    const result = await uploadMedia(file, { fetchImpl, store, apiBase: '/api' });

    expect(result.resumed).toBe(true);
    expect(uploadedParts).toEqual([2, 3]);
    expect(completed.map(part => part.partNumber)).toEqual([1, 2, 3]);
    expect(completed[0].etag).toBe('"etag-1"');
  });

  it('keeps the resume record when a part fails with a retryable error', async () => {
    const file = makeFile(6 * MiB);
    const store = new MemoryUploadStore();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/multipart/create')) return Response.json({ key: 'users/hash/clip.mp4', uploadId: 'u2', partSize: 5 * MiB });
      return Response.json({ error: 'temporary outage' }, { status: 503 });
    }) as unknown as typeof fetch;

    await expect(uploadMedia(file, { fetchImpl, store, retries: 0 })).rejects.toMatchObject({ retryable: true });
    const pending = await store.list();
    expect(pending).toHaveLength(1);
    expect(pending[0].uploadId).toBe('u2');
  });

  it('starts a new upload when the previous session is gone', async () => {
    const file = makeFile(6 * MiB);
    const store = new MemoryUploadStore();
    await store.put({
      id: 'upload:/api:clip.mp4:6291456', key: 'users/hash/old.mp4', uploadId: 'gone', name: 'clip.mp4',
      size: file.size, type: 'video/mp4', partSize: 5 * MiB, parts: [], createdAt: 1, updatedAt: 1, apiBase: '/api',
    });
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/multipart/session')) return Response.json({ error: 'not found' }, { status: 404 });
      if (url.endsWith('/multipart/create')) return Response.json({ key: 'users/hash/new.mp4', uploadId: 'new', partSize: 5 * MiB });
      if (url.includes('/multipart/part')) {
        const part = Number(new URL(url, 'https://x').searchParams.get('part'));
        return Response.json({ partNumber: part, etag: `"e${part}"` });
      }
      if (url.endsWith('/multipart/complete')) return Response.json({ key: 'users/hash/new.mp4', size: file.size });
      return Response.json({}, { status: 500 });
    }) as unknown as typeof fetch;

    const result = await uploadMedia(file, { fetchImpl, store });
    expect(result.key).toBe('users/hash/new.mp4');
    expect(result.resumed).toBe(false);
  });

  it('aborts the server upload and clears the resume record', async () => {
    const store = new MemoryUploadStore();
    const session: UploadSession = {
      id: 'upload:/api:clip.mp4:10', key: 'users/hash/clip.mp4', uploadId: 'up-9', name: 'clip.mp4',
      size: 10, type: 'video/mp4', partSize: 5 * MiB, parts: [], createdAt: 1, updatedAt: 1, apiBase: '/api',
    };
    await store.put(session);
    let aborted = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/multipart/abort')) { aborted = true; return Response.json({ aborted: true }); }
      return Response.json({}, { status: 500 });
    }) as unknown as typeof fetch;

    await abortUpload(session, { fetchImpl, store });
    expect(aborted).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });
});
