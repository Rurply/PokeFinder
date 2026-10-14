// Picks the market price to compare against, from real API fields only.
import type { Card, TcgplayerVariant } from './tcgdex';

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

// Cardmarket price-guide fields: plain fields are the regular printing, "-holo" fields the
// reverse-holo/foil printing.
const CM_FIELDS: Record<CardmarketMetric, [string, string]> = {
  trend: ['trend', 'trend price'],
  avg: ['avg', 'average sell price'],
  low: ['low', 'low price'],
};

/** "2026-10-13T22:54:32.779Z" or "2025/11/21" -> "2026-10-13" */
export function apiDate(d?: string): string {
  return (d ?? '').trim().slice(0, 10).replace(/\//g, '-');
}

export function daysBetween(isoDate: string, today: Date): number {
  const t = Date.parse(isoDate + 'T00:00:00Z');
  if (isNaN(t)) return Infinity;
  return Math.floor((today.getTime() - t) / 86400000);
}

/** Missing values come as null or 0, so only positive numbers count as prices. */
function valid(n: unknown): n is number {
  return typeof n === 'number' && isFinite(n) && n > 0;
}

export function cardmarketPrice(card: Card, metric: CardmarketMetric): PricePoint | null {
  const cm = card.pricing?.cardmarket;
  if (!cm || !cm.updated) return null;
  const order: CardmarketMetric[] = [metric, ...(['trend', 'avg', 'low'] as const).filter((m) => m !== metric)];
  for (const holo of [false, true]) {
    for (const m of order) {
      const [field, label] = CM_FIELDS[m];
      const v = cm[holo ? `${field}-holo` : field];
      if (!valid(v)) continue;
      let metricLabel = m === metric ? label : `${label} (${CM_FIELDS[metric][1]} unavailable)`;
      if (holo) metricLabel += ', reverse holo';
      return { amount: v, currency: 'EUR', source: 'Cardmarket', metric: metricLabel, updatedAt: apiDate(cm.updated) };
    }
  }
  return null;
}

const TCG_VARIANT_ORDER = ['holofoil', 'normal', 'reverse-holofoil', '1st-edition-holofoil', '1st-edition', 'unlimited-holofoil', 'unlimited'];

export function tcgplayerPrice(card: Card): PricePoint | null {
  const tp = card.pricing?.tcgplayer;
  if (!tp || !tp.updated) return null;
  const variants = Object.keys(tp).filter((k) => k !== 'unit' && k !== 'updated' && tp[k] && typeof tp[k] === 'object');
  const ordered = [...TCG_VARIANT_ORDER.filter((k) => variants.includes(k)), ...variants.filter((k) => !TCG_VARIANT_ORDER.includes(k))];
  for (const [field, label] of [['marketPrice', 'market'], ['midPrice', 'mid']] as const) {
    for (const variant of ordered) {
      const v = (tp[variant] as TcgplayerVariant)[field];
      if (valid(v)) {
        return { amount: v, currency: 'USD', source: 'TCGplayer', metric: `${label} (${variant})`, updatedAt: apiDate(tp.updated) };
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
