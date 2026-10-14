// Content script for Marktplaats and Vinted: shows a "Scan" button on listing photos and
// opens the CardCheck overlay (an extension iframe) next to the photo.
import { closestFirst, detectSite, isListingPage, matchesAny, type SiteSelectors } from './selectors.js';
import { parseAskingPrice } from '../lib/asking';

const OVERLAY_PATH = 'src/overlay/overlay.html';
const MIN_IMAGE_PX = 80;
const OVERLAY_WIDTH = 340;

const site = detectSite(location.hostname) as SiteSelectors | null;
if (site) init(site);

function visibleArea(el: Element): number {
  const r = el.getBoundingClientRect();
  if (r.width < MIN_IMAGE_PX || r.height < MIN_IMAGE_PX) return 0;
  const s = getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return 0;
  return r.width * r.height;
}

/**
 * Visible element matching the selectors inside root, preferring the one under the pointer
 * (carousels keep hidden slides in the DOM), then the largest.
 */
function imageAt<T extends Element>(root: ParentNode, selectors: string[], x: number, y: number): T | null {
  for (const sel of selectors) {
    let nodes: T[];
    try {
      nodes = [...root.querySelectorAll<T>(sel)];
    } catch {
      continue;
    }
    let best: T | null = null;
    let bestScore = 0;
    for (const n of nodes) {
      const area = visibleArea(n);
      if (!area) continue;
      const r = n.getBoundingClientRect();
      const under = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const score = area + (under ? 1e9 : 0);
      if (score > bestScore) {
        best = n;
        bestScore = score;
      }
    }
    if (best) return best; // respect selector priority
  }
  return null;
}

function firstVisibleText(root: ParentNode, selectors: string[]): string | null {
  for (const sel of selectors) {
    let nodes: NodeListOf<HTMLElement>;
    try {
      nodes = root.querySelectorAll<HTMLElement>(sel);
    } catch {
      continue;
    }
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      const text = n.textContent?.trim();
      if (text && r.width > 0 && r.height > 0) return text;
    }
  }
  return null;
}

/** Generic fallback: nearest ancestor text that looks like a price. */
function findPriceNear(el: Element): string | null {
  let node: Element | null = el;
  for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
    const m = node.textContent?.match(/(€|EUR)\s?\d[\d.,]*|\d[\d.,]*\s?€/);
    if (m) return m[0];
  }
  return null;
}

function bestImageUrl(img: HTMLImageElement, s: SiteSelectors): string {
  let url = img.currentSrc || img.src || img.getAttribute('data-src') || '';
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    let bestW = 0;
    for (const part of srcset.split(',')) {
      const [u, d] = part.trim().split(/\s+/);
      const w = parseFloat(d) || 1;
      if (u && w > bestW) {
        bestW = w;
        url = u;
      }
    }
  }
  return s.upgradeImageUrl(new URL(url, location.href).href);
}

