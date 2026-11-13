import type { Env, Identifier } from './env';
import { accessConfigured, identifyWithAccess } from './auth';
import { errorResponse, HttpError, json, parsePositiveInt, withSecurityHeaders } from './http';
import {
  DEFAULT_MULTIPART_UPLOAD_BYTES,
  DEFAULT_PART_SIZE_BYTES,
  DEFAULT_QUOTA_BYTES,
  handleStorage,
} from './storage';
import { handleProjects } from './projects';
import { verifyTurnstileToken } from './turnstile';

export interface AppDeps {
  identify?: Identifier;
  verifyTurnstile?: typeof verifyTurnstileToken;
}

const SERVICE = 'khaled-cut-ai';
const VERSION = '1.1.0';

export function createApp(deps: AppDeps = {}) {
  const identify = deps.identify ?? identifyWithAccess;

  async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      if (!env.ASSETS) throw new HttpError(503, 'Static assets are not configured for this Worker.');
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { allow: 'GET, POST, PUT, DELETE, OPTIONS', 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: SERVICE,
        version: VERSION,
        time: new Date().toISOString(),
        features: {
          staticAssets: Boolean(env.ASSETS),
          access: accessConfigured(env),
          r2: Boolean(env.MEDIA),
          d1: Boolean(env.DB),
          turnstile: Boolean(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY),
        },
      });
    }

    if (url.pathname === '/api/config') {
      return json({
        storageEnabled: Boolean(env.MEDIA) && accessConfigured(env),
        accessEnabled: accessConfigured(env),
        d1Enabled: Boolean(env.DB),
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
        partSize: Math.max(5 * 1024 * 1024, parsePositiveInt(undefined, DEFAULT_PART_SIZE_BYTES)),
        maxFileBytes: Math.max(
          parsePositiveInt(env.MAX_UPLOAD_BYTES, DEFAULT_MULTIPART_UPLOAD_BYTES),
          DEFAULT_MULTIPART_UPLOAD_BYTES,
        ),
        quotaBytes: parsePositiveInt(env.STORAGE_QUOTA_BYTES, DEFAULT_QUOTA_BYTES),
      });
    }

    const identity = await identify(request, env);

    if (url.pathname === '/api/storage' || url.pathname.startsWith('/api/storage/')) {
      return handleStorage(request, env, identity, { verifyTurnstile: deps.verifyTurnstile });
    }

    if (url.pathname === '/api/projects' || url.pathname.startsWith('/api/projects/')) {
      return handleProjects(request, env, identity);
    }

    throw new HttpError(404, 'API endpoint not found.');
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      try {
        const response = await route(request, env);
        return withSecurityHeaders(response);
      } catch (error) {
        return withSecurityHeaders(errorResponse(error));
      }
    },
  };
}
