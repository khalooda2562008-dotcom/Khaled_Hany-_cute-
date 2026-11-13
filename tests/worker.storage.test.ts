import { describe, expect, it } from 'vitest';
import { createApp } from '../worker/app';
import type { Env } from '../worker/env';

type StoredObject = { data: Uint8Array; contentType: string; uploaded: Date };
type Multipart = { key: string; uploadId: string; parts: Map<number, Uint8Array>; contentType: string };

/** Faithful in-memory subset of the R2 binding used by the Worker. */
class FakeR2 {
  objects = new Map<string, StoredObject>();
  uploads = new Map<string, Multipart>();

  private bytes(value: unknown): Promise<Uint8Array> {
    return new Response(value as BodyInit).arrayBuffer().then(buffer => new Uint8Array(buffer));
  }

  async list(options: { prefix?: string; limit?: number } = {}) {
    const prefix = options.prefix ?? '';
    const objects = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .slice(0, options.limit ?? 1000)
      .map(([key, value]) => ({
        key,
        size: value.data.byteLength,
        uploaded: value.uploaded,
        httpMetadata: { contentType: value.contentType },
        httpEtag: `"etag-${key.length}"`,
      }));
    return { objects, truncated: false, cursor: undefined } as never;
  }

  async put(key: string, value: unknown, options: { httpMetadata?: { contentType?: string } } = {}) {
    this.objects.set(key, {
      data: await this.bytes(value),
      contentType: options.httpMetadata?.contentType ?? 'application/octet-stream',
      uploaded: new Date(),
    });
    return { key, size: this.objects.get(key)!.data.byteLength } as never;
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Response(object.data).body,
      size: object.data.byteLength,
      httpEtag: `"etag-${key.length}"`,
      range: undefined,
      writeHttpMetadata(headers: Headers) {
        headers.set('content-type', object.contentType);
      },
    } as never;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async createMultipartUpload(key: string, options: { httpMetadata?: { contentType?: string } } = {}) {
    const upload: Multipart = {
      key,
      uploadId: crypto.randomUUID(),
      parts: new Map(),
      contentType: options.httpMetadata?.contentType ?? 'video/mp4',
    };
    this.uploads.set(upload.uploadId, upload);
    return this.handle(upload);
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new Error('No such multipart upload.');
    return this.handle(upload);
  }

  private handle(upload: Multipart) {
    return {
      key: upload.key,
      uploadId: upload.uploadId,
      uploadPart: async (partNumber: number, value: unknown) => {
        upload.parts.set(partNumber, await this.bytes(value));
        return { partNumber, etag: `"etag-${partNumber}"` };
      },
      complete: async (parts: Array<{ partNumber: number; etag: string }>) => {
        const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
        const total = sorted.reduce((sum, part) => sum + (upload.parts.get(part.partNumber)?.byteLength ?? 0), 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const part of sorted) {
          const chunk = upload.parts.get(part.partNumber)!;
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        this.objects.set(upload.key, { data: merged, contentType: upload.contentType, uploaded: new Date() });
        this.uploads.delete(upload.uploadId);
        return { key: upload.key, size: merged.byteLength } as never;
      },
      abort: async () => {
        this.uploads.delete(upload.uploadId);
      },
    };
  }
}

const identity = async () => ({ sub: 'owner-1', email: 'owner@example.com' });
const app = createApp({ identify: identity });

function makeEnv(extra: Partial<Env> = {}): Env & { MEDIA: FakeR2 } {
  return { MEDIA: new FakeR2(), ENVIRONMENT: 'test', ...extra } as Env & { MEDIA: FakeR2 };
}

async function call(env: Env, path: string, init: RequestInit = {}) {
  return app.fetch(new Request(`https://example.com${path}`, init), env);
}

describe('worker routing and hardening', () => {
  it('exposes a public health endpoint with security headers', async () => {
    const response = await call(makeEnv(), '/api/health');
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; features: { r2: boolean } };
    expect(body.ok).toBe(true);
    expect(body.features.r2).toBe(true);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not expose storage when Cloudflare Access is not configured', async () => {
    const strict = createApp();
    const response = await strict.fetch(new Request('https://example.com/api/storage/usage'), makeEnv());
    expect(response.status).toBe(503);
  });

  it('publishes only public configuration', async () => {
    const response = await call(makeEnv({ TURNSTILE_SITE_KEY: 'site-key', TURNSTILE_SECRET: 'secret-value' }), '/api/config');
    const body = await response.json() as Record<string, unknown>;
    expect(body.turnstileSiteKey).toBe('site-key');
    expect(JSON.stringify(body)).not.toContain('secret-value');
  });
});

