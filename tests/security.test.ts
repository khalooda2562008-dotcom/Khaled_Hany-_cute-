import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstileToken } from '../worker/turnstile';
import { normalizeProjectMetadata } from '../worker/projects';

describe('Turnstile server verification', () => {
  it('accepts a token only when Cloudflare siteverify says success', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true }));
    const result = await verifyTurnstileToken('token', 'secret', '203.0.113.4', fetchImpl as unknown as typeof fetch);
    expect(result.success).toBe(true);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init.body as FormData).get('secret')).toBe('secret');
  });

  it('fails closed on a rejected challenge', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] }));
    const result = await verifyTurnstileToken('bad', 'secret', undefined, fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ success: false, errors: ['invalid-input-response'] });
  });

  it('fails closed when siteverify is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const result = await verifyTurnstileToken('token', 'secret', undefined, fetchImpl as unknown as typeof fetch);
    expect(result.success).toBe(false);
  });

  it('rejects missing tokens or secrets without a network call', async () => {
    const fetchImpl = vi.fn();
    expect((await verifyTurnstileToken(null, 'secret', undefined, fetchImpl as unknown as typeof fetch)).success).toBe(false);
    expect((await verifyTurnstileToken('token', '', undefined, fetchImpl as unknown as typeof fetch)).success).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('D1 project metadata validation', () => {
  it('accepts metadata without any video bytes', () => {
    expect(normalizeProjectMetadata({ id: 'project_1', name: '  ريلز ', updatedAt: 1700000000000, durationSec: 42.5, clipCount: 3, sizeBytes: 1024 }))
      .toEqual({ id: 'project_1', name: 'ريلز', updatedAt: 1700000000000, durationSec: 42.5, clipCount: 3, sizeBytes: 1024 });
  });

  it('rejects unsafe ids, empty names and negative sizes', () => {
    expect(() => normalizeProjectMetadata({ id: '../etc', name: 'x' })).toThrow();
    expect(() => normalizeProjectMetadata({ id: 'ok', name: '' })).toThrow();
    expect(() => normalizeProjectMetadata({ id: 'ok', name: 'x', sizeBytes: 999 * 1024 * 1024 * 1024 })).toThrow();
  });
});
