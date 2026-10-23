/**
 * Pixel work on canvas ImageData. No DOM here, so it also runs under Node.
 */

/** RGBA to 8-bit luma, BT.601 weights in integer arithmetic. */
export function toGray(rgba) {
  const gray = new Uint8Array(rgba.length >> 2);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 151 + rgba[p + 2] * 28) >> 8;
  }
  return gray;
}

const BLOCK = 16;   // paper brightness is estimated per 16×16 block
const MIN_BG = 40;  // never divide by near-black
const PAPER = 200;  // normalised brightness above which a pixel is paper

/**
 * Split ink from paper under uneven lighting. Each pixel is divided by the
 * local paper brightness (the brightest pixel in its block, interpolated
 * between blocks), so a shadowed corner thresholds like the rest of the page.
 * Returns one byte per pixel: 1 = paper, 0 = ink.
 */
export function threshold(gray, width, height) {
  const bw = Math.ceil(width / BLOCK), bh = Math.ceil(height / BLOCK);
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let max = 0;
      for (let y = by * BLOCK, y1 = Math.min(height, y + BLOCK); y < y1; y++) {
        for (let x = bx * BLOCK, x1 = Math.min(width, x + BLOCK); x < x1; x++) {
          max = Math.max(max, gray[y * width + x]);
        }
      }
      bg[by * bw + bx] = Math.max(max, MIN_BG);
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(bh - 1, y / BLOCK), y0 = fy | 0, ty = fy - y0;
    const r0 = y0 * bw, r1 = Math.min(bh - 1, y0 + 1) * bw;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(bw - 1, x / BLOCK), x0 = fx | 0, tx = fx - x0;
      const x1 = Math.min(bw - 1, x0 + 1);
      const top = bg[r0 + x0] + (bg[r0 + x1] - bg[r0 + x0]) * tx;
      const bottom = bg[r1 + x0] + (bg[r1 + x1] - bg[r1 + x0]) * tx;
      out[y * width + x] = (gray[y * width + x] / (top + (bottom - top) * ty)) * 255 > PAPER ? 1 : 0;
    }
  }
  return out;
}

/**
 * Is this page ink on paper, or continuous tone? Looks at ~40k sampled pixels.
 *   textLike  near-grey, mostly light, no photo in it: safe to send as black & white
 *   colour    enough chroma that a JPEG of it should stay in colour
 *   ink       share of dark pixels, used to pick the most telling page to preview
 */
export function classify(rgba, width) {
  const n = rgba.length >> 2;
  const step = Math.max(1, Math.floor(n / 40000));
  let chroma = 0, dark = 0, seen = 0;
  for (let i = 0; i < n; i += step, seen++) {
    const p = i * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
    if ((r * 77 + g * 151 + b * 28) >> 8 < 160) dark++;
  }
  chroma /= seen;
  const ink = dark / seen;
  const textLike = chroma < 14 && ink < 0.4 && photoShare(rgba, width) < PHOTO_SHARE;
  return { ink, colour: chroma >= 25, textLike };
}

const PHOTO_BLOCK = 32;    // 2.7 mm at 300 DPI: wider than any stroke of text
const PHOTO_SHARE = 0.01;  // an ID card's photo is ~1.2% of an A4 page

/**
 * Share of the page that is mid-tone with no paper in it, like a photo. Text
 * never fills a 32×32 block, so its blocks always reach paper brightness;
 * the threshold would flatten a photo's blocks, since each is its own "paper".
 * Solid ink and the outer two rings of blocks (scanner edge shadow) don't count.
 */
function photoShare(rgba, width) {
  const height = rgba.length / 4 / width;
  const bw = Math.ceil(width / PHOTO_BLOCK), bh = Math.ceil(height / PHOTO_BLOCK);
  const max = new Uint8Array(bw * bh);
  for (let y = 0, p = 0; y < height; y++) {
    const row = ((y / PHOTO_BLOCK) | 0) * bw;
    for (let x = 0; x < width; x++, p += 4) {
      const i = row + ((x / PHOTO_BLOCK) | 0);
      const luma = (rgba[p] * 77 + rgba[p + 1] * 151 + rgba[p + 2] * 28) >> 8;
      if (luma > max[i]) max[i] = luma;
    }
  }
  const paper = max.slice().sort()[Math.floor(max.length * 0.9)];
  let photo = 0, inner = 0;
  for (let by = 2; by < bh - 2; by++) {
    for (let bx = 2; bx < bw - 2; bx++, inner++) {
      const m = max[by * bw + bx];
      if (m > 60 && m < paper * 0.8) photo++;
    }
  }
  return inner ? photo / inner : 0;
}
