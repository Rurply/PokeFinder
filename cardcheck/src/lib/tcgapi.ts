// Card data source adapter: Pokémon TCG API v2 (api.pokemontcg.io).
//
// The API is deprecated and scheduled to go offline on 2027-03-01 (successor: Scrydex,
// which is metered/paid). Everything that talks to the card API lives in this file so the
// source can be swapped by reimplementing searchCards() and getCard().
import { type Cache, TTL } from './cache';
import { fetchJson, type FetchLike } from './http';

export const TCG_API_BASE = 'https://api.pokemontcg.io/v2';
const SELECT = 'id,name,number,rarity,set,images,cardmarket,tcgplayer';

export interface CardmarketPrices {
  averageSellPrice?: number;
  lowPrice?: number;
  trendPrice?: number;
  [k: string]: number | undefined;
}

export interface TcgplayerVariant {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  directLow?: number | null;
}

export interface Card {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: { id: string; name: string; series?: string; printedTotal?: number; total?: number; releaseDate?: string };
  images?: { small?: string; large?: string };
  cardmarket?: { url?: string; updatedAt?: string; prices?: CardmarketPrices };
  tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, TcgplayerVariant> };
}

export interface TcgApiOptions {
  apiKey?: string;
  cache: Cache;
  fetchFn?: FetchLike;
}

function headers(apiKey?: string): HeadersInit {
  return apiKey ? { 'X-Api-Key': apiKey } : {};
}

/** Fetches one card by ID; cached per card ID for 24h unless force is set. */
export async function getCard(id: string, o: TcgApiOptions & { force?: boolean }): Promise<Card> {
  if (!o.force) {
    const cached = await o.cache.get<Card>(`card:${id}`, TTL.card);
    if (cached) return cached;
  }
  const url = `${TCG_API_BASE}/cards/${encodeURIComponent(id)}?select=${SELECT}`;
  const res = await fetchJson<{ data: Card }>(url, { headers: headers(o.apiKey) }, o.fetchFn);
  await o.cache.set(`card:${id}`, res.data);
  return res.data;
}

/**
 * Runs a Lucene-style query (e.g. `number:"125" set.printedTotal:197`). The result list is
 * cached as card IDs for 24h, and every returned card is cached under its own ID.
 */
export async function searchCards(q: string, o: TcgApiOptions & { pageSize?: number }): Promise<Card[]> {
  const pageSize = o.pageSize ?? 30;
  // Whole-set listings (up to 250 cards) are a fallback; caching them would eat the
  // 10 MB chrome.storage.local quota.
  const cacheable = pageSize <= 50;
  const key = `search:${pageSize}:${q}`;
  const ids = cacheable ? await o.cache.get<string[]>(key, TTL.search) : undefined;
  if (ids) {
    const cards = await Promise.all(ids.map((id) => o.cache.get<Card>(`card:${id}`, TTL.card)));
    if (cards.every(Boolean)) return cards as Card[];
  }
  const params = new URLSearchParams({ q, pageSize: String(pageSize), orderBy: '-set.releaseDate', select: SELECT });
  const res = await fetchJson<{ data: Card[] }>(`${TCG_API_BASE}/cards?${params}`, { headers: headers(o.apiKey) }, o.fetchFn);
  if (cacheable) {
    for (const c of res.data) await o.cache.set(`card:${c.id}`, c);
    await o.cache.set(key, res.data.map((c) => c.id));
  }
  return res.data;
}

/** Quotes a value for the query syntax, dropping characters that would break it. */
export function q(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/** Sanitises a single word for a wildcard query like name:char*. */
export function word(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\-]/g, '');
}
