/**
 * Test helpers. External decoders keep the tests honest: poppler (the PDF
 * path) and libtiff through Pillow (a second, independent implementation).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPdf } from '../src/pdfwrite.js';

export const scratch = () => mkdtempSync(join(tmpdir(), 'underlimit-'));
export const run = (cmd, ...args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function findPython() {
  const candidates = process.env.PYTHON ? [process.env.PYTHON, 'python', 'python3', 'py'] : ['python', 'python3', 'py'];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['-c', 'import PIL'], { stdio: 'ignore' });
      return cmd;
    } catch {}
  }
  return 'python3';
}
const PYTHON = findPython();
export const pillow = (...args) => run(PYTHON, fileURLToPath(new URL('pillow.py', import.meta.url)), ...args);

function findPoppler() {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['pdfimages'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
export const hasPoppler = findPoppler();

/** { width, height, bits } with bits[i] 1 = white, 0 = black. */
export function bitmap(width, height, isWhite) {
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) bits[y * width + x] = isWhite(x, y) ? 1 : 0;
  }
  return { width, height, bits };
}

/** Deterministic xorshift32, so a failing case can be reproduced. */
export function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 2 ** 32;
  };
}

export function assertSameBits(got, want, label) {
  assert.deepEqual([got.width, got.height], [want.width, want.height], `${label}: size`);
  const i = want.bits.findIndex((b, k) => b !== got.bits[k]);
  if (i >= 0) {
    assert.fail(`${label}: first differing pixel at (${i % want.width}, ${Math.floor(i / want.width)})`);
  }
}

// Netpbm. PBM stores 1 = black, the opposite of our bitmaps.

export function writePbm(path, { width, height, bits }) {
  const stride = (width + 7) >> 3;
  const body = new Uint8Array(stride * height);
  bits.forEach((white, i) => {
    const x = i % width, y = (i / width) | 0;
    if (!white) body[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
  });
  writeFileSync(path, Buffer.concat([Buffer.from(`P4\n${width} ${height}\n`), body]));
}

export function readNetpbm(path) {
  const buf = readFileSync(path);
  const fields = [];
  let at = 0;
  while (fields.length < (buf[1] === 0x34 ? 3 : 4)) { // P4 has no maxval
    while (/\s/.test(String.fromCharCode(buf[at]))) at++;
    const start = at;
    while (!/\s/.test(String.fromCharCode(buf[at]))) at++;
    fields.push(buf.toString('latin1', start, at));
  }
  const [magic, width, height] = [fields[0], +fields[1], +fields[2]];
  const body = buf.subarray(at + 1);
  if (magic === 'P5') return { width, height, gray: new Uint8Array(body.subarray(0, width * height)) };
  const stride = (width + 7) >> 3;
  return bitmap(width, height, (x, y) => !((body[y * stride + (x >> 3)] << (x & 7)) & 0x80));
}

/** Decode G4 streams with libtiff. */
export function libtiffDecode(dir, items) {
  const spec = items.map(({ stream, width, height }, i) => {
    writeFileSync(join(dir, `${i}.g4`), stream);
    return { g4: join(dir, `${i}.g4`), out: join(dir, `${i}.pbm`), width, height };
  });
  writeFileSync(join(dir, 'decode.json'), JSON.stringify(spec));
  pillow('decode', join(dir, 'decode.json'));
  return spec.map(({ out }) => readNetpbm(out));
}

/** Put G4 streams in one PDF and decode them with poppler's CCITTFaxDecode. */
export function popplerDecode(dir, items) {
  const pdf = join(dir, 'g4.pdf');
  writeFileSync(pdf, buildPdf(items.map(({ stream, width, height }) => (
    { kind: 'g4', data: stream, pixW: width, pixH: height, widthPt: width, heightPt: height }))));
  run('pdfimages', pdf, join(dir, 'im'));
  return readdirSync(dir).filter((f) => /^im-\d+\.pbm$/.test(f))
    .sort((a, b) => parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10))
    .map((f) => readNetpbm(join(dir, f)));
}
