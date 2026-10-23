import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choose } from '../src/measure.js';

const sizes = { bw300: 3e6, bw200: 1.8e6, bw150: 1.1e6 };

test('choose picks the best resolution that fits', () => {
  const c = choose(sizes, 2e6, 150, 'bw');
  assert.deepEqual([c.pick.id, c.fits, c.rescue], ['bw200', true, null]);
});

test('choose names the closest miss and the DPI that would fit', () => {
  const c = choose(sizes, 2e6, 300, 'bw');
  assert.deepEqual([c.pick.id, c.fits, c.rescue.id], ['bw300', false, 'bw200']);
  const none = choose(sizes, 1e6, 150, 'bw');
  assert.deepEqual([none.pick.id, none.fits, none.rescue], ['bw150', false, null]);
});

test('choose waits until a rung of the mode is measured', () => {
  assert.equal(choose(sizes, 2e6, 150, 'grey'), null);
  assert.equal(choose({ bw300: 2e6 }, 2e6, 150, 'bw').fits, true, 'exactly at the limit fits');
});
