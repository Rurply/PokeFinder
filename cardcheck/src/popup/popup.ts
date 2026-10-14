// Popup and options page: scan history with watch list, and settings.
import { CURRENCIES, formatMoney, getRates, type Rates } from '../lib/currency';
import { choosePrice, type PricePoint } from '../lib/pricing';
import { samePriceSeries } from '../lib/scan';
import { cache, getHistory, getSettings, saveSettings, updateHistory, type HistoryEntry, type Settings } from '../lib/storage';
import { getCard } from '../lib/tcgdex';
import { h, inCurrency, timeAgo } from '../lib/ui';
import { VERDICT_LABEL } from '../lib/verdict';

const view = document.getElementById('view')!;
const statusEl = document.getElementById('status')!;
let settings: Settings;
let rates: Rates | null = null;
let repricing: Promise<void> | null = null;

function setStatus(text: string) {
  statusEl.textContent = text;
}

// ---- history ------------------------------------------------------------------

function priceText(p: PricePoint | null | undefined): HTMLElement {
  if (!p) return h('div', { class: 'price' }, 'No price data');
  const conv = inCurrency(p, settings.currency, rates);
  return h(
    'div',
    {},
    h('span', { class: 'price' }, conv != null ? formatMoney(conv, settings.currency) : formatMoney(p.amount, p.currency)),
    h('div', { class: 'src' }, `${p.source} ${p.metric}: ${formatMoney(p.amount, p.currency)} · updated ${p.updatedAt}`),
  );
}

const ARROWS = { up: '▲', down: '▼', flat: '▬', changed: '•' } as const;

function trendEl(e: HistoryEntry): HTMLElement | null {
  if (!e.watched || !e.trend) return null;
  const before = e.price ? formatMoney(e.price.amount, e.price.currency) : '–';
  const after = e.lastPrice ? formatMoney(e.lastPrice.amount, e.lastPrice.currency) : '–';
  const title = e.trend === 'changed' ? 'Price source changed since the scan; not comparable' : `At scan: ${before} → now: ${after}`;
  return h('span', { class: `trend ${e.trend}`, title }, ` ${ARROWS[e.trend]} `);
}

function historyRow(e: HistoryEntry): HTMLElement {
  const current = e.watched && e.lastPrice !== undefined ? e.lastPrice : e.price;
  const watch = h('button', { type: 'button', class: `watch${e.watched ? ' on' : ''}`, title: e.watched ? 'Stop watching' : 'Watch: re-price when the popup opens', 'aria-pressed': String(e.watched) }, e.watched ? '★' : '☆');
  watch.addEventListener('click', async () => {
    await updateHistory(e.id, { watched: !e.watched, trend: undefined, lastPrice: undefined });
    await renderHistory();
  });
  return h(
    'div',
    { class: 'row' },
    e.image ? h('img', { src: e.image, alt: '' }) : null,
    h(
      'div',
      { class: 'body' },
      h('div', { class: 'name' }, e.name, e.grade ? ` · PSA ${e.grade}` : '', trendEl(e)),
      h('div', { class: 'meta' }, `${e.setName} · ${e.number}${e.printedTotal ? '/' + e.printedTotal : ''} · ${timeAgo(e.scannedAt)}`),
      priceText(current),
      e.grade ? h('div', { class: 'src' }, 'Raw value – graded price not available (free mode)') : null,
      h(
        'div',
        { class: 'meta' },
        e.asking ? `Asking ${formatMoney(e.asking.amount, e.asking.currency)} · ` : '',
        h('span', { class: `v-${e.verdict}` }, `${VERDICT_LABEL[e.verdict]} (at scan)`),
        e.pageUrl && /^https?:/.test(e.pageUrl) ? h('span', {}, ' · ', h('a', { href: e.pageUrl, target: '_blank', rel: 'noreferrer' }, 'listing')) : null,
      ),
    ),
    watch,
  );
}

async function renderHistory() {
  const list = await getHistory();
  if (!list.length) {
    view.replaceChildren(h('div', { class: 'empty' }, 'No scans yet. Hover a listing photo on Marktplaats or Vinted and click “Scan”, or right-click any image → “CardCheck: scan this image”.'));
    return;
  }
  view.replaceChildren(...list.map(historyRow));
}

