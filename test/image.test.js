import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { classify, threshold, toGray } from '../src/image.js';
import { pillow, random, readNetpbm, scratch } from './helpers.js';

const rgba = (n, pixel) => {
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) out.set([...pixel(i), 255], i * 4);
  return out;
};

test('toGray uses BT.601 weights', () => {
  assert.deepEqual([...toGray(Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255))],
    [76, 150, 27, 255]);
});

test('threshold keeps unevenly lit paper white and keeps the ink', () => {
  const dir = scratch();
  pillow('scan', join(dir, 'scan.pgm'));
  const { width, height, gray } = readNetpbm(join(dir, 'scan.pgm'));
  const bits = threshold(gray, width, height);
  const inkShare = (y0, y1, x0 = 0, x1 = width) => {
    let ink = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink += 1 - bits[y * width + x];
    return ink / ((y1 - y0) * (x1 - x0));
  };
  // The bottom of the page is ~30% darker than the top, which a fixed cut-off
  // would turn into a black band. The margins must stay clean everywhere...
  assert.equal(inkShare(0, height, 0, 150), 0, 'left margin has ink');
  assert.ok(gray[(height - 20) * width + 20] < 200, 'fixture is not dim enough to test anything');
  // ...and the text must survive equally well in bright and dim light.
  const top = inkShare(300, 900), bottom = inkShare(height - 900, height - 300);
  assert.ok(top > 0.02 && Math.abs(top - bottom) / top < 0.25, `ink ${top} at the top vs ${bottom} at the bottom`);
});

test('classify tells text from photographs and colour from grey', () => {
  const r = random(3);
  const text = classify(rgba(40000, (i) => (i % 97 < 6 ? [30, 30, 30] : [240, 238, 236])));
  const photo = classify(rgba(40000, () => { const v = r() * 255; return [v, v, v]; }));
  const colour = classify(rgba(40000, (i) => (i % 2 ? [200, 60, 40] : [40, 90, 200])));
  assert.deepEqual([text.textLike, text.colour], [true, false]);
  assert.equal(photo.textLike, false);
  assert.deepEqual([colour.textLike, colour.colour], [false, true]);
});
