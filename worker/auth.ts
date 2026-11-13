import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env, Identity } from './env';
import { HttpError } from './http';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function accessConfigured(env: Env): boolean {
  return Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

/**
 * Verifies the Cloudflare Access JWT that the Access edge injects for a
 * self-hosted application. The token is never trusted from a cookie/query.
 *
 * When Access is not configured the storage/API routes are disabled instead of
 * becoming public: private videos must never be exposed by a misconfiguration.
 */
export async function identifyWithAccess(request: Request, env: Env): Promise<Identity> {
  if (!accessConfigured(env)) {
    throw new HttpError(503, 'Cloud storage is not configured yet. Connect a Cloudflare Access application to enable it.');
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) throw new HttpError(401, 'Cloudflare Access sign-in is required.');

  const issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN!.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }

  try {
    const verified = await jwtVerify(assertion, jwks, {
      issuer,
      audience: env.CF_ACCESS_AUD!,
    });
    const sub = typeof verified.payload.sub === 'string' ? verified.payload.sub : '';
    if (!sub) throw new HttpError(401, 'Access token has no subject claim.');
    return {
      sub,
      email: typeof verified.payload.email === 'string' ? verified.payload.email : undefined,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'Cloudflare Access token could not be verified.');
  }
}

/** Hashes the Access subject so personal identifiers never appear in R2 keys. */
export async function userPrefix(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `users/${hash}/`;
}
