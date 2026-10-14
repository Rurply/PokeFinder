// All site-specific DOM knowledge lives in this file. When Marktplaats or Vinted change
// their markup, fix the selector lists here. Each list is tried in order; the first
// selector that matches wins, so put the most specific/current selector first and keep
// older ones as fallbacks.
//
// Last checked against live pages: 2026-10-14 (Marktplaats search + listing page, Vinted
// catalog grid; rendered DOM in Chromium, after hydration). The Vinted listing-page selectors could not be checked from the build
// environment (bot protection), so they rely on fallbacks; see README "Fixing selectors".

/**
 * @typedef {Object} SiteSelectors
 * @property {string} id
 * @property {RegExp} hostname
 * @property {string} currency           Default currency of prices on the site
 * @property {RegExp[]} listingPage      URL path patterns of single-listing pages
 * @property {string[]} card             A listing tile in search results / grids
 * @property {string[]} cardImage        The photo inside a tile
 * @property {string[]} cardPrice        The asking price inside a tile
 * @property {string[]} pageGallery      Photo gallery on a listing page
 * @property {string[]} pageImage        Photo(s) on a listing page
 * @property {string[]} pagePrice        Asking price on a listing page
 * @property {RegExp} imageHost          Hostnames serving listing photos (generic fallback)
 * @property {(url: string) => string} upgradeImageUrl  Ask the CDN for a larger photo
 */

/** @type {Record<string, SiteSelectors>} */
export const SITES = {
  marktplaats: {
    id: 'marktplaats',
    hostname: /(^|\.)marktplaats\.nl$/,
    currency: 'EUR',
    listingPage: [/^\/v\/.+\/[am]\d+/, /^\/a\/.+\/[am]\d+/],
    card: ['li.hz-Listing', '[class*="hz-Listing--list-item"]', '[class*="hz-Listing--grid"]', 'article[class*="Listing"]'],
    cardImage: ['.hz-Listing-image-container img', '[class*="Listing-image"] img', 'img.hz-Image', 'img'],
    cardPrice: ['[class*="ListingPrice_hz-Listing-price"]', '.hz-Listing-price', '[class*="Listing-price"]'],
    pageGallery: ['.Gallery-module-root', '[class*="Gallery-module"]', '.Carousel-root', '#listing-root [class*="Gallery"]'],
    pageImage: ['li.slide.selected img.Carousel-module-image', 'img.Carousel-module-image', 'img.HeroImage-module-image', '[class*="HeroImage"] img', '.Gallery-module-root img', '#listing-root img'],
    pagePrice: ['.ListingHeader-module-price', '[class*="ListingHeader-module-price"]', '[class*="ListingHeader"] [class*="price"]', '.listing-price'],
    imageHost: /(^|\.)marktplaats\.com$/,
    upgradeImageUrl: (url) =>
      // Size is selected by ?rule=…eps_NN / ecg_mp_eps$_NN; 85 is the large listing photo.
      url.replace(/(rule=(?:ecg_mp_)?eps(?:\$)?_)(\d+)/, (m, prefix, n) => (Number(n) < 85 ? `${prefix}85` : m)),
  },

  vinted: {
    id: 'vinted',
    hostname: /(^|\.)vinted\.(nl|com)$/,
    currency: 'EUR',
    listingPage: [/^\/items\/\d+/],
    card: ['[data-testid="grid-item"]', '[data-testid^="product-item-id-"]:not([data-testid*="--"])', '.feed-grid__item', '[class*="new-item-box__container"]'],
    cardImage: ['img[data-testid$="--image--img"]', '[class*="new-item-box__image"] img', '.web_ui__Image__content', 'img'],
    cardPrice: ['[data-testid$="--price-text"]', '[class*="new-item-box__title"] p', '[class*="ItemBoxPricing"] p'],
    pageGallery: ['[data-testid="item-photos"]', '.item-photos', '[class*="item-photos"]', 'section[class*="photos"]', 'figure'],
    pageImage: ['[data-testid^="item-photo-"] img', '.item-photos img', '[class*="item-photo"] img', 'figure img'],
    pagePrice: ['[data-testid="item-price"]', '[data-testid*="item-price"]', '[itemprop="price"]', '[class*="ItemPrice"]', '[class*="item-price"]'],
    imageHost: /(^|\.)vinted\.net$/,
    // Vinted photo URLs are signed per size (?s=…), so the thumbnail URL can't be rewritten.
    // The page's embedded JSON usually holds the signed 800px ("f800") URL of the same photo.
    upgradeImageUrl: (url) => {
      const id = url.match(/vinted\.net\/t\/([A-Za-z0-9_-]+)\/\d+x\d+\//)?.[1];
      if (!id) return url;
      const re = new RegExp(`https://images\\d*\\.vinted\\.net/t/${id}/f800/[^"'\\\\\\s]+`);
      for (const script of document.scripts) {
        const hit = script.textContent?.match(re);
        if (hit) return hit[0].replace(/\\u0026/g, '&');
      }
      return url;
    },
  },
};

/** @returns {SiteSelectors | null} */
export function detectSite(hostname) {
  return Object.values(SITES).find((s) => s.hostname.test(hostname)) ?? null;
}

/** @param {SiteSelectors} site */
export function isListingPage(site, pathname) {
  return site.listingPage.some((re) => re.test(pathname));
}

/** First element matching any selector, tried in order. */
export function queryFirst(root, selectors) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      /* invalid selector: skip */
    }
  }
  return null;
}

/** Closest ancestor (or self) matching any selector, tried in order. */
export function closestFirst(el, selectors) {
  for (const sel of selectors) {
    try {
      const hit = el.closest(sel);
      if (hit) return hit;
    } catch {
      /* invalid selector: skip */
    }
  }
  return null;
}

/** Element matches any selector in the list. */
export function matchesAny(el, selectors) {
  return selectors.some((sel) => {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  });
}