describe('R2 multipart upload flow', () => {
  it('creates, uploads, completes, lists, downloads and deletes a private file', async () => {
    const env = makeEnv();
    const size = 11 * 1024 * 1024; // 8 MiB + 3 MiB
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 4096) bytes[i] = i % 251;

    const created = await call(env, '/api/storage/multipart/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'مقابلة.mp4', size, type: 'video/mp4' }),
    });
    expect(created.status).toBe(201);
    const session = await created.json() as { key: string; uploadId: string; partSize: number };
    expect(session.key.startsWith('users/')).toBe(true);
    expect(session.key).not.toContain('owner-1');
    expect(session.partSize).toBe(8 * 1024 * 1024);

    const partSize = session.partSize;
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let partNumber = 1; partNumber <= 2; partNumber++) {
      const start = (partNumber - 1) * partSize;
      const chunk = bytes.slice(start, Math.min(size, start + partSize));
      const response = await call(
        env,
        `/api/storage/multipart/part?key=${encodeURIComponent(session.key)}&uploadId=${encodeURIComponent(session.uploadId)}&part=${partNumber}`,
        { method: 'PUT', headers: { 'content-length': String(chunk.byteLength) }, body: chunk },
      );
      expect(response.status).toBe(200);
      parts.push(await response.json() as { partNumber: number; etag: string });
    }

    const complete = await call(env, '/api/storage/multipart/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: session.key, uploadId: session.uploadId, parts }),
    });
    expect(complete.status).toBe(200);
    const completed = await complete.json() as { size: number };
    expect(completed.size).toBe(size);

    const list = await call(env, '/api/storage/list');
    const listing = await list.json() as { objects: Array<{ key: string; size: number; name: string }> };
    expect(listing.objects).toHaveLength(1);
    expect(listing.objects[0].size).toBe(size);

    const download = await call(env, `/api/storage/file?key=${encodeURIComponent(session.key)}`);
    const downloadText = download.status === 200 ? '' : await download.text();
    expect(download.status, downloadText).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    const downloaded = new Uint8Array(await download.arrayBuffer());
    expect(downloaded.byteLength).toBe(size);
    expect(downloaded[4096]).toBe(bytes[4096]);

    const removed = await call(env, '/api/storage/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: session.key }),
    });
    expect((await removed.json() as { deleted: boolean }).deleted).toBe(true);

    const usage = await call(env, '/api/storage/usage');
    expect((await usage.json() as { usedBytes: number }).usedBytes).toBe(0);
  });

  it('rejects keys that belong to another namespace', async () => {
    const env = makeEnv();
    const response = await call(env, '/api/storage/multipart/part?key=users%2Fother%2Fx.mp4&uploadId=abc&part=1', {
      method: 'PUT',
      headers: { 'content-length': '10' },
      body: new Uint8Array(10),
    });
    expect(response.status).toBe(403);
  });

  it('enforces the storage quota before starting an upload', async () => {
    const env = makeEnv({ STORAGE_QUOTA_BYTES: String(1024 * 1024) });
    const response = await call(env, '/api/storage/multipart/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'big.mp4', size: 5 * 1024 * 1024, type: 'video/mp4' }),
    });
    expect(response.status).toBe(413);
  });

  it('rejects non-consecutive parts when completing', async () => {
    const env = makeEnv();
    const created = await call(env, '/api/storage/multipart/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'clip.mp4', size: 1024, type: 'video/mp4' }),
    });
    const session = await created.json() as { key: string; uploadId: string };
    const response = await call(env, '/api/storage/multipart/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: session.key, uploadId: session.uploadId, parts: [{ partNumber: 2, etag: '"x"' }] }),
    });
    expect(response.status).toBe(400);
  });

  it('blocks uploads when Turnstile verification fails', async () => {
    const strict = createApp({
      identify: identity,
      verifyTurnstile: async () => ({ success: false, errors: ['invalid-input-response'] }),
    });
    const env = makeEnv({ TURNSTILE_SECRET: 'secret' });
    const response = await strict.fetch(new Request('https://example.com/api/storage/multipart/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'clip.mp4', size: 1024, type: 'video/mp4' }),
    }), env);
    expect(response.status).toBe(403);
  });
});