function init(s: SiteSelectors) {
  const extOrigin = new URL(chrome.runtime.getURL('/')).origin;
  const host = document.createElement('cardcheck-root');
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    button{position:absolute;display:none;align-items:center;gap:4px;padding:5px 10px;white-space:nowrap;border:0;border-radius:999px;
      background:#1d4ed8;color:#fff;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}
    button:hover{background:#1e40af}
    iframe{position:absolute;width:${OVERLAY_WIDTH}px;height:140px;border:0;border-radius:12px;background:#fff;
      box-shadow:0 8px 30px rgba(0,0,0,.35);color-scheme:normal}
  </style><button type="button" title="CardCheck: identify this card and check the price">🔍 Scan</button>`;
  const button = shadow.querySelector('button')!;
  document.documentElement.append(host);

  let current: HTMLImageElement | null = null;
  let hideTimer: number | undefined;
  const overlays = new Map<HTMLIFrameElement, HTMLImageElement>();

  function imageFor(target: Element, x: number, y: number): HTMLImageElement | null {
    const card = closestFirst(target, s.card);
    if (card) return imageAt<HTMLImageElement>(card, s.cardImage, x, y);
    if (isListingPage(s, location.pathname)) {
      const gallery = closestFirst(target, s.pageGallery);
      if (gallery) return imageAt<HTMLImageElement>(gallery, s.pageImage, x, y);
      if (target instanceof HTMLImageElement && matchesAny(target, s.pageImage) && visibleArea(target)) return target;
    }
    // Fallback: any large photo served by the marketplace's image CDN.
    if (target instanceof HTMLImageElement && visibleArea(target) >= 150 * 150) {
      try {
        if (s.imageHost.test(new URL(target.currentSrc || target.src).hostname)) return target;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function placeButton(img: HTMLImageElement) {
    const r = img.getBoundingClientRect();
    button.style.display = 'inline-flex';
    button.style.top = `${r.top + scrollY + 8}px`;
    button.style.left = `${r.right + scrollX - button.offsetWidth - 8}px`;
  }

  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      button.style.display = 'none';
      current = null;
    }, 400);
  }

  // Throttled pointer tracking: the button shows only while the pointer is over a photo
  // (tiles on both sites are covered by link overlays, so mouseover alone isn't enough).
  let pending: MouseEvent | null = null;
  document.addEventListener(
    'mousemove',
    (e) => {
      if (pending) {
        pending = e;
        return;
      }
      pending = e;
      requestAnimationFrame(() => {
        const ev = pending!;
        pending = null;
        const t = ev.target as Element;
        if (t === host) return clearTimeout(hideTimer);
        const img = t instanceof Element ? imageFor(t, ev.clientX, ev.clientY) : null;
        const r = img?.getBoundingClientRect();
        if (img && r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          clearTimeout(hideTimer);
          current = img;
          placeButton(img);
        } else if (button.style.display !== 'none') hideSoon();
      });
    },
    { capture: true, passive: true },
  );

  function askingText(img: HTMLImageElement): string | null {
    const card = closestFirst(img, s.card);
    if (card) return firstVisibleText(card, s.cardPrice) ?? findPriceNear(img);
    if (isListingPage(s, location.pathname)) return firstVisibleText(document, s.pagePrice) ?? findPriceNear(img);
    return findPriceNear(img);
  }

  /** The seller's listing title (tile or listing page), used as an identification hint. */
  function listingTitle(img: HTMLImageElement): string | null {
    const card = closestFirst(img, s.card);
    const root: ParentNode | null = card ?? (isListingPage(s, location.pathname) ? document : null);
    const selectors = card ? s.cardTitle : s.pageTitle;
    for (const sel of root ? selectors : []) {
      let el: Element | null = null;
      try {
        el = root!.querySelector(sel);
      } catch {
        continue;
      }
      const text = el?.getAttribute('title') || (el instanceof HTMLImageElement ? el.alt : el?.textContent) || '';
      if (text.trim().length >= 3) return s.cleanTitle(text.replace(/\s+/g, ' ').trim()).slice(0, 200);
    }
    return img.alt?.trim() ? s.cleanTitle(img.alt.trim()).slice(0, 200) : null;
  }

  function positionOverlay(frame: HTMLIFrameElement, img: HTMLImageElement) {
    if (!img.isConnected) return;
    const r = img.getBoundingClientRect();
    const docW = document.documentElement.clientWidth;
    let left = r.right + 8;
    if (left + OVERLAY_WIDTH > docW) left = r.left - OVERLAY_WIDTH - 8;
    if (left < 0) left = Math.max(0, Math.min(r.left + 8, docW - OVERLAY_WIDTH));
    frame.style.left = `${left + scrollX}px`;
    frame.style.top = `${r.top + scrollY}px`;
  }

  function openOverlay(img: HTMLImageElement) {
    for (const [f, i] of overlays) if (i === img) closeOverlay(f);
    const asking = parseAskingPrice(askingText(img), s.currency);
    const params = new URLSearchParams({ src: bestImageUrl(img, s), page: location.href, mode: 'inline' });
    const title = listingTitle(img);
    if (title) params.set('title', title);
    if (asking) {
      params.set('price', String(asking.amount));
      params.set('cur', asking.currency);
      params.set('raw', asking.raw);
    }
    const frame = document.createElement('iframe');
    frame.src = `${chrome.runtime.getURL(OVERLAY_PATH)}#${params}`;
    frame.title = 'CardCheck';
    frame.allow = '';
    overlays.set(frame, img);
    shadow.append(frame);
    positionOverlay(frame, img);
  }

  function closeOverlay(frame: HTMLIFrameElement) {
    overlays.delete(frame);
    frame.remove();
  }

  button.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (current) openOverlay(current);
  });

  window.addEventListener('message', (e) => {
    if (e.origin !== extOrigin || !e.data || e.data.source !== 'cardcheck') return;
    const frame = [...overlays.keys()].find((f) => f.contentWindow === e.source);
    if (!frame) return;
    if (e.data.type === 'resize') frame.style.height = `${Math.min(Math.max(80, Number(e.data.height) || 0), 720)}px`;
    if (e.data.type === 'close') closeOverlay(frame);
  });

  let raf = 0;
  const reposition = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      for (const [f, img] of overlays) positionOverlay(f, img);
      if (current?.isConnected && button.style.display !== 'none') placeButton(current);
    });
  };
  window.addEventListener('resize', reposition, { passive: true });
  document.addEventListener('scroll', reposition, { capture: true, passive: true });

  // Both sites are single-page apps: drop overlays when the URL changes.
  let href = location.href;
  setInterval(() => {
    if (location.href === href) return;
    href = location.href;
    for (const f of [...overlays.keys()]) closeOverlay(f);
    button.style.display = 'none';
  }, 1000);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const f of [...overlays.keys()]) closeOverlay(f);
  });
}
