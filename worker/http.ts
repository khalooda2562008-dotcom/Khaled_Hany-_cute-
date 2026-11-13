export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/**
 * Strict, mobile-friendly Content Security Policy.
 * FFmpeg.wasm runs single-threaded from a blob worker, so `wasm-unsafe-eval` and
 * `worker-src blob:` are required. Cross-origin app code is limited to unpkg
 * (FFmpeg core) and Cloudflare's own Turnstile/Analytics endpoints.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob: https://unpkg.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: https://unpkg.com https://challenges.cloudflare.com https://cloudflareinsights.com",
  "worker-src 'self' blob:",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

/** Adds hardening headers without touching status, encoding or cache metadata. */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  return json({ error: message }, 500);
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
