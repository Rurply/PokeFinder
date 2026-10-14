// Image preprocessing on OffscreenCanvas before OCR: crop, upscale, grayscale, contrast stretch.

export interface Region {
  name: 'full' | 'top' | 'bottom';
  /** Vertical crop as fractions of the image height. */
  y0: number;
  y1: number;
  /** Target output width in px (small listing photos are upscaled). */
  width: number;
}

// The card name sits in the top strip, the collector number (and on slabs the label) in
// the bottom/top strips. The full image catches cards that don't fill the photo.
export const REGIONS: Region[] = [
  { name: 'full', y0: 0, y1: 1, width: 1600 },
  { name: 'top', y0: 0, y1: 0.3, width: 1800 },
  { name: 'bottom', y0: 0.75, y1: 1, width: 2200 },
];

/** In-place grayscale + percentile contrast stretch on RGBA pixel data. */
export function grayscaleContrast(px: Uint8ClampedArray, lowPct = 0.02, highPct = 0.98): void {
  const n = px.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = y;
    hist[px[i]]++;
  }
  let lo = 0;
  let hi = 255;
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * lowPct) {
      lo = v;
      break;
    }
  }
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= n * (1 - highPct)) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
}

/** Crops, scales and enhances one region; returns a PNG blob for Tesseract. */
export async function preprocessRegion(bitmap: ImageBitmap, r: Region): Promise<Blob> {
  const sy = Math.round(bitmap.height * r.y0);
  const sh = Math.max(1, Math.round(bitmap.height * (r.y1 - r.y0)));
  const scale = Math.min(3, Math.max(1, r.width / bitmap.width));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(sh * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, sy, bitmap.width, sh, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  grayscaleContrast(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
