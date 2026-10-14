// Parses listing price text like "€ 140,00", "12,50 €", "€1.250", "$5.43" or "Gratis".

export interface AskingPrice {
  amount: number;
  currency: string;
  raw: string;
}

const SYMBOLS: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '¥': 'JPY' };

export function parseAmount(s: string): number | null {
  const m = s.match(/\d[\d.,\s  ]*/);
  if (!m) return null;
  let n = m[0].replace(/[\s  ]/g, '').replace(/[.,]$/, '');
  const lastDot = n.lastIndexOf('.');
  const lastComma = n.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the last one is the decimal separator.
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    n = n.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // "12,50" decimal vs "1,250" thousands.
    n = /^\d{1,3}(,\d{3})+$/.test(n) ? n.replace(/,/g, '') : n.replace(',', '.');
  } else if (lastDot >= 0) {
    // "1.250" is thousands on EU sites; "12.50" is decimal.
    if (/\.\d{3}$/.test(n)) n = n.replace(/\./g, '');
  }
  const v = parseFloat(n);
  return isFinite(v) ? v : null;
}

export function parseAskingPrice(text: string | null | undefined, defaultCurrency = 'EUR'): AskingPrice | null {
  if (!text) return null;
  const raw = text.replace(/\s+/g, ' ').trim();
  if (/\b(gratis|free)\b/i.test(raw)) return { amount: 0, currency: defaultCurrency, raw };
  const sym = raw.match(/[€$£¥]/)?.[0];
  const code = raw.match(/\b(EUR|USD|GBP|JPY|PLN|CHF|SEK|DKK|CZK)\b/i)?.[1]?.toUpperCase();
  const amount = parseAmount(raw);
  if (amount == null) return null; // e.g. "Bieden", "Zie omschrijving"
  return { amount, currency: code ?? (sym ? SYMBOLS[sym] : defaultCurrency), raw };
}
