# CardCheck

A Chrome extension (Manifest V3) that identifies Pokémon cards and PSA slabs in listing photos on
**Marktplaats** and **Vinted**, looks up their market value and tells you right away whether the
asking price is a good deal:

- 🟢 **Good deal**: asking price ≤ 85% of market
- 🟡 **Fair**: 85–110%
- 🔴 **Overpriced**: > 110%

(You can change the thresholds in Settings.)

It is free to run. OCR happens locally with a bundled copy of Tesseract.js. Card data and prices come
from the free Pokémon TCG API, and exchange rates come from the ECB via Frankfurter. CardCheck has no
accounts, backend or analytics.

**Stack:** TypeScript + Vite + @crxjs/vite-plugin. Typed API responses and a bundler that packages
the MV3 service worker, content script and Tesseract worker/wasm/traineddata are worth more than
avoiding a build step.

---

## Install (load unpacked)

Requirements: Node.js 20+ and Chrome (or another Chromium browser) 120+.

```bash
cd cardcheck
npm install
npm run build        # copies the Tesseract assets, type-checks and builds into dist/
```

Then:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `cardcheck/dist` folder.
4. Pin CardCheck from the puzzle-piece menu if you want quick access to the popup.

After changing code, run `npm run build` again and click the reload icon on the CardCheck card in
`chrome://extensions`.

> `.npmrc` sets `legacy-peer-deps=true` to work around an npm 10 crash (`Cannot read properties of
> null (reading 'edgesOut')`) that vitest's optional peer dependencies trigger.

## Using it

- **Marktplaats / Vinted:** hover over a listing photo, either in search results or on a listing
  page, and click the blue **🔍 Scan** button. A panel opens next to the photo. It shows the card
  image from the API, the name, set and number, the market price (with source and date), the asking
  price it detected on the page, the verdict and a confidence level.
- **Any other site:** right-click an image and choose **CardCheck: scan this image**. The result
  opens in a small window. If no asking price is detected, type it into the panel to get a verdict.
- **Wrong card?** When confidence is low, or several cards match, the panel lists the top 3
  candidates; click one to switch. You can also search by hand, for example
  `charizard ex 125/197`, `pikachu #25` or a card ID such as `sv3-125`.
- **PSA slabs:** CardCheck reads the cert number, grade and label text. With a PSA token in Settings
  it also verifies the cert through the PSA API. For slabs, the price shown is always the
  ungraded value, labelled **"Raw value – graded price not available (free mode)"**. CardCheck never
  estimates a graded price.
- **Popup:** shows your last 50 scans. Click ☆ to **watch** a card. Each time the popup opens,
  watched cards are re-priced and get a ▲/▼/▬ arrow comparing the current price with the price at
  scan time.
- **Settings** (popup → Settings, or right-click the toolbar icon → Options):
  - Currency: EUR, USD, GBP, JPY, CHF, PLN, SEK, DKK or CZK.
  - Deal thresholds.
  - Cardmarket price type: trend, average sell or low.
  - Price source policy (see below).
  - Optional API keys.

Every price shown comes straight from an API response and shows its source and the date the source
last updated it. Converted prices also show the ECB rate date. If the API has no price, the panel
says **No price data**.

## Free API keys (optional)

CardCheck works without any key. Keys only raise rate limits or turn on PSA verification. They are
stored in `chrome.storage.local` in your browser, sent only to the API they belong to, and never
logged.

### Pokémon TCG API key

- Without a key the API works at lower, anonymous rate limits.
- **As of October 2026, new registrations are closed.** The official docs say the API is deprecated
  and will go offline on **1 March 2027**. Keys created earlier at <https://dev.pokemontcg.io> keep
  working until then.
- If you have a key, paste it into Settings → *Pokémon TCG API key*.

### PSA Public API token

1. Create a free account or sign in at <https://www.psacard.com>.
2. Open the Public API page at <https://www.psacard.com/publicapi>, sign in there and generate an
   access token.
3. Paste it into Settings → *PSA Public API token*.

Free accounts get **100 API calls per day**, and CardCheck caches each cert result for 24 hours.
Without a token, slabs are still recognised, but the cert shows as "not verified".

### Exchange rates

Rates come from Frankfurter (`api.frankfurter.dev`, ECB reference rates). No key is needed. Rates are
cached for 12 hours.

## How the price is chosen

Prices come from the Pokémon TCG API card data:

- `cardmarket.prices` in EUR: `trendPrice`, `averageSellPrice` and `lowPrice`.
- `tcgplayer.prices` in USD: the `market` price, falling back to `mid`, for the first available
  variant (holofoil, normal, reverse holofoil, …). The panel shows which variant was used.

In October 2026, the Cardmarket prices in this API were often months old: most cards had last been
updated in November 2025, some in July 2026. TCGplayer prices were updated daily. That is why the
default source policy is **Freshest wins**:

- **Freshest wins** (default): use Cardmarket (EUR) while its price is at most *N* days old (30 by
  default, adjustable). If it is older, use whichever source was updated more recently, converted to
  your currency. The other source is shown underneath for comparison, and a note explains the choice.
- **Always Cardmarket** or **Always TCGplayer**: use that source, falling back to the other only
  when it has no price.

