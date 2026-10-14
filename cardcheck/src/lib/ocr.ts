// Tesseract.js OCR, fully bundled: worker, wasm core and eng traineddata are loaded from the
// extension package (see scripts/copy-tesseract.mjs). Runs in extension pages only.
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrText, OcrWord } from './match';
import { parseCollectorNumber } from './collector';
import { BOTTOM_INVERTED, preprocessRegion, REGIONS, type Region } from './preprocess';

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const w = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('tesseract/core'),
      langPath: chrome.runtime.getURL('tesseract/lang'),
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
    });
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    return w;
  })();
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

async function recognizeRegion(worker: Worker, bitmap: ImageBitmap, region: Region, out: OcrText): Promise<void> {
  const png = await preprocessRegion(bitmap, region);
  const { data } = await worker.recognize(png, {}, { text: true, blocks: true });
  out[region.name] = [out[region.name], data.text ?? ''].filter(Boolean).join('\n');
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const w of l.words)
          out.words!.push({ text: w.text, conf: w.confidence, h: w.bbox.y1 - w.bbox.y0, x: w.bbox.x0, y: w.bbox.y0, region: region.name });
}

export async function ocrImage(blob: Blob, onProgress?: (step: string) => void): Promise<OcrText> {
  const bitmap = await createImageBitmap(blob);
  const worker = await getWorker();
  const out: OcrText = { full: '', top: '', bottom: '', words: [] };
  try {
    for (const [i, region] of REGIONS.entries()) {
      onProgress?.(`Reading text (${i + 1}/${REGIONS.length})…`);
      await recognizeRegion(worker, bitmap, region, out);
    }
    if (!parseCollectorNumber(out.bottom) && !parseCollectorNumber(out.full)) {
      onProgress?.('Reading text (light-on-dark pass)…');
      await recognizeRegion(worker, bitmap, BOTTOM_INVERTED, out);
    }
  } finally {
    bitmap.close();
  }
  return out;
}

export async function terminateOcr(): Promise<void> {
  const w = await workerPromise?.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
