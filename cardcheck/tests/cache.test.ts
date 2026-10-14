import { describe, expect, it } from 'vitest';
import { createCache, HOUR, memoryKV, TTL } from '../src/lib/cache';

describe('cache expiry', () => {
  it('returns values until the TTL passes', async () => {
    let now = 1_000_000;
    const cache = createCache(memoryKV(), () => now);
    await cache.set('card:sv3-125', { id: 'sv3-125' });
    expect(await cache.get('card:sv3-125', TTL.card)).toEqual({ id: 'sv3-125' });
    now += 24 * HOUR; // exactly 24h: still valid
    expect(await cache.get('card:sv3-125', TTL.card)).toEqual({ id: 'sv3-125' });
    now += 1; // 24h + 1ms: expired
    expect(await cache.get('card:sv3-125', TTL.card)).toBeUndefined();
    // peek still sees the stale entry
    expect((await cache.peek('card:sv3-125'))?.v).toEqual({ id: 'sv3-125' });
  });

  it('uses different TTLs for cards (24h) and rates (12h)', async () => {
    let now = 0;
    const cache = createCache(memoryKV(), () => now);
    await cache.set('rates', 1);
    await cache.set('card:x', 2);
    now = 13 * HOUR;
    expect(await cache.get('rates', TTL.rates)).toBeUndefined();
    expect(await cache.get('card:x', TTL.card)).toBe(2);
  });

  it('prunes expired entries only', async () => {
    let now = 0;
    const kv = memoryKV();
    const cache = createCache(kv, () => now);
    await cache.set('old', 1);
    now = 25 * HOUR;
    await cache.set('new', 2);
    await kv.set({ settings: { currency: 'EUR' } });
    expect(await cache.prune(TTL.card)).toBe(1);
    expect(await cache.get('new', TTL.card)).toBe(2);
    expect(await kv.get(['settings'])).toEqual({ settings: { currency: 'EUR' } });
  });
});
