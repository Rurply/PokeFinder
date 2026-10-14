// Turns OCR text and the listing title into card-API queries and ranks the returned cards.
import { findCollectorNumbers, findTotalHints, parseCollectorNumber, type CollectorNumber } from './collector';
import { extractNameCandidates, isNameWord, nameSimilarity, normalize } from './names';
import { parseSlab, type SlabInfo } from './slab';
import type { Card, Lang } from './tcgdex';
import { word } from './tcgdex';
import { parseTitle, type TitleHint } from './title';

export interface OcrWord {
  text: string;
  conf: number;
  /** Bounding-box height in px (of the preprocessed region). */
  h: number;
  x: number;
  y: number;
  region: 'full' | 'top' | 'bottom';
}

export interface OcrText {
  full: string;
  top: string;
  bottom: string;
  words?: OcrWord[];
}

export interface Parsed {
  collector: CollectorNumber | null;
  slab: SlabInfo;
  names: string[];
  /** Set totals read from collector numbers whose slash was lost (weak signal). */
  totalHints?: number[];
  /** All OCR text joined, used for name similarity. */
  allText: string;
  /** Hints from the listing title (or the manual search text). */
  title?: TitleHint | null;
  /** Card language guessed from the title or the OCR text. */
  lang?: Lang;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Ranked {
  card: Card;
  score: number;
}

/**
 * Card names are the largest text on the card: take the tallest confident words, from the
 * top strip first, then the full image.
 */
export function namesFromWords(words: OcrWord[]): string[] {
  const out: string[] = [];
  for (const region of ['top', 'full'] as const) {
    const ws = words.filter((w) => w.region === region && w.conf >= 60 && isNameWord(w.text));
    if (!ws.length) continue;
    const maxH = Math.max(...ws.map((w) => w.h));
    const tallest = ws.filter((w) => w.h >= maxH * 0.75).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const w of tallest) {
      const n = normalize(w.text);
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}

const EVOLVES_FROM = [
  /\bevol\w*\b[\s\S]{0,12}?\bf?rom\s+(\S+)/gi,
  /\bevolve\s+da\s+(\S+)/gi,
  /\bentwickelt\s+sich\s+aus\s+(\S+)/gi,
  /\b[ée]volue\s+de\s+(\S+)/gi,
];

/** Removes "Evolves from Charmeleon"-style text so the pre-evolution's name doesn't count. */
export function stripEvolvesFrom(text: string): string {
  return EVOLVES_FROM.reduce((t, re) => t.replace(re, ' '), text);
}

/** Names that appear only as "Evolves from X" (the pre-evolution). */
function preEvolutions(text: string): Set<string> {
  const out = new Set<string>();
  for (const re of EVOLVES_FROM) for (const m of text.matchAll(re)) out.add(normalize(m[1]));
  return out;
}

// English rules-text words: several of them mean the card is English.
const ENGLISH_WORDS = /\b(weakness|resistance|retreat|damage|attack|opponent|energy|ability|basic|evolves|your|pok[eé]mon|illus)\b/gi;

export function guessLangFromOcr(text: string): Lang | undefined {
  return (text.match(ENGLISH_WORDS)?.length ?? 0) >= 3 ? 'en' : undefined;
}

export function parseOcr(o: OcrText, titleText?: string | null): Parsed {
  const allText = [o.top, o.full, o.bottom].join('\n');
  // The bottom strip is where the collector number is printed; prefer it.
  const collector = parseCollectorNumber(o.bottom) ?? parseCollectorNumber(o.full) ?? parseCollectorNumber(o.top);
  const slab = parseSlab([o.top, o.full].join('\n'));
  const fromSlab = slab.isSlab && slab.name ? normalize(slab.name).split(' ') : [];
  // Drop candidates Tesseract itself was unsure about (OCR junk like "coudticirit"), and the
  // pre-evolution named in "Evolves from Eevee".
  const conf = new Map<string, number>();
  for (const w of o.words ?? []) {
    const n = normalize(w.text);
    conf.set(n, Math.max(conf.get(n) ?? 0, w.conf));
  }
  const pre = preEvolutions(allText);
  const names = [...new Set([...fromSlab, ...namesFromWords(o.words ?? []), ...extractNameCandidates([o.top, o.full].join('\n'))])].filter(
    (n) => (conf.get(n) ?? 100) >= 60 && !pre.has(n),
  );
  const totalHints = collector ? [] : [...new Set([...findTotalHints(o.bottom), ...findTotalHints(o.full)])].slice(0, 2);
  const title = parseTitle(titleText);
  // "PSA 8" in the listing title: treat as a slab even if the label wasn't readable.
  const slabInfo: SlabInfo = !slab.isSlab && title?.grade ? { isSlab: true, grade: title.grade, cert: slab.cert } : slab;
  return {
    collector,
    slab: slabInfo,
    names: names.filter((n) => n.length >= 3).slice(0, 4),
    totalHints,
    allText,
    title,
    lang: title?.lang ?? guessLangFromOcr(allText),
  };
}

/** Manual search like "charizard ex 125/197", "pikachu #25" or "メガゲンガー 240/193". */
export function parseManual(input: string): Parsed {
  const title = parseTitle(input);
  const lang: Lang | undefined = /[぀-ヿ一-鿿]/.test(input) ? 'ja' : title?.lang;
  return { collector: null, slab: { isSlab: false }, names: [], allText: '', title, lang };
}

function ocrNumber(p: Parsed): string | undefined {
  return p.collector?.number ?? (p.slab.isSlab ? p.slab.number : undefined);
}

export interface Query {
  lang: Lang;
  filters: Record<string, string>;
}

/** Name filter tolerant to OCR errors at word edges: "harizard" -> "arizar" (substring match). */
export function nameFilter(n: string): string {
  const w = word(n);
  return w.length >= 6 ? w.slice(1, -1) : w;
}

/** API queries from most to least specific; the caller merges results until confident. */
export function buildQueries(p: Parsed): Query[] {
  const numbers: Array<{ number: string; total: number | null }> = [];
  for (const c of [p.title?.collector, p.collector]) if (c && !numbers.some((n) => n.number === c.number && n.total === c.total)) numbers.push({ number: c.number, total: c.total });
  const slabNumber = p.slab.isSlab ? p.slab.number : undefined;
  if (slabNumber && !numbers.some((n) => n.number === slabNumber)) numbers.push({ number: slabNumber, total: null });

  const names = [...new Set([...(p.title?.names ?? []), ...p.names])].filter((n) => word(n).length >= 3);
  const name = names[0];
  const totals = [...new Set([...numbers.map((n) => n.total).filter((t): t is number => !!t), ...(p.totalHints ?? [])])];

  const en: Array<Record<string, string>> = [];
  for (const n of numbers) {
    if (n.total) en.push({ localId: n.number, 'set.cardCount.official': String(n.total) });
    if (name) en.push({ localId: n.number, name: nameFilter(name) });
    // Promo-style numbers ("XY122", "H19") are specific enough on their own.
    if (!n.total && /^[A-Z]{1,4}\d+$/i.test(n.number)) en.push({ localId: n.number });
  }
  // The total survives misread numbers ("11/108" read as "1/108" or "1108").
  for (const t of totals) if (name) en.push({ 'set.cardCount.official': String(t), name: nameFilter(name) });
  for (const n of names.slice(0, 2)) en.push({ name: nameFilter(n) });
  // Whole set(s) with that printed total, ranked by fuzzy name match against all OCR text.
  if (totals[0]) en.push({ 'set.cardCount.official': String(totals[0]) });

  // Japanese card data has Japanese names, so only number + set total can find those cards.
  const ja = numbers.filter((n) => n.total).map((n) => ({ localId: n.number, 'set.cardCount.official': String(n.total) }));

  const out: Query[] = [];
  const add = (lang: Lang, filters: Record<string, string>) => {
    if (!out.some((q) => q.lang === lang && JSON.stringify(q.filters) === JSON.stringify(filters))) out.push({ lang, filters });
  };
  if (p.lang === 'ja') {
    ja.forEach((f) => add('ja', f));
    en.forEach((f) => add('en', f));
  } else {
    // English first; Japanese right after the number queries for cards that turn out Japanese.
    en.slice(0, 2).forEach((f) => add('en', f));
    ja.forEach((f) => add('ja', f));
    en.slice(2).forEach((f) => add('en', f));
  }
  return out;
}

function sameNumber(a: string, b: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, '$1');
  return norm(a) === norm(b);
}

export function rankCards(cards: Card[], p: Parsed): Ranked[] {
  const t = p.title;
  const numbers = [t?.collector?.number, ocrNumber(p)].filter((n): n is string => !!n);
  const totals = [t?.collector?.total, p.collector?.total].filter((n): n is number => !!n);
  const ocrText = stripEvolvesFrom(p.allText);
  // Other number readings in the text count a bit, in case the best guess was wrong.
  const altNumbers = findCollectorNumbers(p.allText).map((c) => c.number);
  const ranked = cards.map((card) => {
    let score = 0;
    if (numbers.some((n) => sameNumber(card.number, n))) score += 40;
    else if (altNumbers.some((n) => sameNumber(card.number, n))) score += 25;
    const subset = [t?.collector, p.collector].some((c) => c?.prefix && c.total && card.number.toUpperCase().startsWith(c.prefix));
    // Subset cards ("H19/H32", "TG05/TG30") have their own total, which the card data doesn't list.
    if (subset || totals.some((x) => card.set.printedTotal === x || card.set.total === x)) score += 20;
    else if (p.totalHints?.some((x) => card.set.printedTotal === x)) score += 12;
    // A clearly read set total that doesn't fit is evidence against the card.
    else if (totals.length && !/^[A-Z]/i.test(card.number)) score -= 15;
    const nameScore = Math.max(
      t ? nameSimilarity(card.name, t.raw) : 0,
      nameSimilarity(card.name, p.slab.name ? `${p.slab.name} ${ocrText}` : ocrText),
    );
    score += 35 * nameScore;
    // A set name the seller wrote ("Neo Discovery", "Power Keepers") separates same-numbered cards.
    if (t && nameSimilarity(card.set.name, t.raw) >= 0.85) score += 10;
    // The seller saying "Japans"/"English" is stronger evidence than guessing from OCR text.
    if (p.lang) score += card.lang === p.lang ? 6 : t?.lang ? -20 : -6;
    if (p.slab.isSlab) score += 5 * nameSimilarity(card.set.name, ocrText);
    return { card, score: Math.round(score * 10) / 10 };
  });
  return ranked.sort((a, b) => b.score - a.score);
}

export function confidenceOf(ranked: Ranked[]): Confidence {
  const [a, b] = ranked;
  if (!a) return 'low';
  const gap = b ? a.score - b.score : Infinity;
  if (a.score >= 80 && gap >= 15) return 'high';
  if (a.score >= 55 && gap >= 5) return 'medium';
  return 'low';
}
