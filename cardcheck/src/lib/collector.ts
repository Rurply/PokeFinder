// Collector-number parsing for OCR output, e.g. "O25/l65" -> { number: "25", total: 165 }.

export interface CollectorNumber {
  /** Number as the Pokémon TCG API stores it: "25", "125", "TG05". */
  number: string;
  /** Printed set total (the part after the slash), when present. */
  total: number | null;
  /** Letter prefix for subset cards (TG, GG, SV, RC), if any. */
  prefix?: string;
  /** The matched OCR fragment. */
  raw: string;
  /** Internal plausibility score; higher is better. */
  score: number;
}

// Characters OCR commonly produces instead of digits.
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  l: '1', I: '1', i: '1', L: '1', '!': '1',
  Z: '2', z: '2',
  S: '5', s: '5', $: '5',
  G: '6', b: '6',
  T: '7',
  B: '8',
  g: '9', q: '9',
};

const CH = '[0-9OoQDlIiL!ZzSs$GbTBgq]';
const SEP = '\\s*[\\/\\\\⁄]\\s*';
const PLAIN_RE = new RegExp(`(?<![0-9])(${CH}{1,3})${SEP}(${CH}{2,3})(?![0-9])`, 'g');
const PREFIX_RE = new RegExp(
  `(?<![A-Za-z])(TG|GG|SV|RC|H)\\s?(${CH}{1,3})${SEP}(?:TG|GG|SV|RC|H)?\\s?(${CH}{2,3})(?![0-9])`,
  'gi',
);

/** Maps OCR look-alike characters to digits. Returns null if a character can't be mapped. */
export function toDigits(s: string): { digits: string; substitutions: number } | null {
  let digits = '';
  let substitutions = 0;
  for (const c of s) {
    if (c >= '0' && c <= '9') digits += c;
    else if (DIGIT_LOOKALIKES[c]) {
      digits += DIGIT_LOOKALIKES[c];
      substitutions++;
    } else return null;
  }
  return { digits, substitutions };
}

function stripZeros(d: string): string {
  const s = d.replace(/^0+/, '');
  return s === '' ? '0' : s;
}

/** Returns every plausible collector number in the text, best first. */
export function findCollectorNumbers(text: string): CollectorNumber[] {
  const out: CollectorNumber[] = [];
  if (!text) return out;

  for (const m of text.matchAll(PREFIX_RE)) {
    const num = toDigits(m[2]);
    const tot = toDigits(m[3]);
    if (!num || !tot) continue;
    const total = parseInt(tot.digits, 10);
    if (total < 10 || total > 400) continue;
    const prefix = m[1].toUpperCase();
    // Aquapolis/Skyridge holos are numbered H1..H32 without padding.
    const width = prefix === 'H' ? 1 : Math.max(2, num.digits.length);
    out.push({
      number: prefix + num.digits.padStart(width, '0'),
      total,
      prefix,
      raw: m[0],
      score: 10 - num.substitutions - tot.substitutions,
    });
  }

  for (const m of text.matchAll(PLAIN_RE)) {
    const num = toDigits(m[1]);
    const tot = toDigits(m[2]);
    if (!num || !tot) continue;
    const genuine = m[1].length - num.substitutions + (m[2].length - tot.substitutions);
    // Require real digits: rejects word fragments like "Is/Is".
    if (genuine < 2 || tot.substitutions >= m[2].length) continue;
    const n = parseInt(num.digits, 10);
    const total = parseInt(tot.digits, 10);
    if (n < 1 || total < 10 || total > 400 || n > 450) continue;
    // Skip fragments already covered by a prefixed match.
    if (out.some((o) => o.prefix && o.raw.includes(m[0].trim()))) continue;
    let score = genuine * 2 - (num.substitutions + tot.substitutions);
    if (m[1].length === m[2].length) score += 2; // zero-padded like "025/165"
    if (m[2].length === 3) score += 1;
    if (n <= total * 1.6) score += 1; // secret rares exceed the total, but not by much
    out.push({ number: stripZeros(num.digits), total, raw: m[0], score });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Best collector number in the text, or null. */
export function parseCollectorNumber(text: string): CollectorNumber | null {
  return findCollectorNumbers(text)[0] ?? null;
}

const RUN_RE = new RegExp(`(?<![0-9A-Za-z])(${CH}{4,7})(?![0-9A-Za-z/\\\\])`, 'g');

/**
 * Weak hints: set totals from collector numbers whose slash OCR dropped or misread
 * ("11/108" -> "1108" or "11108"). Only the last three digits are trusted.
 */
export function findTotalHints(text: string): number[] {
  const out: number[] = [];
  for (const m of (text || '').matchAll(RUN_RE)) {
    const d = toDigits(m[1]);
    if (!d || d.digits.length - d.substitutions < 3) continue;
    if (/^(19|20)\d\d$/.test(d.digits)) continue; // years
    const tail = d.digits.slice(-3);
    if (tail[0] === '0') continue;
    const total = parseInt(tail, 10);
    if (total >= 30 && total <= 300 && !out.includes(total)) out.push(total);
  }
  return out;
}
