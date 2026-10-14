// Result overlay: runs the scan for one image and shows card, market price and verdict.
// Used inline (iframe next to a listing photo) and as a window (context-menu scans).
import { getRates, formatMoney, convert, type Rates } from '../lib/currency';
import { parseManual, type Confidence, type Parsed } from '../lib/match';
import { verifyCert, type PsaResult } from '../lib/psa';
import { fetchImageViaWorker, identifyImage, identifyManual, priceFor, type Identification, type Priced } from '../lib/scan';
import { addHistory, cache, getSettings, updateHistory, type Settings } from '../lib/storage';
import type { Card } from '../lib/tcgapi';
import { h, sourceLine } from '../lib/ui';
import { dealVerdict, VERDICT_LABEL } from '../lib/verdict';

const params = new URLSearchParams(location.hash.slice(1));
const src = params.get('src') ?? '';
const pageUrl = params.get('page') ?? '';
const mode = params.get('mode') === 'window' ? 'window' : 'inline';
const scanId = crypto.randomUUID();

const app = document.getElementById('app')!;
const statusEl = document.getElementById('status')!;

interface State {
  settings: Settings;
  ident: Identification | null;
  selected: Card | null;
  confidence: Confidence | 'manual';
  priced: Priced | null;
  rates: Rates | null;
  psa: PsaResult | null;
  asking: { amount: number; currency: string } | null;
  askingDetected: boolean;
  showSearch: boolean;
  savedToHistory: boolean;
}

const state: State = {
  settings: undefined as unknown as Settings,
  ident: null,
  selected: null,
  confidence: 'low',
  priced: null,
  rates: null,
  psa: null,
  asking: params.has('price') ? { amount: Number(params.get('price')), currency: params.get('cur') || 'EUR' } : null,
  askingDetected: params.has('price'),
  showSearch: false,
  savedToHistory: false,
};

// ---- frame plumbing -------------------------------------------------------

function post(type: string, extra: Record<string, unknown> = {}) {
  if (mode === 'inline') parent.postMessage({ source: 'cardcheck', type, ...extra }, '*');
}
new ResizeObserver(() => post('resize', { height: document.documentElement.scrollHeight })).observe(document.body);
document.getElementById('close')!.addEventListener('click', () => (mode === 'inline' ? post('close') : window.close()));

function setStatus(text: string, kind: 'busy' | 'error' | '' = 'busy', retry?: () => void) {
  statusEl.className = kind === 'error' ? 'error' : '';
  statusEl.replaceChildren();
  if (!text) return;
  if (kind === 'busy') statusEl.append(h('span', { class: 'spinner' }));
  statusEl.append(h('span', {}, text));
  if (retry) statusEl.append(h('button', { type: 'button', onclick: retry }, 'Retry'));
}

// ---- pricing / verdict ----------------------------------------------------

async function ratesIfNeeded(): Promise<Rates | null> {
  const s = state.settings;
  const need =
    (state.priced?.choice.primary && state.priced.choice.primary.currency !== s.currency) ||
    (state.priced?.choice.secondary && state.priced.choice.secondary.currency !== s.currency) ||
    (state.asking && state.asking.currency !== s.currency);
  if (!need) return state.rates;
  state.rates ??= await getRates(cache).catch(() => null);
  return state.rates;
}

function askingInUserCurrency(): number | null {
  const a = state.asking;
  if (!a || !isFinite(a.amount)) return null;
  if (a.currency === state.settings.currency) return a.amount;
  return state.rates ? convert(a.amount, a.currency, state.settings.currency, state.rates) : null;
}

function currentVerdict() {
  const s = state.settings;
  return dealVerdict(askingInUserCurrency(), state.priced?.converted ?? null, { goodMax: s.goodMax, fairMax: s.fairMax });
}

async function select(card: Card, confidence: Confidence | 'manual') {
  state.selected = card;
  state.confidence = confidence;
  setStatus('Getting price…');
  try {
    state.priced = await priceFor(card, state.settings);
    await ratesIfNeeded();
    setStatus('');
  } catch {
    state.priced = null;
    setStatus('Could not load prices', 'error', () => select(card, confidence));
  }
  render();
  await saveHistory();
}

async function saveHistory() {
  const card = state.selected;
  if (!card) return;
  const v = currentVerdict();
  const entry = {
    id: scanId,
    scannedAt: Date.now(),
    cardId: card.id,
    name: card.name,
    setName: card.set.name,
    number: card.number,
    printedTotal: card.set.printedTotal,
    image: card.images?.small,
    pageUrl,
    price: state.priced?.choice.primary ?? null,
    asking: state.asking && isFinite(state.asking.amount) ? state.asking : null,
    verdict: v.verdict,
    grade: state.ident?.parsed.slab.isSlab ? state.ident.parsed.slab.grade : undefined,
  };
  if (state.savedToHistory) await updateHistory(scanId, entry);
  else await addHistory(entry);
  state.savedToHistory = true;
}

// ---- rendering --------------------------------------------------------------

