/**
 * The CLI as an agent sees it: a child process, one JSON object on stdout,
 * an exit code. Every run also fails loudly if anything calls fetch().
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { buildPdf } from '../src/pdfwrite.js';
import { scratch } from './helpers.js';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const NO_NETWORK = `data:text/javascript,${encodeURIComponent(
  "globalThis.fetch = () => { process.stderr.write('NETWORK USED\\n'); throw new Error('no network'); };")}`;

function cli(...args) {
  const r = spawnSync(process.execPath, [`--import=${NO_NETWORK}`, CLI, ...args], { encoding: 'utf8' });
  assert.doesNotMatch(r.stderr, /NETWORK USED/, 'the CLI must never touch the network');
  return { code: r.status, json: JSON.parse(r.stdout), stderr: r.stderr };
}

/** A grainy 300 DPI A4 scan: bars of "text", and a grey photo on page 3. Canvas text
 *  is avoided on purpose: it aborts @napi-rs/canvas on Windows ARM64 (no ICU data). */
async function scanPdf() {
  const W = 2480, H = 3508, pages = [];
  for (let n = 0; n < 3; n++) {
    const c = createCanvas(W, H), x = c.getContext('2d');
    x.fillStyle = '#f1f2ec'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1a1c20';
    for (let y = 300; y < H - 300; y += 64) {
      for (let cx = 240; cx < W - 300; cx += 22) if ((cx * 7 + y) % 5) x.fillRect(cx, y - 26, 14, 30);
    }
    if (n === 2) { x.fillStyle = '#6b7f90'; x.fillRect(260, 460, 560, 720); }
    const img = x.getImageData(0, 0, W, H);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const g = ((seed >>> 16) % 25) - 12;
      img.data[i] += g; img.data[i + 1] += g; img.data[i + 2] += g;
    }
    x.putImageData(img, 0, 0);
    pages.push({ widthPt: 595.28, heightPt: 841.89, pixW: W, pixH: H, kind: 'jpeg', data: await c.encode('jpeg', 85) });
  }
  return buildPdf(pages);
}

/** A one-page PDF made on a computer: real text in Helvetica, no images. */
function textPdf() {
  const draw = 'BT /F1 24 Tf 72 720 Td (Selectable text) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

const dir = scratch();
const scan = join(dir, 'scan.pdf');
writeFileSync(scan, await scanPdf());
const scanBytes = statSync(scan).size;

test('fits: writes the output and reports its exact size', () => {
  const out = join(dir, 'fits.pdf');
  const { code, json, stderr } = cli(scan, '--limit', '2', '-o', out);
  assert.equal(code, 0);
  assert.equal(json.fits, true);
  assert.equal(json.alreadyFits, false);
  assert.equal(json.output.path, out);
  assert.equal(json.output.bytes, statSync(out).size, 'reported size is the file size');
  assert.ok(json.output.bytes <= 2e6 && json.limitBytes === 2e6);
  assert.deepEqual(json.pages.map((p) => p.kind), ['g4', 'g4', 'jpeg'], 'the photo page stays JPEG');
  assert.deepEqual(json.warnings, []);
  assert.equal(readFileSync(out, 'latin1').slice(0, 5), '%PDF-');
  assert.equal(statSync(scan).size, scanBytes, 'the input is untouched');
  assert.match(stderr, /page 3\/3/, 'progress goes to stderr');
});

test("can't fit: exit 1, nothing written, closest miss and rescue reported", () => {
  const { code, json } = cli(scan, '--limit', '0.3');
  assert.equal(code, 1);
  assert.equal(json.fits, false);
  assert.equal(json.output, null);
  assert.ok(!existsSync(join(dir, 'scan.under-0.3MB.pdf')), 'no over-limit file is written');
  assert.equal(json.closest.dpi, 300);
  assert.ok(json.closest.bytes > 3e5);
  if (json.rescue) assert.ok(json.rescue.dpi < 300 && json.rescue.bytes <= 3e5);
});

test('already fits: exit 0, nothing written', () => {
  const { code, json } = cli(scan, '--limit', '100');
  assert.equal(code, 0);
  assert.deepEqual([json.fits, json.alreadyFits, json.output], [true, true, null]);
  assert.deepEqual([json.input.bytes, json.input.pages], [scanBytes, 3]);
  assert.ok(!existsSync(join(dir, 'scan.under-100MB.pdf')));
});

test('warns that selectable text is lost', () => {
  const file = join(dir, 'typed.pdf');
  writeFileSync(file, textPdf());
  const { code, json } = cli(file, '--limit', '0.0001');
  assert.equal(code, 1, 'nothing fits in 100 bytes');
  assert.match(json.warnings[0], /^page 1 had selectable text/);
});

test('errors: exit 2 with a code an agent can branch on', () => {
  const notPdf = join(dir, 'notes.pdf');
  writeFileSync(notPdf, 'just text');
  const cases = [
    [[notPdf, '--limit', '2'], 'not_pdf'],
    [[join(dir, 'missing.pdf'), '--limit', '2'], 'not_found'],
    [[scan], 'usage'],
    [[scan, '--limit', 'two'], 'usage'],
    [[scan, '--limit', '2', '--bogus'], 'usage'],
    [[scan, '--limit', '2', '-o', scan], 'output_is_input'],
  ];
  for (const [args, want] of cases) {
    const { code, json } = cli(...args);
    assert.equal(code, 2, want);
    assert.equal(json.error.code, want);
    assert.ok(json.error.message);
  }
});
