import { describe, expect, it } from 'vitest';
import { dealVerdict } from '../src/lib/verdict';

describe('dealVerdict thresholds (default 85% / 110%)', () => {
  it.each([
    [50, 100, 'good'],
    [85, 100, 'good'], // boundary: <= 85% is good
    [85.01, 100, 'fair'],
    [100, 100, 'fair'],
    [110, 100, 'fair'], // boundary: <= 110% is fair
    [110.01, 100, 'over'],
    [300, 100, 'over'],
    [0, 3.57, 'good'], // free
  ] as const)('asking %d vs market %d -> %s', (asking, market, verdict) => {
    expect(dealVerdict(asking, market).verdict).toBe(verdict);
  });

  it('respects custom thresholds', () => {
    const t = { goodMax: 0.7, fairMax: 1.0 };
    expect(dealVerdict(75, 100, t).verdict).toBe('fair');
    expect(dealVerdict(101, 100, t).verdict).toBe('over');
    expect(dealVerdict(70, 100, t).verdict).toBe('good');
  });

  it('is unknown without a market price', () => {
    expect(dealVerdict(10, null).verdict).toBe('unknown');
    expect(dealVerdict(10, 0).verdict).toBe('unknown');
    expect(dealVerdict(null, 10).verdict).toBe('unknown');
  });

  it('reports the ratio', () => {
    expect(dealVerdict(90, 100).ratio).toBeCloseTo(0.9);
  });
});
