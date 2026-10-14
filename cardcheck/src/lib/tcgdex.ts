// Card data source adapter: TCGdex (api.tcgdex.net), free, open source, no key.
// English and Japanese card data, with Cardmarket (EUR) and TCGplayer (USD) prices.
// Everything that talks to the card API lives in this file, so the source can be swapped by
// reimplementing getSets(), searchCards() and getCard().
import { type Cache, TTL } from './cache';
import { fetchJson, type FetchLike } from './http';

export const TCGDEX_BASE = 'https://api.tcgdex.net/v2';
export const LANGS = ['en', 'ja'] as const;
export type Lang = (typeof LANGS)[number];

export interface CardmarketPricing {
  updated?: string;
  unit?: string;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  'avg-holo'?: number | null;
  'low-holo'?: number | null;
  'trend-holo'?: number | null;
  [k: string]: unknown;
}

export interface TcgplayerVariant {
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
}

export interface Pricing {
  cardmarket?: CardmarketPricing | null;
  /** Keys besides unit/updated are variants: normal, holofoil, reverse-holofoil, … */
  tcgplayer?: ({ updated?: string; unit?: string } & Record<string, unknown>) | null;
}

export interface Card {
  id: string;
  lang: Lang;
  name: string;
  /** Number as printed (localId), e.g. "125", "027", "TG05", "H19". */
  number: string;
  rarity?: string;
  set: { id: string; name: string; printedTotal?: number; total?: number };
  images?: { small?: string; large?: string };
  /** Only on full cards (from getCard); search results are brief. */
  pricing?: Pricing;
  brief?: boolean;
}

export interface CardSet {
  id: string;
  name: string;
  cardCount?: { official?: number; total?: number };
}

export interface ApiOptions {
  cache: Cache;
  fetchFn?: FetchLike;
}

interface BriefCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

interface FullCard extends BriefCard {
  rarity?: string;
  set: CardSet;
  pricing?: Pricing;
}

function images(base?: string): Card['images'] {
  return base ? { small: `${base}/low.webp`, large: `${base}/high.webp` } : undefined;
}

/** "sv03.5-025" -> "sv03.5" */
export function setIdOf(cardId: string): string {
  return cardId.slice(0, cardId.lastIndexOf('-'));
}

/** All sets of a language (id, name, card counts); cached 24h. */
export async function getSets(lang: Lang, o: ApiOptions): Promise<Map<string, CardSet>> {
  const key = `tcgdex:sets:${lang}`;
  let sets = await o.cache.get<CardSet[]>(key, TTL.card);
  if (!sets) {
    sets = (await fetchJson<CardSet[]>(`${TCGDEX_BASE}/${lang}/sets`, {}, o.fetchFn)).map((s) => ({ id: s.id, name: s.name, cardCount: s.cardCount }));
    await o.cache.set(key, sets);
  }
  return new Map(sets.map((s) => [s.id, s]));
}

export function fromBrief(b: BriefCard, lang: Lang, sets: Map<string, CardSet>): Card {
  const set = sets.get(setIdOf(b.id));
  return {
    id: b.id,
    lang,
    name: b.name,
    number: b.localId,
    set: { id: setIdOf(b.id), name: set?.name ?? setIdOf(b.id), printedTotal: set?.cardCount?.official || undefined, total: set?.cardCount?.total },
    images: images(b.image),
    brief: true,
  };
}

export function fromFull(c: FullCard, lang: Lang): Card {
  return {
    id: c.id,
    lang,
    name: c.name,
    number: c.localId,
    rarity: c.rarity,
    set: { id: c.set.id, name: c.set.name, printedTotal: c.set.cardCount?.official || undefined, total: c.set.cardCount?.total },
    images: images(c.image),
    pricing: c.pricing,
  };
}

/** Full card with prices; cached per card ID for 24h unless force is set. */
export async function getCard(id: string, lang: Lang, o: ApiOptions & { force?: boolean }): Promise<Card> {
  const key = `tcgdex:card:${lang}:${id}`;
  if (!o.force) {
    const cached = await o.cache.get<Card>(key, TTL.card);
    if (cached) return cached;
  }
  const raw = await fetchJson<FullCard>(`${TCGDEX_BASE}/${lang}/cards/${encodeURIComponent(id)}`, {}, o.fetchFn);
  const card = fromFull(raw, lang);
  await o.cache.set(key, card);
  return card;
}

export const MAX_RESULTS = 250;

/**
 * Card search with TCGdex filters, e.g. { localId: '125', 'set.cardCount.official': '197' }
 * or { name: 'arizar' } (filters are substring matches unless prefixed, e.g. "eq:").
 * Returns brief cards (no prices); the list is cached 24h.
 */
export async function searchCards(filters: Record<string, string>, lang: Lang, o: ApiOptions): Promise<Card[]> {
  const params = new URLSearchParams(filters);
  const key = `tcgdex:search:${lang}:${params}`;
  let list = await o.cache.get<BriefCard[]>(key, TTL.search);
  if (!list) {
    list = (await fetchJson<BriefCard[]>(`${TCGDEX_BASE}/${lang}/cards?${params}`, {}, o.fetchFn)).slice(0, MAX_RESULTS);
    list = list.map((b) => ({ id: b.id, localId: b.localId, name: b.name, image: b.image }));
    await o.cache.set(key, list);
  }
  const sets = await getSets(lang, o);
  return list.map((b) => fromBrief(b, lang, sets));
}

/** Sanitises a word for a name filter. */
export function word(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\-]/gu, '');
}
