import { describe, expect, it, vi } from 'vitest';
import { createCache, HOUR, memoryKV } from '../src/lib/cache';
import { convert, getRates, type Rates } from '../src/lib/currency';

// ECB rates as returned by api.frankfurter.dev on 2026-10-14.
const rates: Rates = { base: 'EUR', date: '2026-10-14', rates: { USD: 1.1195, GBP: 0.84385, JPY: 177.39 }, source: 'ECB via Frankfurter' };

describe('convert', () => {
  it('EUR -> USD/GBP/JPY', () => {
    expect(convert(10, 'EUR', 'USD', rates)).toBeCloseTo(11.195, 6);
    expect(convert(10, 'EUR', 'GBP', rates)).toBeCloseTo(8.4385, 6);
    expect(convert(10, 'EUR', 'JPY', rates)).toBeCloseTo(1773.9, 6);
  });
  it('USD -> EUR (TCGplayer fallback)', () => {
    expect(convert(5.43, 'USD', 'EUR', rates)).toBeCloseTo(5.43 / 1.1195, 6);
  });
  it('cross rate USD -> GBP goes via EUR', () => {
    expect(convert(1.1195, 'USD', 'GBP', rates)).toBeCloseTo(0.84385, 6);
  });
  it('identity and unknown currencies', () => {
    expect(convert(7, 'GBP', 'GBP', rates)).toBe(7);
    expect(convert(7, 'XYZ', 'EUR', rates)).toBeNull();
  });
});

describe('getRates', () => {
  const body = { amount: 1, base: 'EUR', date: '2026-10-14', rates: rates.rates };
  const okFetch = () => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

  it('caches rates for 12 hours', async () => {
    let now = 0;
    const cache = createCache(memoryKV(), () => now);
    const f = okFetch();
    await getRates(cache, f);
    now = 11 * HOUR;
    await getRates(cache, f);
    expect(f).toHaveBeenCalledTimes(1);
    now = 12 * HOUR + 1;
    await getRates(cache, f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falls back to expired cached rates when the API is down', async () => {
    let now = 0;
    const cache = createCache(memoryKV(), () => now);
    await getRates(cache, okFetch());
    now = 13 * HOUR;
    const down = vi.fn(async () => new Response('bad request', { status: 400 }));
    const r = await getRates(cache, down);
    expect(r.date).toBe('2026-10-14');
  });
});
