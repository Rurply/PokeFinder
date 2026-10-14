// Picks the market price to compare against, from real API fields only.
import type { Card } from './tcgapi';

export type CardmarketMetric = 'trend' | 'avg' | 'low';
export type SourcePolicy = 'auto' | 'cardmarket' | 'tcgplayer';

export interface PricePoint {
  amount: number;
  currency: 'EUR' | 'USD';
  source: 'Cardmarket' | 'TCGplayer';
  /** Human label for the field used, e.g. "trend price" or "market (holofoil)". */
  metric: string;
  /** Date the API says this price was updated (YYYY-MM-DD). */
  updatedAt: string;
  url?: string;
}

export interface PriceChoice {
  primary: PricePoint | null;
  secondary: PricePoint | null;
  /** Why the primary was chosen (shown in the UI). */
  note?: string;
}

const CM_FIELDS: Record<CardmarketMetric, [string, string]> = {
  trend: ['trendPrice', 'trend price'],
  avg: ['averageSellPrice', 'average sell price'],
  low: ['lowPrice', 'low price'],
};

/** "2025/11/21" -> "2025-11-21" */
export function apiDate(d?: string): string {
  return (d ?? '').trim().slice(0, 10).replace(/\//g, '-');
}

export function daysBetween(isoDate: string, today: Date): number {
  const t = Date.parse(isoDate + 'T00:00:00Z');
  if (isNaN(t)) return Infinity;
  return Math.floor((today.getTime() - t) / 86400000);
}

/** The API reports 0 for missing values, so only positive numbers count as prices. */
function valid(n: unknown): n is number {
  return typeof n === 'number' && isFinite(n) && n > 0;
}

export function cardmarketPrice(card: Card, metric: CardmarketMetric): PricePoint | null {
  const cm = card.cardmarket;
  if (!cm?.prices || !cm.updatedAt) return null;
  const order: CardmarketMetric[] = [metric, ...(['trend', 'avg', 'low'] as const).filter((m) => m !== metric)];
  for (const m of order) {
    const [field, label] = CM_FIELDS[m];
    const v = cm.prices[field];
    if (valid(v)) {
      return {
        amount: v,
        currency: 'EUR',
        source: 'Cardmarket',
        metric: m === metric ? label : `${label} (${CM_FIELDS[metric][1]} unavailable)`,
        updatedAt: apiDate(cm.updatedAt),
        url: cm.url,
      };
    }
  }
  return null;
}

const TCG_VARIANT_ORDER = [
  'holofoil', 'normal', 'reverseHolofoil', '1stEditionHolofoil', '1stEditionNormal',
  'unlimitedHolofoil', 'unlimited', '1stEdition',
];

export function tcgplayerPrice(card: Card): PricePoint | null {
  const tp = card.tcgplayer;
  if (!tp?.prices || !tp.updatedAt) return null;
  const keys = Object.keys(tp.prices);
  const ordered = [...TCG_VARIANT_ORDER.filter((k) => keys.includes(k)), ...keys.filter((k) => !TCG_VARIANT_ORDER.includes(k))];
  for (const field of ['market', 'mid'] as const) {
    for (const variant of ordered) {
      const v = tp.prices[variant]?.[field];
      if (valid(v)) {
        return {
          amount: v,
          currency: 'USD',
          source: 'TCGplayer',
          metric: `${field} (${variant})`,
          updatedAt: apiDate(tp.updatedAt),
          url: tp.url,
        };
      }
    }
  }
  return null;
}

/**
 * "Freshest wins" (policy auto): Cardmarket EUR is preferred while it is at most
 * freshnessDays old; otherwise the more recently updated source is used.
 */
export function choosePrice(
  card: Card,
  opts: { metric: CardmarketMetric; policy: SourcePolicy; freshnessDays: number; today?: Date },
): PriceChoice {
  const today = opts.today ?? new Date();
  const cm = cardmarketPrice(card, opts.metric);
  const tp = tcgplayerPrice(card);
  if (!cm && !tp) return { primary: null, secondary: null };
  if (!cm) return { primary: tp, secondary: null, note: 'No Cardmarket price; using TCGplayer' };
  if (!tp) return { primary: cm, secondary: null };

  if (opts.policy === 'cardmarket') return { primary: cm, secondary: tp };
  if (opts.policy === 'tcgplayer') return { primary: tp, secondary: cm };

  const cmAge = daysBetween(cm.updatedAt, today);
  if (cmAge <= opts.freshnessDays) return { primary: cm, secondary: tp };
  if (tp.updatedAt > cm.updatedAt) {
    return { primary: tp, secondary: cm, note: `Cardmarket price is ${cmAge} days old; using fresher TCGplayer price` };
  }
  return { primary: cm, secondary: tp, note: `Cardmarket price is ${cmAge} days old` };
}
