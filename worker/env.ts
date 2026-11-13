/**
 * Structural types for the Cloudflare bindings.
 *
 * They are declared locally (instead of importing @cloudflare/workers-types into
 * the DOM-typed client project) to keep one tsconfig for app, worker and tests.
 * The real R2/D1 objects satisfy these shapes.
 */
export interface R2ObjectSummary {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}

export interface R2UploadedPart {
  partNumber: number;
  etag: string;
}

export interface R2ObjectBodyLike {
  body: ReadableStream<Uint8Array> | null;
  size: number;
  httpEtag: string;
  range?: { offset?: number; length?: number; suffix?: number };
  writeHttpMetadata(headers: Headers): void;
}

export interface R2MultipartUploadLike {
  key: string;
  uploadId: string;
  uploadPart(partNumber: number, value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | Blob | string): Promise<R2UploadedPart>;
  complete(parts: R2UploadedPart[]): Promise<{ size: number; key?: string }>;
  abort(): Promise<void>;
}

export interface R2BucketLike {
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: R2ObjectSummary[];
    truncated: boolean;
    cursor?: string;
  }>;
  get(key: string, options?: { range?: Headers }): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: unknown, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  delete(key: string): Promise<void>;
  createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<R2MultipartUploadLike>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUploadLike;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): {
    all<T>(): Promise<{ results?: T[] }>;
    first<T>(): Promise<T | null>;
    run(): Promise<unknown>;
  };
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export interface FetcherLike {
  fetch(request: Request): Promise<Response>;
}

/**
 * Bindings for the KHALED CUT AI Worker.
 *
 * Secrets (set with `wrangler secret put`, never in the frontend):
 * - CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD : Cloudflare Access application protecting the API.
 * - TURNSTILE_SECRET                      : optional Turnstile secret key.
 *
 * Plain variables:
 * - TURNSTILE_SITE_KEY, STORAGE_QUOTA_BYTES, MAX_UPLOAD_BYTES, MAX_PART_BYTES, ENVIRONMENT
 */
export interface Env {
  ASSETS?: FetcherLike;
  MEDIA?: R2BucketLike;
  DB?: D1DatabaseLike;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  STORAGE_QUOTA_BYTES?: string;
  MAX_UPLOAD_BYTES?: string;
  MAX_PART_BYTES?: string;
  ENVIRONMENT?: string;
}

export interface Identity {
  sub: string;
  email?: string;
}

export type Identifier = (request: Request, env: Env) => Promise<Identity>;
