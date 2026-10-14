// Turns OCR text into API queries and ranks the returned cards.
import { findCollectorNumbers, findTotalHints, parseCollectorNumber, type CollectorNumber } from './collector';
import { extractNameCandidates, isNameWord, nameSimilarity, normalize } from './names';
import { parseSlab, type SlabInfo } from './slab';
import { q, word, type Card } from './tcgapi';

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

export function parseOcr(o: OcrText): Parsed {
  const allText = [o.top, o.full, o.bottom].join('\n');
  // The bottom strip is where the collector number is printed; prefer it.
  const collector = parseCollectorNumber(o.bottom) ?? parseCollectorNumber(o.full) ?? parseCollectorNumber(o.top);
  const slab = parseSlab([o.top, o.full].join('\n'));
  const fromSlab = slab.isSlab && slab.name ? normalize(slab.name).split(' ') : [];
  // Drop candidates Tesseract itself was unsure about (OCR junk like "coudticirit").
  const conf = new Map<string, number>();
  for (const w of o.words ?? []) {
    const n = normalize(w.text);
    conf.set(n, Math.max(conf.get(n) ?? 0, w.conf));
  }
  const names = [...new Set([...fromSlab, ...namesFromWords(o.words ?? []), ...extractNameCandidates([o.top, o.full].join('\n'))])].filter(
    (n) => (conf.get(n) ?? 100) >= 60,
  );
  const totalHints = collector ? [] : [...new Set([...findTotalHints(o.bottom), ...findTotalHints(o.full)])].slice(0, 2);
  return { collector, slab, names: names.filter((n) => n.length >= 3).slice(0, 4), totalHints, allText };
}

/** Parses a manual search like "charizard ex 125/197" or "pikachu #25". */
export function parseManual(input: string): Parsed {
  const collector = parseCollectorNumber(input);
  const hash = input.match(/#\s?([A-Za-z]{0,4}\d{1,3})\b/)?.[1];
  const rest = input.replace(collector?.raw ?? '', ' ').replace(/#\s?\w+/, ' ');
  const names = normalize(rest).split(' ').filter((w) => w.length >= 2);
  const loneNumber = !collector && !hash ? rest.match(/\b(\d{1,3})\b/)?.[1] : undefined;
  return {
    collector: collector ?? (hash || loneNumber ? { number: (hash || loneNumber)!.replace(/^0+(?=\d)/, ''), total: null, raw: '', score: 0 } : null),
    slab: { isSlab: false },
    names: names.filter((w) => !/^\d+$/.test(w)),
    allText: input,
  };
}

function numberOf(p: Parsed): string | undefined {
  return p.collector?.number ?? (p.slab.isSlab ? p.slab.number : undefined);
}

export interface Query {
  q: string;
  pageSize?: number;
}

/** Name clause tolerant to OCR errors at word edges: "harizard" -> name:*arizar*. */
export function nameClause(n: string): string {
  const w = word(n);
  return w.length >= 6 ? `name:*${w.slice(1, -1)}*` : `name:${w}*`;
}

/** API queries from most to least specific; the caller merges results until confident. */
export function buildQueries(p: Parsed): Query[] {
  const out: string[] = [];
  const number = numberOf(p);
  const name = p.names[0] && word(p.names[0]).length >= 3 ? nameClause(p.names[0]) : '';
  const total = p.collector?.total ?? p.totalHints?.[0];
  if (p.collector?.total) out.push(`number:${q(p.collector.number)} set.printedTotal:${p.collector.total}`);
  if (number && name) out.push(`number:${q(number)} ${name}`);
  // The total survives misread numbers ("11/108" read as "1/108" or "1108").
  if (name && p.collector?.total) out.push(`set.printedTotal:${p.collector.total} ${name}`);
  for (const t of p.totalHints ?? []) if (name) out.push(`set.printedTotal:${t} ${name}`);
  // Whole set(s) with that printed total, ranked by fuzzy name match against all OCR text.
  if (total) out.push(`set.printedTotal:${total}`);
  for (const n of p.names.slice(0, 2)) if (word(n).length >= 3) out.push(nameClause(n));
  // Number alone matches a card in nearly every set: last resort.
  if (number) out.push(`number:${q(number)}`);
  return [...new Set(out)].map((query) => (/^set\.printedTotal:\d+$/.test(query) ? { q: query, pageSize: 250 } : { q: query }));
}

function sameNumber(a: string, b: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/^0+(?=\d)/, '');
  return norm(a) === norm(b);
}

/** Removes "Evolves from Charmeleon"-style text so the pre-evolution's name doesn't count. */
export function stripEvolvesFrom(text: string): string {
  return text
    .replace(/\bevol\w*\b[\s\S]{0,12}?\bf?rom\s+\S+/gi, ' ')
    .replace(/\bevolve\s+da\s+\S+/gi, ' ')
    .replace(/\bentwickelt\s+sich\s+aus\s+\S+/gi, ' ')
    .replace(/\b[ée]volue\s+de\s+\S+/gi, ' ');
}

export function rankCards(cards: Card[], p: Parsed): Ranked[] {
  const number = numberOf(p);
  const text = stripEvolvesFrom(p.allText);
  // Other number readings in the text count a bit, in case the best guess was wrong.
  const altNumbers = findCollectorNumbers(p.allText).map((c) => c.number);
  const ranked = cards.map((card) => {
    let score = 0;
    if (number && sameNumber(card.number, number)) score += 40;
    else if (altNumbers.some((n) => sameNumber(card.number, n))) score += 25;
    if (p.collector?.total && (card.set.printedTotal === p.collector.total || card.set.total === p.collector.total)) score += 20;
    else if (p.totalHints?.some((t) => card.set.printedTotal === t)) score += 12;
    score += 35 * nameSimilarity(card.name, p.slab.name ? `${p.slab.name} ${text}` : text);
    if (p.slab.isSlab) {
      score += 5 * nameSimilarity(card.set.name, text);
      if (p.slab.year && card.set.releaseDate?.startsWith(p.slab.year)) score += 3;
    }
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
