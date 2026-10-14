// Tesseract.js OCR, fully bundled: worker, wasm core and eng traineddata are loaded from the
// extension package (see scripts/copy-tesseract.mjs). Runs in extension pages only.
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrText } from './match';
import { preprocessRegion, REGIONS } from './preprocess';

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

export async function ocrImage(blob: Blob, onProgress?: (step: string) => void): Promise<OcrText> {
  const bitmap = await createImageBitmap(blob);
  const worker = await getWorker();
  const out: OcrText = { full: '', top: '', bottom: '' };
  try {
    for (const region of REGIONS) {
      onProgress?.(`Reading text (${region.name})…`);
      const png = await preprocessRegion(bitmap, region);
      const { data } = await worker.recognize(png);
      out[region.name] = data.text ?? '';
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