/** Re-prices watched cards (once per popup open) and records the trend. */
async function repriceWatched() {
  const watched = (await getHistory()).filter((e) => e.watched);
  if (!watched.length) return;
  setStatus(`Updating ${watched.length} watched card${watched.length > 1 ? 's' : ''}…`);
  let failed = 0;
  let outdated = 0;
  for (const e of watched) {
    // Scans from before the switch to TCGdex use another card-ID scheme.
    if (!e.lang) {
      outdated++;
      continue;
    }
    try {
      const card = await getCard(e.cardId, e.lang, { cache, force: true });
      const now = choosePrice(card, { metric: settings.cmMetric, policy: settings.sourcePolicy, freshnessDays: settings.freshnessDays }).primary;
      const prev = e.price; // trend is measured against the price at scan time
      let trend: HistoryEntry['trend'] = 'changed';
      if (now && prev && samePriceSeries(now, prev)) trend = now.amount > prev.amount ? 'up' : now.amount < prev.amount ? 'down' : 'flat';
      await updateHistory(e.id, { lastPrice: now, lastCheckedAt: Date.now(), trend });
    } catch {
      failed++;
    }
    await renderHistory();
  }
  const notes = [
    failed ? `${failed} watched card(s) could not be updated (card database unavailable)` : '',
    outdated ? `${outdated} watched card(s) are from an older CardCheck version – scan them again to keep watching` : '',
  ].filter(Boolean);
  setStatus(notes.join(' · '));
}

// ---- settings -------------------------------------------------------------------

function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  return h('label', {}, label, control, help ? h('span', { class: 'help' }, help) : null);
}

function select(name: string, value: string, options: Array<[string, string]>): HTMLSelectElement {
  const s = h('select', { name });
  for (const [v, l] of options) s.append(h('option', { value: v, selected: v === value }, l));
  return s;
}

function renderSettings() {
  const s = settings;
  const pct = (name: string, v: number) => h('input', { name, type: 'number', min: '1', max: '500', step: '1', value: String(Math.round(v * 100)) });
  const secret = (name: string, v: string, placeholder: string) => h('input', { name, type: 'password', value: v, placeholder, autocomplete: 'off', spellcheck: 'false' });
  const msg = h('span', {});
  const form = h(
    'form',
    { class: 'settings' },
    field('Currency', select('currency', s.currency, CURRENCIES.map((c) => [c, c]))),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Deal thresholds (asking price as % of market)'),
      h('div', { class: 'pair' }, field('🟢 Good deal up to', pct('goodMax', s.goodMax)), field('🟡 Fair up to', pct('fairMax', s.fairMax))),
      h('span', { class: 'help meta' }, 'Above the fair limit the listing is 🔴 overpriced.'),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Price source'),
      field('Cardmarket price', select('cmMetric', s.cmMetric, [['trend', 'Trend price'], ['avg', 'Average sell price'], ['low', 'Low price']])),
      field(
        'Which source to use',
        select('sourcePolicy', s.sourcePolicy, [
          ['auto', 'Freshest wins (recommended)'],
          ['cardmarket', 'Always Cardmarket (EUR)'],
          ['tcgplayer', 'Always TCGplayer (USD)'],
        ]),
        'Freshest wins uses Cardmarket while its price is recent, otherwise the more recently updated TCGplayer price.',
      ),
      field('Cardmarket max age (days)', h('input', { name: 'freshnessDays', type: 'number', min: '1', max: '3650', step: '1', value: String(s.freshnessDays) })),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Optional free API key'),
      field('PSA Public API token', secret('psaToken', s.psaToken, 'optional'), 'Enables PSA cert verification (100 calls/day on free accounts).'),
      h('span', { class: 'help meta' }, 'Stored only in this browser (chrome.storage.local). Card data and prices come from TCGdex, which needs no key.'),
    ),
    h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Save'), msg),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const goodMax = Number(fd.get('goodMax')) / 100;
    const fairMax = Number(fd.get('fairMax')) / 100;
    const freshnessDays = Math.round(Number(fd.get('freshnessDays')));
    if (!(goodMax > 0) || !(fairMax > goodMax)) {
      msg.className = 'error';
      msg.textContent = 'The fair limit must be higher than the good-deal limit.';
      return;
    }
    if (!(freshnessDays >= 1)) {
      msg.className = 'error';
      msg.textContent = 'Max age must be at least 1 day.';
      return;
    }
    settings = await saveSettings({
      currency: fd.get('currency') as Settings['currency'],
      goodMax,
      fairMax,
      cmMetric: fd.get('cmMetric') as Settings['cmMetric'],
      sourcePolicy: fd.get('sourcePolicy') as Settings['sourcePolicy'],
      freshnessDays,
      psaToken: String(fd.get('psaToken') ?? '').trim(),
    });
    rates = settings.currency === 'EUR' ? rates : await getRates(cache).catch(() => rates);
    msg.className = '';
    msg.textContent = 'Saved.';
  });
  view.replaceChildren(form);
}

// ---- tabs -------------------------------------------------------------------------

async function show(tab: string) {
  document.body.dataset.view = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>('nav button')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab === 'settings') renderSettings();
  else {
    await renderHistory();
    repricing ??= repriceWatched();
  }
}

async function main() {
  settings = await getSettings();
  rates = await getRates(cache).catch(() => null);
  for (const b of document.querySelectorAll<HTMLButtonElement>('nav button')) b.addEventListener('click', () => void show(b.dataset.tab!));
  await show(document.body.dataset.view || 'history');
}

void main();
