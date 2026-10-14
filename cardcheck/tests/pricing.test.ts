import { describe, expect, it } from 'vitest';
import { cardmarketPrice, choosePrice, tcgplayerPrice } from '../src/lib/pricing';
import { fromFull, type Card } from '../src/lib/tcgdex';
import fixture from './fixtures/tcgdex-sv03-125.json';

// Real TCGdex response for Charizard ex (sv03-125), captured 2026-10-14.
const card = fromFull(fixture as never, 'en');
const cm = card.pricing!.cardmarket!;
const today = new Date('2026-10-14T12:00:00Z');

describe('price selection (TCGdex pricing)', () => {
  it('reads Cardmarket metrics with their update date', () => {
    expect(cardmarketPrice(card, 'trend')).toMatchObject({ amount: cm.trend, currency: 'EUR', source: 'Cardmarket', metric: 'trend price', updatedAt: '2026-10-13' });
    expect(cardmarketPrice(card, 'avg')!.amount).toBe(cm.avg);
    expect(cardmarketPrice(card, 'low')!.amount).toBe(cm.low);
  });

  it('reads the TCGplayer market price and variant', () => {
    expect(tcgplayerPrice(card)).toMatchObject({ currency: 'USD', metric: 'market (holofoil)', updatedAt: '2026-10-13' });
  });

  it('freshest wins: fresh Cardmarket is primary, TCGplayer secondary', () => {
    const c = choosePrice(card, { metric: 'trend', policy: 'auto', freshnessDays: 30, today });
    expect(c.primary!.source).toBe('Cardmarket');
    expect(c.secondary!.source).toBe('TCGplayer');
  });

  it('freshest wins: stale Cardmarket falls back to the fresher TCGplayer price', () => {
    const stale: Card = { ...card, pricing: { ...card.pricing, cardmarket: { ...cm, updated: '2025-11-21T00:00:00Z' } } };
    const c = choosePrice(stale, { metric: 'trend', policy: 'auto', freshnessDays: 30, today });
    expect(c.primary!.source).toBe('TCGplayer');
    expect(c.note).toMatch(/days old/);
  });

  it('forced policies', () => {
    expect(choosePrice(card, { metric: 'trend', policy: 'tcgplayer', freshnessDays: 30, today }).primary!.source).toBe('TCGplayer');
    expect(choosePrice(card, { metric: 'trend', policy: 'cardmarket', freshnessDays: 30, today }).primary!.source).toBe('Cardmarket');
  });

  it('uses reverse-holo Cardmarket prices only when the regular ones are missing', () => {
    const holoOnly: Card = { ...card, pricing: { cardmarket: { updated: '2026-10-13', trend: null, avg: 0, low: null, 'trend-holo': 2.5 } } };
    expect(cardmarketPrice(holoOnly, 'trend')).toMatchObject({ amount: 2.5, metric: 'trend price, reverse holo' });
  });

  it('treats null/zero as missing and never invents a price', () => {
    const empty: Card = { ...card, pricing: { cardmarket: { updated: '2026-10-13', trend: 0, avg: null, low: null }, tcgplayer: null } };
    expect(choosePrice(empty, { metric: 'trend', policy: 'auto', freshnessDays: 30, today })).toEqual({ primary: null, secondary: null });
    expect(choosePrice({ ...card, pricing: undefined }, { metric: 'trend', policy: 'auto', freshnessDays: 30, today }).primary).toBeNull();
  });
});
