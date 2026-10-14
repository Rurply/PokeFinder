// Scan pipeline: image -> OCR -> parse -> API search -> ranked candidates.
import { buildQueries, confidenceOf, parseManual, parseOcr, rankCards, type Confidence, type Parsed, type Ranked } from './match';
import { ocrImage } from './ocr';
import { choosePrice, type PriceChoice, type PricePoint } from './pricing';
import { cache, type Settings } from './storage';
import { getCard, LANGS, searchCards, type Card, type Lang } from './tcgdex';
import { convert, getRates, type Rates } from './currency';

export interface Identification {
  parsed: Parsed;
  ranked: Ranked[];
  confidence: Confidence;
  /** The query that produced the candidates. */
  query?: string;
}

export type FetchImageResponse = { ok: true; base64: string; type: string } | { ok: false; error: string };

/** Fetches the image through the service worker (extension host permissions avoid CORS). */
export async function fetchImageViaWorker(url: string): Promise<Blob> {
  const r = (await chrome.runtime.sendMessage({ type: 'cardcheck:fetchImage', url })) as FetchImageResponse | undefined;
  if (!r) throw new Error('Background worker did not respond');
  if (!r.ok) throw new Error(r.error);
  const bin = atob(r.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: r.type });
}

const MAX_QUERIES = 8;

/**
 * Runs queries from most to least specific, merging results, until the best match is
 * high-confidence (a misread number can make the first query return the wrong cards).
 */
async function runQueries(parsed: Parsed): Promise<Identification> {
  const queries = buildQueries(parsed).slice(0, MAX_QUERIES);
  const seen = new Map<string, Card>();
  const used: string[] = [];
  let best: Identification | null = null;
  let lastError: unknown;
  for (const query of queries) {
    try {
      const cards = await searchCards(query.filters, query.lang, { cache });
      if (!cards.length) continue;
      used.push(`${query.lang}:${new URLSearchParams(query.filters)}`);
      for (const c of cards) seen.set(`${c.lang}:${c.id}`, c);
      const ranked = rankCards([...seen.values()], parsed);
      best = { parsed, ranked, confidence: confidenceOf(ranked), query: used.join(' | ') };
      if (best.confidence === 'high') break;
    } catch (e) {
      lastError = e;
    }
  }
  if (best) return best;
  if (lastError) throw new Error('Card database (TCGdex) unavailable – try again in a moment');
  return { parsed, ranked: [], confidence: 'low' };
}

/** Identifies the card in a photo, using the listing title as an extra hint when there is one. */
export async function identifyImage(blob: Blob, title: string | null, onProgress?: (s: string) => void): Promise<Identification> {
  const text = await ocrImage(blob, onProgress);
  onProgress?.('Looking up card…');
  const parsed = parseOcr(text, title);
  // Debug aid (inspect the overlay frame in DevTools): raw OCR text and what was parsed.
  (globalThis as { __cardcheckDebug?: unknown }).__cardcheckDebug = { text, parsed };
  return runQueries(parsed);
}

/** Manual search box: free text like "charizard ex 125/197", or a card ID like "sv03-125" / "SV2a-025". */
export async function identifyManual(input: string): Promise<Identification> {
  const trimmed = input.trim();
  if (/^[a-z0-9.]+-[a-z0-9]+$/i.test(trimmed)) {
    for (const lang of LANGS) {
      try {
        const card = await getCard(trimmed, lang, { cache });
        return { parsed: parseManual(trimmed), ranked: [{ card, score: 100 }], confidence: 'high', query: trimmed };
      } catch {
        /* not an ID in this language */
      }
    }
  }
  return runQueries(parseManual(trimmed));
}

/** Search results are brief; this loads the full card with prices. */
export async function fullCard(card: Card): Promise<Card> {
  return card.brief ? getCard(card.id, card.lang, { cache }) : card;
}

export function langLabel(lang: Lang): string {
  return lang === 'ja' ? 'Japanese' : 'English';
}

export interface Priced {
  choice: PriceChoice;
  /** Primary price converted to the user's currency (null if no price or no rate). */
  converted: number | null;
  rates: Rates | null;
}

export async function priceFor(card: Card, settings: Settings): Promise<Priced> {
  const choice = choosePrice(card, { metric: settings.cmMetric, policy: settings.sourcePolicy, freshnessDays: settings.freshnessDays });
  let rates: Rates | null = null;
  let converted: number | null = null;
  if (choice.primary) {
    if (choice.primary.currency === settings.currency) converted = choice.primary.amount;
    else {
      rates = await getRates(cache).catch(() => null);
      converted = rates ? convert(choice.primary.amount, choice.primary.currency, settings.currency, rates) : null;
    }
  }
  return { choice, converted, rates };
}

export function samePriceSeries(a: PricePoint | null | undefined, b: PricePoint | null | undefined): boolean {
  return !!a && !!b && a.source === b.source && a.metric === b.metric && a.currency === b.currency;
}
