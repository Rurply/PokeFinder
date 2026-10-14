import { describe, expect, it, vi } from 'vitest';
import { createCache, memoryKV } from '../src/lib/cache';
import { getCard, searchCards, setIdOf } from '../src/lib/tcgdex';
import card from './fixtures/tcgdex-sv03-125.json';
import search from './fixtures/tcgdex-search-11-108.json';
import sets from './fixtures/tcgdex-sets-en.json';

function mockFetch() {
  return vi.fn(async (url: string) => {
    const body = url.endsWith('/en/sets') ? sets : url.includes('/cards?') ? search : card;
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe('TCGdex adapter', () => {
  it('maps search results with set names and printed totals', async () => {
    const f = mockFetch();
    const cards = await searchCards({ localId: '11', 'set.cardCount.official': '108' }, 'en', { cache: createCache(memoryKV()), fetchFn: f });
    const evo = cards.find((c) => c.id === 'xy12-11')!;
    expect(evo).toMatchObject({ name: 'Charizard', number: '11', lang: 'en', brief: true, set: { id: 'xy12', name: 'Evolutions', printedTotal: 108 } });
    expect(evo.images?.small).toMatch(/\/low\.webp$/);
    expect(f.mock.calls[0][0]).toBe('https://api.tcgdex.net/v2/en/cards?localId=11&set.cardCount.official=108');
  });

  it('caches full cards per ID for 24h', async () => {
    const f = mockFetch();
    const cache = createCache(memoryKV());
    const a = await getCard('sv03-125', 'en', { cache, fetchFn: f });
    await getCard('sv03-125', 'en', { cache, fetchFn: f });
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ name: 'Charizard ex', number: '125', set: { name: 'Obsidian Flames', printedTotal: 197 } });
    expect(a.pricing?.cardmarket?.trend).toBeGreaterThan(0);
  });

  it('set id from card id', () => {
    expect(setIdOf('sv03.5-025')).toBe('sv03.5');
    expect(setIdOf('SV2a-025')).toBe('SV2a');
  });
});