function cardHeader(card: Card): HTMLElement {
  const conf = state.confidence;
  const label = conf === 'manual' ? 'Manual pick' : `Confidence: ${conf[0].toUpperCase()}${conf.slice(1)}`;
  return h(
    'div',
    { class: 'card' },
    card.images?.small ? h('img', { src: card.images.small, alt: card.name }) : null,
    h(
      'div',
      {},
      h('h2', {}, card.name),
      h('div', { class: 'meta' }, `${card.set.name} · ${card.number}${card.set.printedTotal ? '/' + card.set.printedTotal : ''}`),
      card.rarity ? h('div', { class: 'meta' }, card.rarity) : null,
      h('span', { class: `badge ${conf}` }, label),
    ),
  );
}

function slabSection(p: Parsed): HTMLElement | null {
  const slab = p.slab;
  if (!slab.isSlab) return null;
  const psa = state.psa;
  let verification: HTMLElement;
  if (!slab.cert) verification = h('span', { class: 'no' }, 'Cert number not readable');
  else if (!psa) verification = h('span', { class: 'no' }, 'Checking cert…');
  else if (psa.status === 'verified') {
    const c = psa.cert;
    verification = h('span', { class: 'ok' }, `✓ Verified by PSA: ${[c.year, c.subject, c.cardNumber && '#' + c.cardNumber, c.grade].filter(Boolean).join(' · ')}`);
  } else verification = h('span', { class: 'no' }, `Not verified – ${psa.message}`);
  return h(
    'section',
    { class: 'slab' },
    h('div', {}, h('strong', {}, 'PSA slab'), ` · Grade ${slab.grade ?? '?'}${slab.gradeLabel ? ` (${slab.gradeLabel})` : ''}${slab.cert ? ` · cert ${slab.cert}` : ''}`),
    h('div', {}, verification),
  );
}

function priceSection(): HTMLElement {
  const s = state.settings;
  const pr = state.priced;
  const isSlab = !!state.ident?.parsed.slab.isSlab;
  const sec = h('section', {});
  const primary = pr?.choice.primary;
  if (!primary) {
    sec.append(h('div', { class: 'big' }, 'No price data'), h('div', { class: 'src' }, 'The Pokémon TCG API has no Cardmarket or TCGplayer price for this card.'));
    return sec;
  }
  if (pr.converted != null) {
    sec.append(h('div', { class: 'big' }, formatMoney(pr.converted, s.currency)));
  } else {
    sec.append(h('div', { class: 'big' }, formatMoney(primary.amount, primary.currency)));
    sec.append(h('div', { class: 'note' }, `Could not convert to ${s.currency} (exchange rates unavailable)`));
  }
  sec.append(h('div', { class: 'src' }, sourceLine(primary)));
  if (primary.currency !== s.currency && pr.converted != null && state.rates) {
    sec.append(h('div', { class: 'src' }, `Converted at ECB rate of ${state.rates.date} (Frankfurter)`));
  }
  if (pr.choice.note) sec.append(h('div', { class: 'note' }, pr.choice.note));
  const second = pr.choice.secondary;
  if (second) sec.append(h('div', { class: 'src' }, `Also: ${sourceLine(second)}`));
  if (isSlab) sec.append(h('div', { class: 'raw-label' }, 'Raw value – graded price not available (free mode)'));
  return sec;
}

function askingSection(): HTMLElement {
  const s = state.settings;
  const cur = state.asking?.currency ?? s.currency;
  const input = h('input', {
    type: 'number',
    min: '0',
    step: '0.01',
    inputmode: 'decimal',
    value: state.asking && isFinite(state.asking.amount) ? String(state.asking.amount) : '',
    'aria-label': 'Asking price',
  });
  input.addEventListener('change', async () => {
    const v = parseFloat(input.value);
    state.asking = isFinite(v) ? { amount: v, currency: cur } : null;
    await ratesIfNeeded();
    render();
    await saveHistory();
  });
  const v = currentVerdict();
  const askConv = askingInUserCurrency();
  return h(
    'section',
    {},
    h('div', { class: 'asking' }, h('span', {}, 'Asking price:'), input, h('span', {}, cur)),
    !state.asking ? h('div', { class: 'src' }, state.askingDetected ? '' : 'Asking price not detected – enter it to get a verdict') : null,
    state.asking && cur !== s.currency && askConv != null ? h('div', { class: 'src' }, `≈ ${formatMoney(askConv, s.currency)}`) : null,
    h(
      'div',
      { class: `verdict ${v.verdict}` },
      VERDICT_LABEL[v.verdict],
      v.ratio != null ? ` · ${Math.round(v.ratio * 100)}% of market` : '',
    ),
    h('div', { class: 'src' }, `Good ≤ ${Math.round(s.goodMax * 100)}% · Fair ≤ ${Math.round(s.fairMax * 100)}% · Overpriced above`),
  );
}

