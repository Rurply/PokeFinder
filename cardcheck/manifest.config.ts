import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

const MARKETPLACE_PAGES = ['https://www.marktplaats.nl/*', 'https://www.vinted.nl/*', 'https://www.vinted.com/*'];

export default defineManifest({
  manifest_version: 3,
  name: 'CardCheck',
  version: pkg.version,
  description: 'Identifies Pokémon cards and PSA slabs in Marktplaats and Vinted listings and shows whether the asking price is a good deal.',
  icons: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  action: { default_popup: 'src/popup/popup.html', default_title: 'CardCheck' },
  options_ui: { page: 'src/options/options.html', open_in_tab: true },
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  content_scripts: [{ matches: MARKETPLACE_PAGES, js: ['src/content/index.ts'], run_at: 'document_idle' }],
  permissions: ['storage', 'contextMenus', 'activeTab'],
  host_permissions: [
    ...MARKETPLACE_PAGES,
    // Listing photos are served from the marketplaces' own image CDNs.
    'https://*.marktplaats.com/*',
    'https://*.vinted.net/*',
    'https://api.pokemontcg.io/*',
    'https://api.frankfurter.dev/*',
    'https://api.psacard.com/*',
  ],
  web_accessible_resources: [{ resources: ['src/overlay/overlay.html'], matches: MARKETPLACE_PAGES }],
  // 'wasm-unsafe-eval' lets the bundled Tesseract wasm core compile; no remote code is allowed.
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
});
