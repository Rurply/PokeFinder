export type Verdict = 'good' | 'fair' | 'over' | 'unknown';

export interface Thresholds {
  /** Asking/market ratio at or below which it's a good deal (default 0.85). */
  goodMax: number;
  /** Asking/market ratio at or below which it's fair (default 1.10). */
  fairMax: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { goodMax: 0.85, fairMax: 1.1 };

const EPS = 1e-9;

export function dealVerdict(
  asking: number | null | undefined,
  market: number | null | undefined,
  t: Thresholds = DEFAULT_THRESHOLDS,
): { verdict: Verdict; ratio: number | null } {
  if (asking == null || market == null || !isFinite(asking) || !isFinite(market) || market <= 0 || asking < 0) {
    return { verdict: 'unknown', ratio: null };
  }
  const ratio = asking / market;
  if (ratio <= t.goodMax + EPS) return { verdict: 'good', ratio };
  if (ratio <= t.fairMax + EPS) return { verdict: 'fair', ratio };
  return { verdict: 'over', ratio };
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: '🟢 Good deal',
  fair: '🟡 Fair',
  over: '🔴 Overpriced',
  unknown: '⚪ No verdict',
};
