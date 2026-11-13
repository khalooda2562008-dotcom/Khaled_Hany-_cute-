import { describe, expect, it } from 'vitest';
import { createApp } from '../worker/app';
import type { Env } from '../worker/env';

type Row = { id: string; owner: string; name: string; updated_at: number; duration_sec: number; clip_count: number; size_bytes: number };

/** Minimal D1 stand-in covering the three queries the Worker issues. */
class FakeD1 {
  rows = new Map<string, Row>();

  prepare(sql: string) {
    return {
      bind: (...args: Array<string | number>) => ({
        all: async () => {
          const owner = String(args[0]);
          const list = [...this.rows.values()]
            .filter(row => row.owner === owner)
            .sort((a, b) => b.updated_at - a.updated_at);
          return { results: list, success: true } as never;
        },
        first: async () => this.rows.get(`${args[0]}|${args[1]}`) ?? null,
        run: async () => {
          if (/^\s*delete/i.test(sql)) {
            this.rows.delete(`${args[0]}|${args[1]}`);
            return { success: true } as never;
          }
          if (/^\s*insert/i.test(sql)) {
            const [id, owner, name, updatedAt, duration, clips, size] = args;
            const key = `${id}|${owner}`;
            const existing = this.rows.get(key);
            if (!existing || existing.owner === owner) {
              this.rows.set(key, {
                id: String(id), owner: String(owner), name: String(name), updated_at: Number(updatedAt),
                duration_sec: Number(duration), clip_count: Number(clips), size_bytes: Number(size),
              });
            }
            return { success: true } as never;
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      }),
    } as never;
  }
}

const identity = async () => ({ sub: 'owner-1' });

function makeApp() {
  return createApp({ identify: identity });
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://example.com${path}`, init);
}

describe('optional D1 project metadata API', () => {
  it('saves, lists, reads and deletes metadata for the signed-in owner', async () => {
    const db = new FakeD1();
    const env = { DB: db } as unknown as Env;
    const app = makeApp();

    const saved = await app.fetch(request('/api/projects', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'project_1', name: 'فيديو السفر', updatedAt: 1700000000000, durationSec: 61.2, clipCount: 4, sizeBytes: 2048 }),
    }), env);
    expect(saved.status).toBe(200);

    const list = await app.fetch(request('/api/projects'), env);
    const listing = await list.json() as { projects: Array<{ id: string; name: string; clipCount: number }> };
    expect(listing.projects).toEqual([{ id: 'project_1', name: 'فيديو السفر', updatedAt: 1700000000000, durationSec: 61.2, clipCount: 4, sizeBytes: 2048 }]);

    const single = await app.fetch(request('/api/projects/project_1'), env);
    expect((await single.json() as { project: { name: string } }).project.name).toBe('فيديو السفر');

    const removed = await app.fetch(request('/api/projects/project_1', { method: 'DELETE' }), env);
    expect((await removed.json() as { deleted: boolean }).deleted).toBe(true);
    expect(db.rows.size).toBe(0);
  });

  it('returns 503 when the optional D1 binding is absent', async () => {
    const response = await makeApp().fetch(request('/api/projects'), {} as Env);
    expect(response.status).toBe(503);
  });

  it('rejects metadata that is not safe to store', async () => {
    const env = { DB: new FakeD1() } as unknown as Env;
    const response = await makeApp().fetch(request('/api/projects', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '../escape', name: 'x' }),
    }), env);
    expect(response.status).toBe(400);
  });
});
