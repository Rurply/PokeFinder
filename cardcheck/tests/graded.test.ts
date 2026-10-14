import { describe, expect, it } from 'vitest';
import { gradedSearch, gradeNumber, isGradedSalesUrl } from '../src/lib/graded';

describe('graded sales links', () => {
  it('builds eBay sold and PSA searches', () => {
    const s = gradedSearch({ name: 'Bulbasaur', number: '133', grade: '8', currency: 'EUR' });
    expect(s.query).toBe('Bulbasaur 133 PSA 8');
    const e = new URL(s.ebay);
    expect(e.hostname).toBe('www.ebay.de');
    expect(e.searchParams.get('_nkw')).toBe('Bulbasaur 133 PSA 8');
    expect(e.searchParams.get('LH_Sold')).toBe('1');
    expect(new URL(s.psa).searchParams.get('q')).toBe('Bulbasaur 133');
    expect(new URL(gradedSearch({ name: 'Mew', currency: 'GBP' }).ebay).hostname).toBe('www.ebay.co.uk');
    expect(new URL(gradedSearch({ name: 'Mew', currency: 'JPY' }).ebay).hostname).toBe('www.ebay.com');
  });
  it('reads the grade number from PSA wording', () => {
    expect(gradeNumber('NM-MT 8')).toBe('8');
    expect(gradeNumber('GEM MT 10')).toBe('10');
    expect(gradeNumber('8.5')).toBe('8.5');
    expect(gradeNumber(undefined)).toBeUndefined();
  });
  it('only allows eBay search and PSA auction-price pages', () => {
    const s = gradedSearch({ name: 'Bulbasaur', number: '133', grade: '8', currency: 'EUR' });
    expect(isGradedSalesUrl(s.ebay)).toBe(true);
    expect(isGradedSalesUrl(s.psa)).toBe(true);
    expect(isGradedSalesUrl('https://evil.example/sch/i.html')).toBe(false);
    expect(isGradedSalesUrl('https://www.ebay.de/signin')).toBe(false);
    expect(isGradedSalesUrl('http://www.psacard.com/auctionprices')).toBe(false);
    expect(isGradedSalesUrl('javascript:alert(1)')).toBe(false);
  });
});
