import { describe, expect, it } from 'vitest';
import { formatBytes, formatTime, clamp } from '../src/utils/format';
import { buildEditingPlan } from '../src/engine/assistant';

describe('format utilities', () => {
  it('formats durations with hours when required', () => {
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3661)).toBe('01:01:01');
  });
  it('formats byte sizes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(0)).toBe('0 B');
  });
  it('clamps numeric values', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
  });
});

describe('deterministic editing assistant', () => {
  it('returns a reviewed silence and audio plan for Egyptian Arabic', () => {
    const plan = buildEditingPlan('شيل السكوت الطويل ونضف الصوت');
    expect(plan.requiresReview).toBe(true);
    expect(plan.operations.some(operation => operation.type === 'remove_silence')).toBe(true);
    expect(plan.operations.some(operation => operation.type === 'noise_reduction')).toBe(true);
  });
  it('does not invent unsupported operations for an unknown request', () => {
    const plan = buildEditingPlan('اعمل مونتاج سحري خارق');
    expect(plan.operations).toHaveLength(0);
  });
});
