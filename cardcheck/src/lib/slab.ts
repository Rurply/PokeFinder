// PSA slab label parsing: cert number, grade, card number and subject from OCR text.
import { toDigits } from './collector';

export interface SlabInfo {
  isSlab: boolean;
  cert?: string;
  /** Numeric grade as printed, e.g. "10" or "8.5". */
  grade?: string;
  /** Grade wording as printed, e.g. "GEM MT". */
  gradeLabel?: string;
  /** Card number from the label ("#125" -> "125"). */
  number?: string;
  /** Subject (card name) text from the label. */
  name?: string;
  year?: string;
}

// PSA grade words and the numeric grade they go with.
const GRADE_WORDS: Array<[RegExp, string, number[]]> = [
  [/GEM\s*-?\s*M(?:IN)?T/, 'GEM MT', [10]],
  [/NM\s*-?\s*MT\+?/, 'NM-MT', [8, 8.5]],
  [/EX\s*-?\s*MT\+?/, 'EX-MT', [6, 6.5]],
  [/VG\s*-?\s*EX\+?/, 'VG-EX', [4, 4.5]],
  [/MINT\+?/, 'MINT', [9, 9.5]],
  [/NM\+?/, 'NM', [7, 7.5]],
  [/EX\+?/, 'EX', [5, 5.5]],
  [/VG\+?/, 'VG', [3, 3.5]],
  [/GOOD\+?/, 'GOOD', [2, 2.5]],
  [/FR/, 'FR', [1.5]],
  [/PR/, 'PR', [1]],
];

const GRADE_NUM = '([0-9OIL]{1,2}(?:\\.5)?)';

function findGrade(up: string): { grade: string; label: string } | null {
  let labelOnly: { grade: string; label: string } | null = null;
  for (const [word, label, expected] of GRADE_WORDS) {
    const re = new RegExp(`(?<![A-Z])${word.source}(?:\\s*[:\\-]?\\s*${GRADE_NUM}(?![0-9]))?`, 'g');
    for (const m of up.matchAll(re)) {
      if (m[1]) {
        const d = toDigits(m[1].replace('.5', ''));
        const value = d ? parseFloat(d.digits + (m[1].endsWith('.5') ? '.5' : '')) : NaN;
        // A grade that agrees with its label wording is trusted.
        if (expected.includes(value)) return { grade: String(value), label };
      }
      // Otherwise the wording decides the grade (GEM MT is always 10); OCR often splits the
      // number onto another line or misreads it.
      labelOnly ??= { grade: String(expected[0]), label };
    }
  }
  return labelOnly;
}

function findCert(up: string): string | undefined {
  const tokens = up.match(/[0-9OIL]{7,10}/g) ?? [];
  for (const t of tokens) {
    const d = toDigits(t);
    if (!d || d.digits.length - d.substitutions < 6) continue;
    if (d.digits.length >= 7 && d.digits.length <= 10) return d.digits;
  }
  return undefined;
}

export function parseSlab(text: string): SlabInfo {
  const up = (text || '').toUpperCase();
  const hasPsa = /\bP\s?S\s?A\b/.test(up);
  const grade = findGrade(up);
  const cert = findCert(up);

  let number: string | undefined;
  let name: string | undefined;
  const numMatch = up.match(/#\s?([A-Z]{0,4}[0-9OIL]{1,3})\b/);
  if (numMatch) {
    const raw = numMatch[1];
    const letters = raw.match(/^[A-Z]*/)?.[0] ?? '';
    const prefix = ['TG', 'GG', 'SV', 'RC'].includes(letters) ? letters : '';
    const d = toDigits(raw.slice(prefix.length));
    if (d) number = prefix ? prefix + d.digits : d.digits.replace(/^0+(?=\d)/, '');
    // The subject usually follows the card number on the label.
    const after = up.slice((numMatch.index ?? 0) + numMatch[0].length);
    const words = after.match(/[A-Z][A-Z'.\-]+/g) ?? [];
    const stop = /^(GEM|MINT|NM|EX-MT|VG|GOOD|FR|PR|PSA|HOLO|REVERSE|FOIL|SPECIAL|ILLUSTRATION|ART|RARE|DOUBLE|ULTRA|SECRET)$/;
    const picked: string[] = [];
    for (const w of words) {
      if (stop.test(w)) break;
      picked.push(w);
      if (picked.length >= 4) break;
    }
    if (picked.length) name = picked.join(' ');
  }

  const year = up.match(/\b(199\d|20[0-3]\d)\b/)?.[1];
  const isSlab = hasPsa || (!!grade && (!!cert || !!number));
  return { isSlab, cert, grade: grade?.grade, gradeLabel: grade?.label, number, name, year };
}
