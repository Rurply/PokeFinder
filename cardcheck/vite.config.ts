import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'chrome120',
    rollupOptions: {
      // The overlay is opened as an iframe/window, so it is not referenced from the manifest
      // as a page; list it here so it gets built.
      input: { overlay: 'src/overlay/overlay.html' },
    },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
