// Service worker: context menu, image fetching (avoids page CORS) and cache housekeeping.
import { TTL } from '../lib/cache';
import { isGradedSalesUrl } from '../lib/graded';
import { cache } from '../lib/storage';

const MENU_ID = 'cardcheck-scan';
const OVERLAY_PATH = 'src/overlay/overlay.html';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'CardCheck: scan this image', contexts: ['image'] });
  });
  void cache.prune(TTL.card);
});

chrome.runtime.onStartup.addListener(() => void cache.prune(TTL.card));

// Works on any site: the click grants activeTab for that tab, and the result opens in a
// small extension window (no content script or extra permission needed).
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  const params = new URLSearchParams({ src: info.srcUrl, page: info.pageUrl ?? tab?.url ?? '', mode: 'window' });
  void chrome.windows.create({
    url: `${chrome.runtime.getURL(OVERLAY_PATH)}#${params}`,
    type: 'popup',
    width: 380,
    height: 760,
  });
});

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fetchImage(url: string): Promise<{ ok: true; base64: string; type: string } | { ok: false; error: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, error: 'Invalid image URL' };
  }
  if (u.protocol === 'blob:') return { ok: false, error: 'This image only exists inside the page (blob URL) and cannot be fetched' };
  if (!['https:', 'http:', 'data:'].includes(u.protocol)) return { ok: false, error: 'Unsupported image URL' };
  try {
    const res = await fetch(u.href, { credentials: 'omit' });
    if (!res.ok) return { ok: false, error: `Image request failed (HTTP ${res.status})` };
    const type = res.headers.get('content-type')?.split(';')[0] ?? '';
    if (!type.startsWith('image/')) return { ok: false, error: 'URL is not an image' };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: 'Image is too large' };
    return { ok: true, base64: toBase64(buf), type };
  } catch {
    return { ok: false, error: 'Could not download the image (the site may block cross-origin access)' };
  }
}

// Graded sales open in one reusable, compact CardCheck window (no tabs or address bar),
// docked to the right of the current browser window. The sites refuse or break when
// embedded in the panel, so they get their own window instead.
async function openSalesWindow(url: string): Promise<void> {
  const { salesWindowId } = (await chrome.storage.session.get('salesWindowId')) as { salesWindowId?: number };
  if (salesWindowId != null) {
    try {
      const [tab] = await chrome.tabs.query({ windowId: salesWindowId });
      if (tab?.id != null) {
        await chrome.tabs.update(tab.id, { url });
        await chrome.windows.update(salesWindowId, { focused: true });
        return;
      }
    } catch {
      /* window was closed */
    }
  }
  const width = 560;
  const height = 860;
  const anchor = await chrome.windows.getLastFocused().catch(() => undefined);
  const left = anchor?.left != null && anchor.width != null ? Math.max(0, anchor.left + anchor.width - width - 16) : undefined;
  const top = anchor?.top != null ? anchor.top + 60 : undefined;
  const win = await chrome.windows.create({ url, type: 'popup', width, height, left, top, focused: true });
  if (win?.id != null) await chrome.storage.session.set({ salesWindowId: win.id });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'cardcheck:openSales' && typeof msg.url === 'string' && isGradedSalesUrl(msg.url)) {
    void openSalesWindow(msg.url);
    return;
  }
  if (msg?.type === 'cardcheck:fetchImage' && typeof msg.url === 'string') {
    fetchImage(msg.url).then(sendResponse);
    return true;
  }
});
