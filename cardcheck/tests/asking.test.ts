import { describe, expect, it } from 'vitest';
import { parseAskingPrice } from '../src/lib/asking';

describe('parseAskingPrice', () => {
  it.each([
    ['€ 140,00', 140, 'EUR'],
    ['€ 18,99', 18.99, 'EUR'],
    ['12,50 €', 12.5, 'EUR'],
    ['€ 1.250,00', 1250, 'EUR'],
    ['€1.250', 1250, 'EUR'],
    ['$5.43', 5.43, 'USD'],
    ['£1,250.50', 1250.5, 'GBP'],
    ['Gratis', 0, 'EUR'],
  ] as const)('%s', (text, amount, currency) => {
    expect(parseAskingPrice(text)).toMatchObject({ amount, currency });
  });
  it('returns null for bid-only listings', () => {
    expect(parseAskingPrice('Bieden')).toBeNull();
    expect(parseAskingPrice('Zie omschrijving')).toBeNull();
  });
});
