// Image preprocessing on OffscreenCanvas before OCR: crop, upscale, grayscale and adaptive
// (Sauvola) thresholding, which copes with holo foil, glare and uneven phone-photo lighting
// much better than a global threshold.

export interface Region {
  name: 'full' | 'top' | 'bottom';
  /** Vertical crop as fractions of the image height. */
  y0: number;
  y1: number;
  /** Target output width in px (small listing photos are upscaled, at most 3x). */
  width: number;
  /** Sauvola sensitivity; higher keeps thin strokes like the "/" in "11/108". */
  k: number;
  /** Invert first: for light text on dark card frames (e.g. Tera / dark-type cards). */
  invert?: boolean;
}

// The card name sits in the top strip, the collector number (and on slabs the label) in
// the bottom/top strips. The full image catches cards that don't fill the photo.
export const REGIONS: Region[] = [
  { name: 'full', y0: 0, y1: 1, width: 1600, k: 0.2 },
  { name: 'top', y0: 0, y1: 0.3, width: 1600, k: 0.2 },
  { name: 'bottom', y0: 0.75, y1: 1, width: 1600, k: 0.3 },
];

/** Extra pass, only run when no collector number was found in the regular passes. */
export const BOTTOM_INVERTED: Region = { name: 'bottom', y0: 0.75, y1: 1, width: 1600, k: 0.3, invert: true };

/** RGBA -> luminance (0..255), one byte per pixel. */
export function toGray(px: Uint8ClampedArray): Uint8Array {
  const g = new Uint8Array(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) g[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  return g;
}

/**
 * Sauvola adaptive threshold: a pixel is ink if darker than mean * (1 + k * (sd / 128 - 1))
 * of its win x win neighbourhood. Uses integral images, so cost is O(pixels).
 */
export function sauvola(gray: Uint8Array, w: number, h: number, win: number, k: number): Uint8Array {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 0; x < w; x++) {
      const v = gray[y * w + x];
      rs += v;
      rq += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rq;
    }
  }
  const r = win >> 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const a = y1 * W + x1;
      const b = y0 * W + x1;
      const c = y1 * W + x0;
      const d = y0 * W + x0;
      const mean = (sum[a] - sum[b] - sum[c] + sum[d]) / n;
      const variance = (sq[a] - sq[b] - sq[c] + sq[d]) / n - mean * mean;
      const t = mean * (1 + k * (Math.sqrt(Math.max(0, variance)) / 128 - 1));
      out[y * w + x] = gray[y * w + x] > t ? 255 : 0;
    }
  }
  return out;
}

/** Crops, scales and binarises one region; returns a PNG blob for Tesseract. */
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
  // Window ~ a few text heights: scales with the output size.
  const win = Math.max(15, Math.round(w / 40) | 1);
  const gray = toGray(img.data);
  if (r.invert) for (let i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
  const bin = sauvola(gray, w, h, win, r.k);
  for (let i = 0, j = 0; j < bin.length; i += 4, j++) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = bin[j];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
