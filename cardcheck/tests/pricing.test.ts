import { describe, expect, it } from 'vitest';
import { cardmarketPrice, choosePrice, tcgplayerPrice } from '../src/lib/pricing';
import type { Card } from '../src/lib/tcgapi';
import fixture from './fixtures/sv3-125.json';

// Real API response for Charizard ex (sv3-125), captured 2026-10-14.
const card = fixture.data as unknown as Card;
const today = new Date('2026-10-14T12:00:00Z');

describe('price selection', () => {
  it('reads Cardmarket metrics with their update date', () => {
    const p = cardmarketPrice(card, 'trend')!;
    expect(p).toMatchObject({ amount: card.cardmarket!.prices!.trendPrice, currency: 'EUR', source: 'Cardmarket', updatedAt: '2025-11-21' });
    expect(cardmarketPrice(card, 'low')!.amount).toBe(card.cardmarket!.prices!.lowPrice);
    expect(cardmarketPrice(card, 'avg')!.amount).toBe(card.cardmarket!.prices!.averageSellPrice);
  });

  it('reads the TCGplayer market price and variant', () => {
    const p = tcgplayerPrice(card)!;
    expect(p.currency).toBe('USD');
    expect(p.metric).toBe('market (holofoil)');
    expect(p.updatedAt).toBe('2026-10-14');
  });

  it('freshest wins: stale Cardmarket falls back to TCGplayer', () => {
    const c = choosePrice(card, { metric: 'trend', policy: 'auto', freshnessDays: 30, today });
    expect(c.primary!.source).toBe('TCGplayer');
    expect(c.secondary!.source).toBe('Cardmarket');
    expect(c.note).toMatch(/days old/);
  });

  it('freshest wins: fresh Cardmarket stays primary', () => {
    const c = choosePrice(card, { metric: 'trend', policy: 'auto', freshnessDays: 400, today });
    expect(c.primary!.source).toBe('Cardmarket');
  });

  it('forced policies', () => {
    expect(choosePrice(card, { metric: 'trend', policy: 'cardmarket', freshnessDays: 30, today }).primary!.source).toBe('Cardmarket');
    expect(choosePrice(card, { metric: 'trend', policy: 'tcgplayer', freshnessDays: 30, today }).primary!.source).toBe('TCGplayer');
  });

  it('treats zero values as missing and never invents a price', () => {
    const empty = { ...card, cardmarket: { updatedAt: '2025/11/21', prices: { trendPrice: 0, averageSellPrice: 0, lowPrice: 0 } }, tcgplayer: undefined } as Card;
    expect(choosePrice(empty, { metric: 'trend', policy: 'auto', freshnessDays: 30, today })).toEqual({ primary: null, secondary: null });
  });
});
