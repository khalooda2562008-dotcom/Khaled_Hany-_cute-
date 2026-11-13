import type { D1DatabaseLike, Env, Identity } from './env';
import { HttpError, json } from './http';
import { userPrefix } from './auth';

/** Project metadata only. Video binaries stay in R2 or on the device, never in D1. */
export interface ProjectMetadata {
  id: string;
  name: string;
  updatedAt: number;
  durationSec: number;
  clipCount: number;
  sizeBytes: number;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export function normalizeProjectMetadata(input: unknown): ProjectMetadata {
  const value = (input ?? {}) as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!ID_PATTERN.test(id)) throw new HttpError(400, 'Project id must be 1-80 letters, digits, dashes or underscores.');
  if (!name || name.length > 120) throw new HttpError(400, 'Project name must be 1-120 characters.');

  const number = (candidate: unknown, fallback = 0) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const updatedAt = number(value.updatedAt, Date.now());
  const durationSec = number(value.durationSec);
  const clipCount = Math.floor(number(value.clipCount));
  const sizeBytes = Math.floor(number(value.sizeBytes));
  if (sizeBytes > 50 * 1024 * 1024 * 1024) throw new HttpError(400, 'Metadata size is out of range.');

  return { id, name, updatedAt: Math.floor(updatedAt), durationSec, clipCount, sizeBytes };
}

function database(env: Env): D1DatabaseLike {
  if (!env.DB) throw new HttpError(503, 'The optional D1 metadata database is not connected.');
  return env.DB;
}

export async function handleProjects(request: Request, env: Env, identity: Identity): Promise<Response> {
  const db = database(env);
  const owner = await userPrefix(identity.sub);
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/projects\/?/, '');

  if (!rest && request.method === 'GET') {
    const result = await db
      .prepare('SELECT id, name, updated_at, duration_sec, clip_count, size_bytes FROM projects WHERE owner_hash = ? ORDER BY updated_at DESC LIMIT 200')
      .bind(owner)
      .all<{ id: string; name: string; updated_at: number; duration_sec: number; clip_count: number; size_bytes: number }>();
    return json({
      projects: (result.results ?? []).map(row => ({
        id: row.id,
        name: row.name,
        updatedAt: row.updated_at,
        durationSec: row.duration_sec,
        clipCount: row.clip_count,
        sizeBytes: row.size_bytes,
      })),
    });
  }

  if (!rest && request.method === 'PUT') {
    const metadata = normalizeProjectMetadata(await request.json().catch(() => null));
    await db
      .prepare(
        `INSERT INTO projects (id, owner_hash, name, updated_at, duration_sec, clip_count, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at,
           duration_sec = excluded.duration_sec,
           clip_count = excluded.clip_count,
           size_bytes = excluded.size_bytes
         WHERE projects.owner_hash = excluded.owner_hash`,
      )
      .bind(metadata.id, owner, metadata.name, metadata.updatedAt, metadata.durationSec, metadata.clipCount, metadata.sizeBytes)
      .run();
    return json({ saved: true, project: metadata });
  }

  const id = decodeURIComponent(rest);
  if (!ID_PATTERN.test(id)) throw new HttpError(400, 'Invalid project id.');

  if (request.method === 'GET') {
    const row = await db
      .prepare('SELECT id, name, updated_at, duration_sec, clip_count, size_bytes FROM projects WHERE id = ? AND owner_hash = ?')
      .bind(id, owner)
      .first<{ id: string; name: string; updated_at: number; duration_sec: number; clip_count: number; size_bytes: number }>();
    if (!row) throw new HttpError(404, 'Project metadata not found.');
    return json({
      project: {
        id: row.id,
        name: row.name,
        updatedAt: row.updated_at,
        durationSec: row.duration_sec,
        clipCount: row.clip_count,
        sizeBytes: row.size_bytes,
      },
    });
  }

  if (request.method === 'DELETE') {
    await db.prepare('DELETE FROM projects WHERE id = ? AND owner_hash = ?').bind(id, owner).run();
    return json({ deleted: true });
  }

  throw new HttpError(405, `Method ${request.method} is not allowed.`);
}
