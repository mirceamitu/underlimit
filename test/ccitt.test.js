import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { encodeG4 } from '../src/ccitt.js';
import { threshold } from '../src/image.js';
import {
  assertSameBits, bitmap, hasPoppler, libtiffDecode, pillow, popplerDecode, random, readNetpbm, scratch, writePbm,
} from './helpers.js';

const bits = (s) => [...s].map((b) => b.toString(2).padStart(8, '0')).join('');

/** Encode each bitmap and require both decoders to give it back exactly. */
function roundTrip(cases) {
  const items = cases.map((c) => ({ ...c, stream: encodeG4(c.bits, c.width, c.height) }));
  const decoders = [['libtiff', libtiffDecode]];
  if (hasPoppler) decoders.push(['poppler', popplerDecode]);
  for (const [decoder, decode] of decoders) {
    decode(scratch(), items).forEach((got, i) => assertSameBits(got, cases[i], `${cases[i].name} via ${decoder}`));
  }
}

test('rejects impossible sizes and short buffers', () => {
  for (const [w, h] of [[0, 4], [-1, 4], [4, -1], [2.5, 4]]) {
    assert.throws(() => encodeG4(new Uint8Array(16), w, h), RangeError, `${w}x${h}`);
  }
  assert.throws(() => encodeG4(new Uint8Array(10), 4, 4), RangeError);
  assert.equal(encodeG4(new Uint8Array(0), 8, 0).length, 0);
});

test('treats any non-zero sample as white', () => {
  const b = bitmap(41, 12, (x, y) => (x + 1) * y % 5 !== 0);
  const loose = b.bits.map((v) => v * 255);
  assert.deepEqual(encodeG4(loose, b.width, b.height), encodeG4(b.bits, b.width, b.height));
});

test('matches hand-computed lengths', () => {
  // Each all-white row against an all-white reference is a single V0 bit.
  assert.equal(encodeG4(bitmap(2480, 64, () => 1).bits, 2480, 64).length, 8);
  // All black: row 0 is H + white 0 (8) + black make-up 2432 (12) + black 48 (12)
  // = 35 bits, then 63 rows of V0 V0; 35 + 126 = 161 bits, 21 bytes.
  assert.equal(encodeG4(bitmap(2480, 64, () => 0).bits, 2480, 64).length, 21);
});

test('never emits EOL codes', () => {
  // No sequence of valid code words has eleven zeros in a row, so this pattern
  // can only be an EOL.
  for (const b of [bitmap(97, 40, (x, y) => (x * y) % 7), bitmap(3000, 4, (x) => x < 2 || x >= 2800)]) {
    assert.ok(!bits(encodeG4(b.bits, b.width, b.height)).includes('000000000001'));
  }
});

test('edge cases decode exactly', () => {
  const cases = [
    ['1x1 white', 1, 1, () => 1], ['1x1 black', 1, 1, () => 0],
    ['all white', 300, 200, () => 1], ['all black', 300, 200, () => 0],
    ['corners', 37, 23, (x, y) => !((x === 0 || x === 36) && (y === 0 || y === 22))],
    ['alternating columns', 512, 32, (x) => x % 2], ['alternating rows', 40, 40, (x, y) => y % 2],
    ['single row', 301, 1, (x) => x % 2], ['single column', 1, 50, (x, y) => y % 3],
    ['pass mode', 128, 64, (x, y) => !(x >= 20 + (y % 2) * 40 && x < 30 + (y % 2) * 40)],
    ['vertical mode edges', 200, 60, (x, y) => {
      const start = 10 + (y % 6) * (1 + ((y / 6) | 0)); // shifts of 1..4 px: VR/VL and past it
      return !(x >= start && x < start + 12);
    }],
    ...[1, 2, 3, 7, 9, 15, 17, 31, 33, 63, 65, 127, 129].map((w) => [`width ${w}`, w, 5, (x, y) => (x * 3 + y * 5) % 7]),
  ].map(([name, w, h, f]) => ({ name, ...bitmap(w, h, f) }));
  roundTrip(cases);
});

test('every run-length code decodes exactly', () => {
  // A case per table entry, so one wrong code word fails here and not on some
  // unlucky page: every terminating code, every make-up code (alone and with a
  // remainder), and runs long enough to repeat the largest make-up code.
  const lengths = [
    ...Array.from({ length: 63 }, (_, i) => i + 1),
    ...Array.from({ length: 40 }, (_, k) => (k + 1) * 64),
    ...[1, 27, 28, 40].map((k) => k * 64 + 37),
    2623, 2624, 2625, 5120, 8000,
  ];
  roundTrip(lengths.flatMap((n) => [
    { name: `black run ${n}`, ...bitmap(n + 8, 2, (x) => !(x >= 2 && x < 2 + n)) },
    { name: `white run ${n}`, ...bitmap(n + 8, 2, (x) => !(x < 2 || (x >= 2 + n && x < 4 + n))) },
  ]));
});

test('random bitmaps decode exactly', () => {
  const r = random(0x5eed);
  roundTrip(Array.from({ length: 200 }, (_, i) => {
    const w = 1 + Math.floor(r() * 90), h = 1 + Math.floor(r() * 40), density = r();
    return { name: `random ${i} (${w}x${h})`, ...bitmap(w, h, () => r() > density) };
  }));
});

test('is bit-identical to libtiff on a scanned page, and fast on a dithered one', () => {
  const dir = scratch();
  pillow('scan', join(dir, 'scan.pgm'));
  const { width, height, gray } = readNetpbm(join(dir, 'scan.pgm'));
  const page = { width, height, bits: threshold(gray, width, height) };
  const ours = encodeG4(page.bits, width, height);

  writePbm(join(dir, 'page.pbm'), page);
  writeFileSync(join(dir, 'encode.json'), JSON.stringify([{ pbm: join(dir, 'page.pbm'), out: join(dir, 'lib.g4') }]));
  pillow('encode', join(dir, 'encode.json'));
  const lib = bits(readFileSync(join(dir, 'lib.g4')));

  // libtiff's stream is ours, then its end-of-block marker (two EOL codes,
  // 000000000001 twice), then zero padding. Our own padding is up to 7 zeros.
  const mine = bits(ours).replace(/0{0,7}$/, '');
  assert.ok(lib.startsWith(mine), 'bit streams diverge');
  assert.match(lib.slice(mine.length), /^0{11,18}10{11}10{0,7}$/);
  assertSameBits(libtiffDecode(dir, [{ stream: ours, width, height }])[0], page, 'scan via libtiff');

  // Worst case for run coding: a change at every pixel. Linear in the width.
  const dither = bitmap(2480, 3508, (x) => x % 2);
  const t0 = performance.now();
  encodeG4(dither.bits, dither.width, dither.height);
  assert.ok(performance.now() - t0 < 3000, 'a dithered A4 page took more than 3 s');
});
