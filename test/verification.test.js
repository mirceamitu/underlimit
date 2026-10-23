import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('dist/underlimit.html is under 950 KB and keeps the third-party licences', () => {
  const distPath = fileURLToPath(new URL('../dist/underlimit.html', import.meta.url));
  if (!existsSync(distPath)) {
    execFileSync(process.execPath, [fileURLToPath(new URL('../build.mjs', import.meta.url))], { stdio: 'ignore' });
  }
  assert.ok(existsSync(distPath), 'dist/underlimit.html must exist');

  const stat = statSync(distPath);
  assert.ok(stat.size <= 950 * 1024, `dist/underlimit.html size (${stat.size} bytes) must be <= 950 KB`);

  const html = read('../dist/underlimit.html');
  assert.ok(html.startsWith('<!DOCTYPE html>\n<!--'), 'Starts with DOCTYPE and license comment');
  assert.ok(html.includes('Apache License'), 'Preserves Apache-2.0 notice');
  assert.ok(html.includes('IBM Plex Sans'), 'Preserves IBM Plex Sans notice');
  assert.ok(html.includes('IBM Plex Mono'), 'Preserves IBM Plex Mono notice');
  assert.ok(html.includes('-->\n<html lang="en">'), 'Comment terminates before html element');
  assert.ok(html.includes('<style>@font-face{font-family:\'IBM Plex Sans\''), 'Fonts are inlined');
  assert.ok(html.includes('id="pdfjs-lib"'), 'pdfjs-lib script is inlined');
  assert.ok(html.includes('id="pdfjs-worker"'), 'pdfjs-worker script is inlined');
});
