// Copies Tesseract.js worker, wasm cores and eng traineddata into public/tesseract
// so they are bundled in the extension (MV3 forbids remotely hosted code).
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');

const tesseractDist = join(dirname(require.resolve('tesseract.js/package.json')), 'dist');
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const engDir = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

cpSync(join(tesseractDist, 'worker.min.js'), join(out, 'worker.min.js'));
// Only the *.wasm.js variants are needed: they embed the wasm binary and are what
// Tesseract.js loads when corePath points at a directory.
for (const f of readdirSync(coreDir)) {
  if (f.endsWith('.wasm.js')) cpSync(join(coreDir, f), join(out, 'core', f));
}
cpSync(join(engDir, 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz'));
console.log('Tesseract assets copied to public/tesseract');
