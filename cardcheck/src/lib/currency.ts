// Currency conversion with ECB rates from Frankfurter (api.frankfurter.dev, v1).
import { type Cache, TTL } from './cache';
import { fetchJson, type FetchLike } from './http';

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'PLN', 'SEK', 'DKK', 'CZK'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Rates {
  /** Always EUR: ECB reference rates are quoted against the euro. */
  base: 'EUR';
  /** ECB rate date (YYYY-MM-DD). */
  date: string;
  /** Units of currency per 1 EUR. */
  rates: Record<string, number>;
  source: 'ECB via Frankfurter';
}

export const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';

/** Converts an amount between currencies via EUR. Returns null for unknown currencies. */
export function convert(amount: number, from: string, to: string, rates: Rates): number | null {
  if (from === to) return amount;
  const rate = (c: string) => (c === 'EUR' ? 1 : rates.rates[c]);
  const rf = rate(from);
  const rt = rate(to);
  if (!rf || !rt) return null;
  return (amount / rf) * rt;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Latest rates, cached for 12 hours. Falls back to an older cached copy if the API is down. */
export async function getRates(cache: Cache, fetchFn?: FetchLike): Promise<Rates> {
  const cached = await cache.get<Rates>('rates', TTL.rates);
  if (cached) return cached;
  try {
    const data = await fetchJson<{ base: string; date: string; rates: Record<string, number> }>(
      FRANKFURTER_URL,
      {},
      fetchFn,
    );
    if (data.base !== 'EUR' || !data.rates) throw new Error('Unexpected Frankfurter response');
    const rates: Rates = { base: 'EUR', date: data.date, rates: data.rates, source: 'ECB via Frankfurter' };
    await cache.set('rates', rates);
    return rates;
  } catch (e) {
    const stale = await cache.peek<Rates>('rates');
    if (stale) return stale.v; // its ECB date is shown in the UI, so staleness stays visible
    throw e;
  }
}
