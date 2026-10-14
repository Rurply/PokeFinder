// Search links for real graded sales (eBay sold listings, PSA Auction Prices Realized).
// CardCheck only opens these pages for the user; it never reads prices from them.

export interface GradedSearch {
  query: string;
  ebay: string;
  psa: string;
}

// eBay site per currency: the biggest marketplace that lists in that currency.
const EBAY_SITE: Record<string, string> = {
  EUR: 'www.ebay.de',
  GBP: 'www.ebay.co.uk',
  USD: 'www.ebay.com',
};

/** "NM-MT 8" / "8" / "GEM MT 10" -> "8" / "8" / "10" */
export function gradeNumber(grade?: string): string | undefined {
  return grade?.match(/\d+(?:\.5)?/)?.[0];
}

export function gradedSearch(o: { name: string; number?: string; grade?: string; currency: string }): GradedSearch {
  const grade = gradeNumber(o.grade);
  const query = [o.name, o.number, 'PSA', grade].filter(Boolean).join(' ');
  const site = EBAY_SITE[o.currency] ?? 'www.ebay.com';
  // LH_Sold + LH_Complete = sold listings only; _sop=13 = most recently ended first.
  const ebay = `https://${site}/sch/i.html?${new URLSearchParams({ _nkw: query, LH_Sold: '1', LH_Complete: '1', _sop: '13' })}`;
  const psa = `https://www.psacard.com/auctionprices/search?${new URLSearchParams({ q: [o.name, o.number].filter(Boolean).join(' ') })}`;
  return { query, ebay, psa };
}

/** Only these pages may be opened in the graded-sales window. */
export function isGradedSalesUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (/^www\.ebay\.(com|de|co\.uk|nl|fr|it|es)$/.test(u.hostname)) return u.pathname === '/sch/i.html';
    return u.hostname === 'www.psacard.com' && u.pathname.startsWith('/auctionprices');
  } catch {
    return false;
  }
}
