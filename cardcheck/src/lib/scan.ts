// Scan pipeline: image -> OCR -> parse -> API search -> ranked candidates.
import { buildQueries, confidenceOf, parseManual, parseOcr, rankCards, type Confidence, type Parsed, type Ranked } from './match';
import { ocrImage } from './ocr';
import { choosePrice, type PriceChoice, type PricePoint } from './pricing';
import { cache, type Settings } from './storage';
import { getCard, searchCards, type Card } from './tcgapi';
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

async function runQueries(parsed: Parsed, settings: Settings): Promise<Identification> {
  const queries = buildQueries(parsed);
  let lastError: unknown;
  for (const query of queries) {
    try {
      const cards = await searchCards(query, { apiKey: settings.tcgApiKey, cache });
      if (cards.length) {
        const ranked = rankCards(cards, parsed);
        return { parsed, ranked, confidence: confidenceOf(ranked), query };
      }
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError && queries.length) throw new Error('Pokémon TCG API unavailable – try again in a moment');
  return { parsed, ranked: [], confidence: 'low' };
}

export async function identifyImage(blob: Blob, settings: Settings, onProgress?: (s: string) => void): Promise<Identification> {
  const text = await ocrImage(blob, onProgress);
  onProgress?.('Looking up card…');
  return runQueries(parseOcr(text), settings);
}

/** Manual search box: free text like "charizard ex 125/197", or a card ID like "sv3-125". */
export async function identifyManual(input: string, settings: Settings): Promise<Identification> {
  const trimmed = input.trim();
  if (/^[a-z0-9.]+-[a-z0-9]+$/i.test(trimmed)) {
    try {
      const card = await getCard(trimmed.toLowerCase(), { apiKey: settings.tcgApiKey, cache });
      return { parsed: parseManual(trimmed), ranked: [{ card, score: 100 }], confidence: 'high', query: trimmed };
    } catch {
      /* not an ID; fall through to text search */
    }
  }
  return runQueries(parseManual(trimmed), settings);
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
