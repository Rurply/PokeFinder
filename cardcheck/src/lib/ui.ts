// Tiny DOM builder (all text goes through textContent; no HTML injection) and shared formatters.
import { convert, formatMoney, type Rates } from './currency';
import type { PricePoint } from './pricing';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | EventListener | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** "Cardmarket trend price · updated 2025-11-21" */
export function sourceLine(p: PricePoint): string {
  return `${p.source} ${p.metric}: ${formatMoney(p.amount, p.currency)} · updated ${p.updatedAt}`;
}

/** Price converted to the user's currency, or null if no rate. */
export function inCurrency(p: PricePoint, currency: string, rates: Rates | null): number | null {
  if (p.currency === currency) return p.amount;
  return rates ? convert(p.amount, p.currency, currency, rates) : null;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
