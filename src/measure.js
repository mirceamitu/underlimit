/**
 * Rendering and encoding: every treatment a page could be sent in, measured
 * by actually encoding it. The sizes shown are the bytes that get downloaded.
 */
import { encodeG4 } from './ccitt.js';
import { classify, threshold, toGray } from './image.js';

const BASE_DPI = 300;     // every page is rendered once at this resolution
const PHOTO_QUALITY = 0.7; // JPEG quality for photo pages on the black & white path

/**
 * Treatments, best first within each mode. For a scan of typed paper, black
 * & white at full resolution is the better result, not just the smaller one:
 * crisp edges, no JPEG artefacts. So it is the default, and resolution is
 * what gives way when the limit is tight. Greyscale is only used on request.
 */
export const RUNGS = [
  { id: 'bw300', mode: 'bw', dpi: 300, name: 'black & white at full 300 DPI' },
  { id: 'bw200', mode: 'bw', dpi: 200, name: 'black & white at 200 DPI' },
  { id: 'bw150', mode: 'bw', dpi: 150, name: 'black & white at 150 DPI' },
  { id: 'g300', mode: 'grey', dpi: 300, quality: 0.8, name: 'greyscale at 300 DPI' },
  { id: 'g200', mode: 'grey', dpi: 200, quality: 0.75, name: 'greyscale at 200 DPI' },
  { id: 'g150', mode: 'grey', dpi: 150, quality: 0.75, name: 'greyscale at 150 DPI' },
];

let pdfjs;
export async function openPdf(bytes) {
  pdfjs ??= await loadPdfjs();
  return pdfjs.getDocument({ data: bytes }).promise;
}

/* The build inlines pdf.js as gzipped base64 (see build.mjs), so the page
   works from disk with no server and no network. A page opened from disk has
   an opaque origin, and browsers won't start a module worker from it, so the
   worker code is handed to pdf.js to run on the main thread instead. */
async function loadPdfjs() {
  globalThis.pdfjsWorker = await import(await inlinedModule('pdfjs-worker'));
  return import(await inlinedModule('pdfjs-lib'));
}

async function inlinedModule(id) {
  const gz = await fetch(`data:application/gzip;base64,${document.getElementById(id).textContent}`);
  const js = await new Response(gz.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
}

/** Render a page onto a white canvas at `dpi`. */
export async function renderPage(page, dpi = BASE_DPI) {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = makeCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** What a rendered page holds; see classify(). */
export const inspect = (canvas) => classify(pixels(canvas));

/**
 * Encode a page rendered at BASE_DPI in every treatment of `mode`.
 * Returns { [rungId]: page } in the shape buildPdf() takes (see pdfwrite.js).
 */
export async function encodePage(page, canvas, look, mode) {
  const { width: widthPt, height: heightPt } = page.getViewport({ scale: 1 });
  const out = {};
  for (const rung of RUNGS.filter((r) => r.mode === mode)) {
    out[rung.id] = { widthPt, heightPt, ...(await encode(atDpi(canvas, rung.dpi), rung, look)) };
    await new Promise((r) => setTimeout(r)); // let the page repaint between encodes
  }
  return out;
}

async function encode(canvas, rung, look) {
  const { width: pixW, height: pixH } = canvas;
  if (rung.mode === 'bw' && look.textLike) {
    const bits = threshold(toGray(pixels(canvas)), pixW, pixH);
    return { kind: 'g4', pixW, pixH, data: encodeG4(bits, pixW, pixH) };
  }
  // A photo can't go black & white, so on the bilevel path it gets a lean JPEG.
  const quality = rung.mode === 'bw' ? PHOTO_QUALITY : rung.quality;
  const data = await jpeg(look.colour ? canvas : greyCopy(canvas), quality);
  return { kind: 'jpeg', pixW, pixH, colour: look.colour, data };
}

/** Draw the black & white version of `from` into the canvas `into`. */
export function drawThresholded(from, into) {
  const { width, height } = from;
  const bits = threshold(toGray(pixels(from)), width, height);
  into.width = width;
  into.height = height;
  into.getContext('2d').putImageData(greyImage(bits.map((paper) => paper * 255), width, height), 0, 0);
}

export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

const pixels = (canvas) => canvas.getContext('2d', { willReadFrequently: true })
  .getImageData(0, 0, canvas.width, canvas.height).data;

function atDpi(canvas, dpi) {
  if (dpi === BASE_DPI) return canvas;
  const s = dpi / BASE_DPI;
  const out = makeCanvas(canvas.width * s, canvas.height * s);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function greyCopy(canvas) {
  const out = makeCanvas(canvas.width, canvas.height);
  out.getContext('2d').putImageData(greyImage(toGray(pixels(canvas)), out.width, out.height), 0, 0);
  return out;
}

/** One grey level per pixel as opaque ImageData. */
function greyImage(levels, width, height) {
  const img = new ImageData(width, height);
  const px = new Uint32Array(img.data.buffer); // RGBA little-endian: alpha is the top byte
  levels.forEach((v, i) => { px[i] = 0xff000000 | (v * 0x010101); });
  return img;
}

async function jpeg(canvas, quality) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}