function candidatesSection(): HTMLElement | null {
  const ranked = state.ident?.ranked ?? [];
  const show = state.showSearch || state.confidence === 'low' || state.confidence === 'medium' || ranked.length === 0;
  const sec = h('section', {});
  if (!show) {
    sec.append(h('button', { class: 'link', type: 'button', onclick: () => { state.showSearch = true; render(); } }, 'Wrong card? Pick another or search'));
    return sec;
  }
  if (ranked.length > 1 || (ranked.length === 1 && state.selected?.id !== ranked[0].card.id)) {
    sec.append(h('div', { class: 'meta' }, 'Top matches – click to correct:'));
    const list = h('div', { class: 'cands' });
    for (const r of ranked.slice(0, 3)) {
      const c = r.card;
      list.append(
        h(
          'button',
          { type: 'button', class: `cand${state.selected?.id === c.id ? ' selected' : ''}`, onclick: () => select(c, 'manual') },
          c.images?.small ? h('img', { src: c.images.small, alt: '' }) : null,
          h('span', {}, h('strong', {}, c.name), h('br'), h('span', { class: 'meta' }, `${c.set.name} · ${c.number}/${c.set.printedTotal ?? '?'}`)),
        ),
      );
    }
    sec.append(list);
  }
  const input = h('input', { type: 'search', placeholder: 'e.g. charizard ex 125/197 or sv3-125', 'aria-label': 'Search card' });
  const form = h('form', { class: 'search' }, input, h('button', { type: 'submit' }, 'Search'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    setStatus('Searching…');
    try {
      const ident = await identifyManual(input.value, state.settings);
      if (!ident.ranked.length) {
        setStatus('No cards found for that search', 'error');
        return;
      }
      state.ident = { ...ident, parsed: { ...ident.parsed, slab: state.ident?.parsed.slab ?? ident.parsed.slab } };
      state.showSearch = true;
      setStatus('');
      await select(ident.ranked[0].card, 'manual');
    } catch (err) {
      setStatus((err as Error).message, 'error');
    }
  });
  sec.append(form);
  return sec;
}

function readSummary(p: Parsed): HTMLElement {
  const bits = [
    p.collector ? `number ${p.collector.number}${p.collector.total ? '/' + p.collector.total : ''}` : p.slab.number ? `number #${p.slab.number}` : 'no number',
    p.names.length ? `name "${p.names.slice(0, 2).join(' ')}"` : 'no name',
  ];
  return h('div', { class: 'read' }, `Read from image: ${bits.join(', ')}`);
}

function render() {
  const nodes: Array<HTMLElement | null> = [];
  if (mode === 'window' && src) nodes.push(h('img', { class: 'source-img', src, alt: 'Scanned image' }));
  const ident = state.ident;
  if (state.selected) {
    nodes.push(cardHeader(state.selected));
    if (ident) nodes.push(slabSection(ident.parsed));
    nodes.push(priceSection(), askingSection());
  } else if (ident) {
    nodes.push(h('div', {}, h('strong', {}, 'No matching card found.'), ' Try the search below.'));
    nodes.push(slabSection(ident.parsed));
  }
  if (ident) {
    nodes.push(candidatesSection());
    if (state.confidence !== 'manual') nodes.push(readSummary(ident.parsed));
  }
  app.replaceChildren(...nodes.filter((n): n is HTMLElement => !!n));
}

// ---- main ---------------------------------------------------------------------

async function verifySlab(ident: Identification) {
  const cert = ident.parsed.slab.cert;
  if (!ident.parsed.slab.isSlab || !cert) return;
  state.psa = await verifyCert(cert, { token: state.settings.psaToken, cache });
  if (state.psa.status === 'verified' && state.confidence !== 'manual') {
    // Trust PSA's own subject/number over OCR when the OCR match was weak.
    const c = state.psa.cert;
    if (state.confidence !== 'high' && c.subject) {
      const fromPsa = await identifyManual(`${c.subject} ${c.cardNumber ? '#' + c.cardNumber : ''}`, state.settings).catch(() => null);
      if (fromPsa?.ranked.length) {
        state.ident = { ...fromPsa, parsed: { ...fromPsa.parsed, slab: ident.parsed.slab } };
        await select(fromPsa.ranked[0].card, fromPsa.confidence);
        return;
      }
    }
  }
  render();
}

async function run() {
  state.settings = await getSettings();
  if (!src) {
    state.ident = { parsed: parseManual(''), ranked: [], confidence: 'low' };
    state.showSearch = true;
    render();
    return;
  }
  try {
    setStatus('Fetching image…');
    const blob = await fetchImageViaWorker(src);
    const ident = await identifyImage(blob, state.settings, (s) => setStatus(s));
    state.ident = ident;
    if (ident.ranked.length) await select(ident.ranked[0].card, ident.confidence);
    else {
      setStatus('');
      render();
    }
    await verifySlab(ident);
  } catch (e) {
    setStatus((e as Error).message || 'Scan failed', 'error', () => void run());
    state.ident ??= { parsed: parseManual(''), ranked: [], confidence: 'low' };
    state.showSearch = true;
    render();
  }
}

void run();