The API reports missing values as `0`. CardCheck treats `0` as "no data", never as a price.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Settings, API keys, 24h card cache, 12h rate cache, scan history |
| `contextMenus` | "CardCheck: scan this image" on any site |
| `activeTab` | Temporary access to the tab where you used the context menu |
| `https://www.marktplaats.nl/*`, `https://www.vinted.nl/*`, `https://www.vinted.com/*` | Content script (Scan button, asking price) |
| `https://*.marktplaats.com/*`, `https://*.vinted.net/*` | The marketplaces' own image CDNs, so the service worker can download listing photos |
| `https://api.pokemontcg.io/*`, `https://api.frankfurter.dev/*`, `https://api.psacard.com/*` | The three APIs |

There are no other host permissions and no remote code. Tesseract's worker, the wasm cores and
`eng.traineddata` ship inside the extension. The extension pages' CSP allows `'wasm-unsafe-eval'`
only so the bundled wasm can compile.

## Known limits

- **OCR accuracy:** OCR runs on the photo itself. Blurry or very small photos, glare (top-loaders,
  sleeves, slab cases), strongly angled cards and busy backgrounds lower accuracy, and the confidence
  level reflects that. The collector number (`125/197`) is the strongest signal. When the photo is
  too small or blurry to read it, CardCheck falls back to the set total plus a fuzzy name match and
  shows the top 3 candidates. A scan takes roughly 8–30 seconds, because 3–4 OCR passes run locally.
- **Lots and bundles:** photos with several cards don't produce a reliable single match.
- **Non-English cards:** the API only has English card data. For other languages, the
  number/total still works but the name doesn't help. Japanese-only cards and promos are often not
  in the API at all.
- **No graded prices in free mode:** no free source for graded prices is known. Slabs show the raw
  (ungraded) value with a clear label, and no graded price or multiplier is ever estimated.
- **Pokémon TCG API:** it is deprecated and goes offline on 1 March 2027. The successor, Scrydex,
  is metered and paid. All card-API code is in `src/lib/tcgapi.ts`, so the source can be swapped in
  one file. The API also returns intermittent 500/502 errors (about half of requests in our tests),
  so CardCheck retries with backoff. Scans can still occasionally fail with "API unavailable – try
  again".
- **Stale Cardmarket data:** see *How the price is chosen*. The date is always shown, so you can
  judge for yourself.
- **Context menu on other sites:** the image has to be downloadable by the extension. `blob:` images
  and images on servers that block cross-origin access can't be scanned.
- **Site changes:** Marktplaats and Vinted change their markup now and then. All selectors are in
  `src/content/selectors.js` (see below). The Marktplaats search and listing pages and the Vinted
  catalog grid were checked against the live sites in October 2026. Vinted's single-listing page
  couldn't be checked from the build environment, so it relies on fallback selectors.
- **Asking price detection** reads the price shown on the tile or listing (for Vinted, the item price
  without buyer protection). Bid-only listings ("Bieden") have no price; type one in to get a verdict.

## Fixing selectors when a site changes

Open `src/content/selectors.js`. Each site has ordered lists of CSS selectors:

- `card`, `cardImage`, `cardPrice`: a tile in search results, its photo and its price.
- `pageGallery`, `pageImage`, `pagePrice`: the photo gallery and price on a single listing.
- `listingPage`: URL patterns of listing pages.
- `upgradeImageUrl`: asks the site's CDN for a larger photo.

The first selector that matches wins, so put a new selector at the front and keep the old ones as
fallbacks. Then run `npm run build` and reload the extension.

## Development

```bash
npm test             # Vitest unit tests (offline)
npm run typecheck
npm run live-check   # live API check: Charizard ex, Obsidian Flames 125/197
npm run build
```

The live check calls the real APIs. If you are behind an HTTP proxy, run it as
`NODE_USE_ENV_PROXY=1 npm run live-check` (supported by recent Node 22 and 24 releases). Set `POKEMONTCG_API_KEY` to use a key.

```
src/
  background/service-worker.ts   context menu, image fetching (avoids page CORS), cache pruning
  content/selectors.js           ALL site selectors (edit here when sites change)
  content/index.ts               Scan button, asking-price detection, overlay iframe placement
  overlay/                       result panel (inline iframe or context-menu window)
  popup/, options/               history + watch list, settings
  lib/
    ocr.ts, preprocess.ts        Tesseract.js + OffscreenCanvas preprocessing (Sauvola threshold)
    collector.ts, slab.ts        collector-number and PSA-label parsing
    names.ts, match.ts, scan.ts  name detection, API queries, ranking, confidence
    tcgapi.ts                    Pokémon TCG API adapter (swap here for another card source)
    pricing.ts                   price selection (freshest wins)
    currency.ts, psa.ts          Frankfurter rates, PSA cert verification
    cache.ts, storage.ts, http.ts  TTL cache, settings/history, retrying fetch
scripts/copy-tesseract.mjs       copies the Tesseract worker, wasm cores and eng traineddata into the build
scripts/make-icons.mjs           regenerates the toolbar icons
```

For debugging, open DevTools on the overlay frame: `globalThis.__cardcheckDebug` holds the raw OCR
text and what was parsed from it.
