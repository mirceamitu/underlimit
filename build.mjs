/**
 * Builds dist/underlimit.html: one self-contained file that works offline,
 * straight from disk. Everything is inlined (the app, pdf.js gzipped, the
 * fonts), along with the licences of the third-party parts.
 *
 *   npm run build
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const read = (path) => readFileSync(new URL(path, import.meta.url));
const base64 = (bytes) => Buffer.from(bytes).toString('base64');

const fonts = [
  ['IBM Plex Sans', 'ibm-plex-sans', [400, 500, 600]],
  ['IBM Plex Mono', 'ibm-plex-mono', [400, 500, 600]],
].flatMap(([family, pkg, weights]) => weights.map((weight) => {
  const woff2 = read(`node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2`);
  return `@font-face{font-family:'${family}';font-weight:${weight};font-display:swap;`
    + `src:url(data:font/woff2;base64,${base64(woff2)}) format('woff2')}`;
}));

// Inert until measure.js decompresses them into module URLs.
const pdfjs = [['pdfjs-lib', 'pdf'], ['pdfjs-worker', 'pdf.worker']].map(([id, name]) => {
  const gz = gzipSync(read(`node_modules/pdfjs-dist/build/${name}.min.mjs`), { level: 9 });
  return `<script type="text/plain" id="${id}">${base64(gz)}</script>`;
});

const { outputFiles: [app] } = await build({
  entryPoints: [fileURLToPath(new URL('src/app.js', import.meta.url))],
  bundle: true, format: 'esm', target: 'es2022', write: false, legalComments: 'none',
});
if (app.text.includes('</script')) throw new Error('app bundle contains "</script"');

const notices = [
  ['pdf.js', 'node_modules/pdfjs-dist/LICENSE'],
  ['IBM Plex Sans', 'node_modules/@fontsource/ibm-plex-sans/LICENSE'],
  ['IBM Plex Mono', 'node_modules/@fontsource/ibm-plex-mono/LICENSE'],
].map(([name, path]) => `${name}\n\n${read(path).toString().trim()}`);
if (notices.some((text) => text.includes('-->'))) throw new Error('a licence text would close the header comment');
const { version, homepage } = JSON.parse(read('package.json'));
const header = `<!--\nUnderlimit ${version}${homepage ? ` · ${homepage}` : ''}. MIT licence.\n\n`
  + `This file includes third-party software under these licences:\n\n`
  + `${notices.join('\n\n----------------------------------------\n\n')}\n-->\n`;

// Replacer functions, so a "$&" in the inlined code is not read as a pattern.
const html = read('src/index.html').toString()
  .replace('<!DOCTYPE html>\n', () => `<!DOCTYPE html>\n${header}`)
  .replace('<!-- build:fonts -->', () => `<style>${fonts.join('')}</style>`)
  .replace('<!-- build:pdfjs -->', () => pdfjs.join('\n'))
  .replace('<!-- build:app -->', () => `<script type="module">\n${app.text}</script>`);

mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
const out = new URL('dist/underlimit.html', import.meta.url);
writeFileSync(out, html);
const size = statSync(out).size;
console.log(`dist/underlimit.html  ${(size / 1e6).toFixed(2)} MB`);
if (size > 950 * 1024) throw new Error(`dist/underlimit.html exceeded 950 KB limit: ${size} bytes`);

const ogPng = new URL('og-image.png', import.meta.url);
if (!existsSync(ogPng)) {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      execFileSync(cmd, [fileURLToPath(new URL('test/pillow.py', import.meta.url)), 'og', fileURLToPath(ogPng)], { stdio: 'ignore' });
      break;
    } catch {}
  }
}
for (const img of ['og-image.svg', 'og-image.png']) {
  const src = new URL(img, import.meta.url);
  if (existsSync(src)) {
    copyFileSync(src, new URL(`dist/${img}`, import.meta.url));
  }
}



