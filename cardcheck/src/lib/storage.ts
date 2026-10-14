// chrome.storage.local access: settings, cache and scan history.
// API keys are kept here only. Never log settings objects.
import { createCache, memoryKV, type KVStore } from './cache';
import type { Currency } from './currency';
import type { CardmarketMetric, PricePoint, SourcePolicy } from './pricing';
import type { Verdict } from './verdict';

export interface Settings {
  currency: Currency;
  goodMax: number;
  fairMax: number;
  cmMetric: CardmarketMetric;
  sourcePolicy: SourcePolicy;
  /** Max age (days) for Cardmarket prices before "freshest wins" prefers TCGplayer. */
  freshnessDays: number;
  tcgApiKey: string;
  psaToken: string;
}

export const DEFAULT_SETTINGS: Settings = {
  currency: 'EUR',
  goodMax: 0.85,
  fairMax: 1.1,
  cmMetric: 'trend',
  sourcePolicy: 'auto',
  freshnessDays: 30,
  tcgApiKey: '',
  psaToken: '',
};

export function chromeKV(): KVStore {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return memoryKV();
  const s = chrome.storage.local;
  return {
    get: (keys) => s.get(keys) as Promise<Record<string, unknown>>,
    set: (items) => s.set(items),
    remove: (keys) => s.remove(keys),
  };
}

const kv = chromeKV();
export const cache = createCache(kv);

export async function getSettings(): Promise<Settings> {
  const r = await kv.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...((r.settings as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await kv.set({ settings: next });
  return next;
}

export interface HistoryEntry {
  /** Unique scan ID. */
  id: string;
  scannedAt: number;
  cardId: string;
  name: string;
  setName: string;
  number: string;
  printedTotal?: number;
  image?: string;
  pageUrl?: string;
  /** Market price at scan time, in its source currency. */
  price: PricePoint | null;
  asking?: { amount: number; currency: string } | null;
  verdict: Verdict;
  grade?: string;
  watched: boolean;
  /** Latest re-price (watched cards), in source currency. */
  lastPrice?: PricePoint | null;
  lastCheckedAt?: number;
  trend?: 'up' | 'down' | 'flat' | 'changed';
}

export const HISTORY_LIMIT = 50;

export async function getHistory(): Promise<HistoryEntry[]> {
  const r = await kv.get(['history']);
  return (r.history as HistoryEntry[]) ?? [];
}

export async function saveHistory(list: HistoryEntry[]): Promise<void> {
  await kv.set({ history: list.slice(0, HISTORY_LIMIT) });
}

/** Adds a scan to the front of the history (keeps the watch flag if the card was watched). */
export async function addHistory(e: Omit<HistoryEntry, 'watched'>): Promise<void> {
  const list = await getHistory();
  const watched = list.some((x) => x.cardId === e.cardId && x.watched);
  await saveHistory([{ ...e, watched }, ...list.filter((x) => x.id !== e.id)]);
}

export async function updateHistory(id: string, patch: Partial<HistoryEntry>): Promise<HistoryEntry[]> {
  const list = (await getHistory()).map((x) => (x.id === id ? { ...x, ...patch } : x));
  await saveHistory(list);
  return list;
}
