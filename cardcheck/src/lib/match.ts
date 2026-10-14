// Turns OCR text into API queries and ranks the returned cards.
import { findCollectorNumbers, parseCollectorNumber, type CollectorNumber } from './collector';
import { extractNameCandidates, nameSimilarity, normalize } from './names';
import { parseSlab, type SlabInfo } from './slab';
import { q, word, type Card } from './tcgapi';

export interface OcrText {
  full: string;
  top: string;
  bottom: string;
}

export interface Parsed {
  collector: CollectorNumber | null;
  slab: SlabInfo;
  names: string[];
  /** All OCR text joined, used for name similarity. */
  allText: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Ranked {
  card: Card;
  score: number;
}

export function parseOcr(o: OcrText): Parsed {
  const allText = [o.top, o.full, o.bottom].join('\n');
  // The bottom strip is where the collector number is printed; prefer it.
  const collector = parseCollectorNumber(o.bottom) ?? parseCollectorNumber(o.full) ?? parseCollectorNumber(o.top);
  const slab = parseSlab([o.top, o.full].join('\n'));
  const names = slab.isSlab && slab.name ? [...new Set([...normalize(slab.name).split(' '), ...extractNameCandidates(o.top)])] : extractNameCandidates([o.top, o.full].join('\n'));
  return { collector, slab, names: names.filter((n) => n.length >= 3).slice(0, 4), allText };
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

/** API queries in order of specificity; the caller runs them until one returns cards. */
export function buildQueries(p: Parsed): string[] {
  const out: string[] = [];
  const number = p.collector?.number ?? p.slab.number;
  const name = p.names[0] ? word(p.names[0]) : '';
  if (p.collector?.total) out.push(`number:${q(p.collector.number)} set.printedTotal:${p.collector.total}`);
  if (number && name) out.push(`number:${q(number)} name:${name}*`);
  if (number && !p.collector?.total) out.push(`number:${q(number)}`);
  for (const n of p.names.slice(0, 3)) {
    const w = word(n);
    if (w.length >= 3) out.push(`name:${w}*`);
  }
  if (number && p.collector?.total) out.push(`number:${q(number)}`);
  return [...new Set(out)];
}

function sameNumber(a: string, b: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/^0+(?=\d)/, '');
  return norm(a) === norm(b);
}

export function rankCards(cards: Card[], p: Parsed): Ranked[] {
  const number = p.collector?.number ?? p.slab.number;
  // Other number readings in the text count a bit, in case the best guess was wrong.
  const altNumbers = findCollectorNumbers(p.allText).map((c) => c.number);
  const ranked = cards.map((card) => {
    let score = 0;
    if (number && sameNumber(card.number, number)) score += 40;
    else if (altNumbers.some((n) => sameNumber(card.number, n))) score += 25;
    if (p.collector?.total && (card.set.printedTotal === p.collector.total || card.set.total === p.collector.total)) score += 20;
    score += 35 * nameSimilarity(card.name, p.slab.name ? `${p.slab.name} ${p.allText}` : p.allText);
    if (p.slab.isSlab) {
      score += 5 * nameSimilarity(card.set.name, p.allText);
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
