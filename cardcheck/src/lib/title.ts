// Hints from the listing title the seller typed, e.g.
// "Kabutops #6/75 - Neo Discovery Holo NM/EXC English" or "Mega Gengar ex SIR Japans 240/193".
import { findCollectorNumbers, type CollectorNumber } from './collector';
import { normalize } from './names';
import type { Lang } from './tcgdex';

export interface TitleHint {
  raw: string;
  collector: CollectorNumber | null;
  /** Likely card-name words, in order (marketplace noise removed). */
  names: string[];
  lang?: Lang;
  /** PSA grade mentioned in the title ("PSA 8" -> "8"). */
  grade?: string;
}

// Words sellers add that are never part of a card name (English + Dutch).
const NOISE = new Set([
  'pokemon', 'kaart', 'kaarten', 'card', 'cards', 'tcg', 'holo', 'reverse', 'rev', 'foil', 'nm', 'mint', 'near',
  'exc', 'excellent', 'good', 'played', 'lp', 'mp', 'hp', 'psa', 'cgc', 'bgs', 'beckett', 'graded', 'gegradeerd',
  'engels', 'english', 'eng', 'japans', 'japanese', 'japan', 'jpn', 'jp', 'chinees', 'chinese', 'korean', 'koreaans',
  'duits', 'german', 'frans', 'french', 'rare', 'secret', 'ultra', 'promo', 'special', 'illustration', 'sir', 'full',
  'art', 'edition', 'first', 'unlimited', 'shadowless', 'lot', 'set', 'series', 'originele', 'origineel', 'original',
  'nieuw', 'new', 'sealed', 'booster', 'black', 'star', 'common', 'uncommon', 'staat', 'conditie', 'condition',
  'front', 'back', 'standard', 'size', 'the', 'and', 'van', 'met', 'voor', 'per', 'stuk', 'verkrijgbaar', 'te', 'koop',
  'gold', 'league', 'championship', 'collection', 'graad', 'grade', 'ir', 'ar', 'sar', 'ur', 'chr', 'tg', 'gg', 'gem',
]);

// Promo / subset numbers written without a set total: "XY122", "SVP 051", "SWSH 090", "SM60".
const PROMO_RE = /(?<![A-Za-z])(XY|SM|SWSH|BW|DP|HGSS|SVP|SV)\s?-?\s?(\d{1,3})(?![0-9/])/i;
const HASH_RE = /#\s?(\d{1,3})(?![0-9/])/;
const LONE_NUMBER_RE = /(?<![\d.,/#])\b(\d{1,3})\b(?![\d.,/%€$])/g;

export function parseTitle(raw: string | null | undefined): TitleHint | null {
  const title = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const lang: Lang | undefined = /\b(japans|japanese|japan|jpn|jap)\b|日本/i.test(title)
    ? 'ja'
    : /\b(engels|english|eng)\b/i.test(title)
      ? 'en'
      : undefined;
  const grade = title.match(/\bPSA\s*(10|[1-9](?:\.5)?)\b/i)?.[1];

  let collector = findCollectorNumbers(title)[0] ?? null;
  let rest = title;
  if (collector) rest = rest.replace(collector.raw, ' ');
  if (!collector) {
    const promo = title.match(PROMO_RE);
    if (promo) {
      const prefix = promo[1].toUpperCase();
      // TCGdex numbers SVP promos as plain digits ("051"), older promo sets with prefix ("XY122").
      const number = prefix === 'SVP' || prefix === 'SV' ? promo[2] : prefix + promo[2];
      collector = { number, total: null, prefix, raw: promo[0], score: 0 };
      rest = rest.replace(promo[0], ' ');
    }
  }
  if (!collector) {
    const hash = title.match(HASH_RE);
    if (hash) {
      collector = { number: hash[1], total: null, raw: hash[0], score: 0 };
      rest = rest.replace(hash[0], ' ');
    }
  }
  if (!collector) {
    // A lone 1-3 digit number that isn't a grade, year or price, e.g. "Jolteon Gold star 101".
    const cleaned = title.replace(/\bPSA\s*\d+(\.5)?\b/gi, ' ').replace(/\b(19|20)\d\d\b/g, ' ');
    const lone = [...cleaned.matchAll(LONE_NUMBER_RE)].map((m) => m[1]).filter((n) => n !== '0');
    if (lone.length === 1) collector = { number: lone[0], total: null, raw: lone[0], score: 0 };
  }

  const names = normalize(rest.replace(/\bPSA\s*\d+(\.5)?\b/gi, ' '))
    .split(' ')
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.has(w));
  return { raw: title, collector, names: [...new Set(names)], lang, grade };
}
