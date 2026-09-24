import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeG4 } from '../src/ccitt.js';
import { buildPdf, pdfSize } from '../src/pdfwrite.js';
import { assertSameBits, bitmap, hasPoppler, pillow, readNetpbm, run, scratch } from './helpers.js';

test('writes a PDF poppler reads back page for page', (t) => {
  const dir = scratch();
  pillow('jpeg', join(dir, 'grey.jpg'));
  const jpeg = new Uint8Array(readFileSync(join(dir, 'grey.jpg')));
  const ink = bitmap(200, 100, (x, y) => (x >> 4) % 2 || y < 50);
  const pages = [
    { widthPt: 595.276, heightPt: 841.89, kind: 'g4', pixW: 200, pixH: 100, data: encodeG4(ink.bits, 200, 100) },
    { widthPt: 841.89, heightPt: 595.276, kind: 'jpeg', pixW: 64, pixH: 48, data: jpeg },
  ];
  const pdf = buildPdf(pages);
  assert.equal(pdfSize(pages), pdf.length, 'pdfSize() must predict the exact length');

  // Viewers quietly rebuild a broken cross-reference table, so check it here:
  // 20-byte entries, each pointing at its object, and startxref at the table.
  const text = Buffer.from(pdf).toString('latin1');
  const [, size, entries] = text.match(/\nxref\n0 (\d+)\n0{10} 65535 f \n((?:\d{10} 00000 n \n)+)trailer\n/) ?? [];
  assert.ok(entries, 'malformed xref table');
  const offsets = entries.match(/\d{10}/g);
  assert.equal(offsets.length, size - 1);
  offsets.forEach((at, i) => assert.ok(text.startsWith(`${i + 1} 0 obj\n`, +at), `object ${i + 1}`));
  assert.equal(+text.match(/startxref\n(\d+)\n%%EOF\n$/)[1], text.lastIndexOf('\nxref\n') + 1);

  if (!hasPoppler) {
    t.diagnostic('Skipping poppler verification (pdfinfo/pdfimages not installed)');
    return;
  }

  const path = join(dir, 'out.pdf');
  writeFileSync(path, pdf);
  const info = run('pdfinfo', '-f', '1', '-l', '2', path);
  assert.match(info, /Pages:\s+2\n/);
  assert.match(info, /Page\s+1 size:\s+595\.28 x 841\.89 pts/);
  assert.match(info, /Page\s+2 size:\s+841\.89 x 595\.28 pts/);
  assert.doesNotMatch(info, /Producer|Creator|Title/, 'no metadata is written');

  const list = run('pdfimages', '-list', path).split('\n').slice(2).filter(Boolean).map((l) => l.trim().split(/\s+/));
  assert.deepEqual(list.map((c) => [c[3], c[4], c[5], c[7], c[8]]), [
    ['200', '100', 'gray', '1', 'ccitt'],
    ['64', '48', 'gray', '8', 'jpeg'],
  ]);

  run('pdfimages', '-all', path, join(dir, 'raw'));
  const jpg = readdirSync(dir).find((f) => /^raw-\d+\.jpg$/.test(f));
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, jpg))), jpeg, 'JPEG bytes pass through untouched');
  run('pdfimages', path, join(dir, 'px'));
  assertSameBits(readNetpbm(join(dir, 'px-000.pbm')), ink, 'G4 page decodes to the input');
});

test('builds multi-page sample documents matching synthetic scan structure', () => {
  const dir = scratch();
  pillow('jpeg', join(dir, 'page.jpg'));
  const jpeg = new Uint8Array(readFileSync(join(dir, 'page.jpg')));
  const pages = [1, 2, 3].map(() => ({
    widthPt: 595.28,
    heightPt: 841.89,
    pixW: 1240,
    pixH: 1754,
    kind: 'jpeg',
    colour: true,
    data: jpeg,
  }));
  const pdf = buildPdf(pages);
  assert.equal(pdfSize(pages), pdf.length, 'pdfSize predicts multi-page jpeg pdf size');
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.includes('/Type /Pages /Count 3'), 'Pages count is 3');
  assert.ok(text.includes('/Filter /DCTDecode'), 'Contains JPEG filter');
  assert.ok(text.includes('/ColorSpace /DeviceRGB'), 'Contains RGB colour space');
});
