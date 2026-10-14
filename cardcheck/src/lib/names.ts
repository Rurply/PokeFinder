// Name guesses from OCR text, plus fuzzy string helpers used for ranking.

const STOP = new Set([
  'basic', 'stage', 'evolves', 'from', 'pokemon', 'trainer', 'item', 'supporter', 'stadium',
  'energy', 'ability', 'illus', 'weakness', 'resistance', 'retreat', 'rule', 'when', 'your',
  'the', 'and', 'this', 'card', 'cards', 'tera', 'put', 'onto', 'bench', 'damage', 'attack',
  'prize', 'opponent', 'knocked', 'out', 'psa', 'gem', 'mint', 'with', 'that', 'for', 'each',
  'more', 'does', 'turn', 'during', 'may', 'search', 'deck', 'then', 'shuffle', 'holo', 'rare',
  'nintendo', 'creatures', 'game', 'freak', 'japan', 'graphics', 'all', 'hand', 'discard',
  'stages', 'evolve', 'evol', 'fase', 'phase', 'pokemon',
]);

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A word that could be part of a card name (not a rules/label word or OCR junk). */
export function isNameWord(raw: string): boolean {
  const w = raw.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ'’]+$/g, '');
  if (w.length < 3 || !/^[A-Za-zÀ-ÿ'’\-]+$/.test(w)) return false;
  const n = normalize(w);
  return n.length >= 3 && !STOP.has(n) && /^[A-ZÀ-Þ]/.test(w);
}

/** Up to 4 likely card-name words from OCR text, in reading order. */
export function extractNameCandidates(text: string): string[] {
  const out: string[] = [];
  for (const line of (text || '').split(/\n/)) {
    const words = line.match(/[A-Za-zÀ-ÿ'’]{3,}/g) ?? [];
    for (const w of words) {
      const n = normalize(w);
      if (n.length < 3 || STOP.has(n) || out.includes(n)) continue;
      // Card names start with a capital; OCR'd body text is mostly lowercase.
      if (!/^[A-ZÀ-Þ]/.test(w) && n.length < 6) continue;
      out.push(n);
      if (out.length >= 4) return out;
    }
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const SUFFIXES = new Set(['ex', 'v', 'gx', 'vmax', 'vstar', 'break', 'lv', 'x', 'star', 'prime']);

/** 0..1: how well a card name is supported by the OCR text (tolerant to OCR typos). */
export function nameSimilarity(cardName: string, ocrText: string): number {
  const nameTokens = normalize(cardName).split(' ').filter(Boolean);
  const textTokens = normalize(ocrText).split(' ').filter((t) => t.length >= 2);
  if (!nameTokens.length || !textTokens.length) return 0;
  let total = 0;
  let weightSum = 0;
  for (const nt of nameTokens) {
    const weight = SUFFIXES.has(nt) ? 0.3 : nt.length;
    let best = 0;
    for (const tt of textTokens) {
      // One wrong letter in a short word is as likely to be noise as a match.
      const sim = nt.length < 5 ? (nt === tt ? 1 : 0) : 1 - levenshtein(nt, tt) / Math.max(nt.length, tt.length);
      if (sim > best) best = sim;
      if (best === 1) break;
    }
    total += best * weight;
    weightSum += weight;
  }
  return weightSum ? total / weightSum : 0;
}
