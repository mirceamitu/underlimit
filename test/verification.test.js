import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('R1: src/index.html includes all required social sharing and meta tags', () => {
  const html = read('../src/index.html');

  // Viewport and Search description
  assert.match(html, /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*["']\s*>/i);
  assert.match(html, /<meta\s+name=["']description["']\s+content=["'][^"']+["']\s*>/i);
  assert.match(html, /<link\s+rel=["']canonical["']\s+href=["']https:\/\/mirceamitu\.github\.io\/underlimit\/["']\s*>/i);

  // Open Graph meta tags
  assert.match(html, /<meta\s+property=["']og:type["']\s+content=["']website["']\s*>/i);
  assert.match(html, /<meta\s+property=["']og:url["']\s+content=["']https:\/\/mirceamitu\.github\.io\/underlimit\/["']\s*>/i);
  assert.match(html, /<meta\s+property=["']og:title["']\s+content=["']Underlimit[^"']*["']\s*>/i);
  assert.match(html, /<meta\s+property=["']og:description["']\s+content=["'][^"']*1984\s+fax\s+compression[^"']*["']\s*>/i);
  assert.match(html, /<meta\s+property=["']og:image["']\s+content=["']https:\/\/mirceamitu\.github\.io\/underlimit\/og-image\.png["']\s*>/i);
  assert.match(html, /<meta\s+property=["']og:image:width["']\s+content=["']1200["']\s*>/i);
  assert.match(html, /<meta\s+property=["']og:image:height["']\s+content=["']630["']\s*>/i);

  // Twitter / X card tags
  assert.match(html, /<meta\s+name=["']twitter:card["']\s+content=["']summary_large_image["']\s*>/i);
  assert.match(html, /<meta\s+name=["']twitter:url["']\s+content=["']https:\/\/mirceamitu\.github\.io\/underlimit\/["']\s*>/i);
  assert.match(html, /<meta\s+name=["']twitter:title["']\s+content=["']Underlimit[^"']*["']\s*>/i);
  assert.match(html, /<meta\s+name=["']twitter:description["']\s+content=["'][^"']*1984\s+fax\s+compression[^"']*["']\s*>/i);
  assert.match(html, /<meta\s+name=["']twitter:image["']\s+content=["']https:\/\/mirceamitu\.github\.io\/underlimit\/og-image\.png["']\s*>/i);
});

test('R1: og-image.png and og-image.svg exist and are valid assets', () => {
  const pngPath = fileURLToPath(new URL('../og-image.png', import.meta.url));
  const svgPath = fileURLToPath(new URL('../og-image.svg', import.meta.url));

  assert.ok(existsSync(pngPath), 'og-image.png must exist');
  assert.ok(existsSync(svgPath), 'og-image.svg must exist');

  const pngBuf = readFileSync(pngPath);
  // PNG Magic Header: 89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual([...pngBuf.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'Valid PNG header');

  // IHDR chunk begins at offset 8 (length 4 bytes, 'IHDR', width 4 bytes, height 4 bytes)
  const width = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);
  assert.equal(width, 1200, 'Social preview PNG width must be 1200px');
  assert.equal(height, 630, 'Social preview PNG height must be 630px');

  const svgContent = readFileSync(svgPath, 'utf8');
  assert.ok(svgContent.includes('viewBox="0 0 1200 630"'), 'SVG has correct viewBox');
  assert.ok(svgContent.includes('UNDERLIMIT'), 'SVG contains title');
});

test('R2: Top header navigation contains GitHub repository link and icon', () => {
  const html = read('../src/index.html');
  assert.match(html, /<a\s+[^>]*href=["']https:\/\/github\.com\/mirceamitu\/underlimit["'][^>]*class=["'][^"']*gh-link[^"']*["']/i);
  assert.match(html, /aria-label=["']GitHub repository["']/i);
  assert.match(html, /title=["']Star Underlimit on GitHub["']/i);
  assert.match(html, /target=["']_blank["']/i);
  assert.match(html, /rel=["']noopener noreferrer["']/i);
  assert.match(html, /<svg\s+[^>]*viewBox=["']0 0 16 16["']/i);
});

test('R3: Drop zone contains sample scan action with edge case protections', () => {
  const html = read('../src/index.html');
  assert.match(html, /<button[^>]+id=["']btnSample["'][^>]*>/i);
  assert.match(html, /<button[^>]+class=["'][^"']*btn-sample[^"']*["'][^>]*>/i);
  assert.match(html, /⚡ Try 3-page sample scan/i);
  assert.match(html, /\.btn-sample:disabled\s*\{[^}]*pointer-events:\s*none/i, 'Has disabled state styling');

  const appJs = read('../src/app.js');
  assert.ok(appJs.includes('createSamplePdf()'), 'app.js defines createSamplePdf');
  assert.ok(appJs.includes('btnSample'), 'app.js wires btnSample');
  assert.ok(appJs.includes("btnSample.addEventListener('click'"), 'app.js handles btnSample click');
  assert.ok(appJs.includes("btnSample.addEventListener('keydown'"), 'app.js handles keyboard Enter/Space');
  assert.ok(appJs.includes('sampleGenToken'), 'app.js guards concurrent sample generation and drops');
  assert.ok(appJs.includes('drop.contains(e.relatedTarget)'), 'app.js prevents dragleave flickering over children');
  assert.ok(appJs.includes('canvasToJpegBytes'), 'app.js defines canvasToJpegBytes converter');
});

test('R4: README.md includes viral hook, comparison matrix, and Zero-Trust guarantee', () => {
  const readme = read('../README.md');

  // Viral hook
  assert.match(readme, /1984\s+fax\s+compression/i, 'Mentions 1984 fax compression');
  assert.match(readme, /CCITT\s+Group\s+4/i, 'Mentions CCITT Group 4');
  assert.match(readme, /100%\s+offline\s+in\s+browser\s+JavaScript/i, 'Mentions 100% offline in browser JavaScript');

  // Zero-Trust guarantee
  assert.match(readme, /The Zero-Trust Privacy Guarantee/i, 'Features Zero-Trust Privacy Guarantee section');
  assert.match(readme, /Zero Data Uploaded/i, 'Guarantees zero data uploaded');
  assert.match(readme, /Works with Wi-Fi Disabled/i, 'Mentions working with Wi-Fi disabled');
  assert.match(readme, /Single-File Lifetime Utility/i, 'Mentions single-file lifetime utility');

  // Comparison matrix
  assert.match(readme, /Comparison Matrix/i, 'Features Comparison Matrix');
  assert.match(readme, /Cloud Compressors/i, 'Compares against cloud compressors');
  assert.match(readme, /Standard PDF \(Flate\/ZIP\)/i, 'Compares against Flate/ZIP');
  assert.match(readme, /Brute-Force JPEG/i, 'Compares against JPEG');
});

test('R5: dist/underlimit.html is valid, under 950 KB, and preserves licenses', () => {
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
