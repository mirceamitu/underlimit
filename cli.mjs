#!/usr/bin/env node
/**
 * Underlimit CLI: shrink a scanned PDF under an upload limit, offline. Made
 * for AI agents: stdout is one JSON object, progress goes to stderr, and the
 * exit code says what happened. Same pipeline as the web page (src/).
 */
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { canvasApi, choose, encodePage, inspect, renderPage, RUNGS } from './src/measure.js';
import { buildPdf, pdfSize } from './src/pdfwrite.js';

const HELP = `underlimit: shrink a scanned PDF under an upload limit. Offline: no network, ever.

Usage: underlimit <input.pdf> --limit <MB> [--min-dpi 300|200|150] [-o <output.pdf>]

  --limit     the cap in decimal MB: --limit 2 means 2,000,000 bytes
  --min-dpi   lowest resolution allowed (default 300); see "rescue" on exit 1
  -o          output path (default: <input>.under-<limit>MB.pdf next to the input;
              overwritten if it exists; never the input itself)

Pages that are ink on paper become black & white (CCITT G4); pages with photos stay JPEG.
Every page becomes an image: selectable text is lost (reported in "warnings").

Stdout is one JSON object. Exit codes:
  0  fits. "output" is the file written, "output.bytes" its exact size. If the input
     already fits, nothing is written: "alreadyFits": true, "output": null.
  1  can't fit at --min-dpi. Nothing is written. "closest" is the best miss; "rescue"
     names a lower --min-dpi that would fit, or is null.
  2  error, nothing written: {"error": {"code", "message"}}. Codes: usage, not_found,
     not_pdf, encrypted, output_is_input, internal.

Progress ("page 3/18") goes to stderr. About 0.5 s per page.

Examples:
  underlimit scan.pdf --limit 2
  underlimit scan.pdf --limit 5 --min-dpi 150 -o out/scan-small.pdf`;

class Failure extends Error {
  constructor(code, message) { super(message); this.failure = code; }
}

async function run(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: {
      limit: { type: 'string' }, 'min-dpi': { type: 'string', default: '300' },
      output: { type: 'string', short: 'o' }, help: { type: 'boolean', short: 'h' },
    } });
  } catch (e) {
    throw new Failure('usage', `${e.message}. Run with --help.`);
  }
  const { values, positionals } = args;
  if (values.help) return [0, null];
  const limitMb = Number(values.limit), floor = Number(values['min-dpi']);
  if (positionals.length !== 1) throw new Failure('usage', 'Give exactly one input PDF. Run with --help.');
  if (!(limitMb > 0)) throw new Failure('usage', '--limit must be a number of MB above 0, e.g. --limit 2.');
  if (!(floor > 0)) throw new Failure('usage', '--min-dpi must be a number above 0, e.g. --min-dpi 150.');

  const inputPath = resolve(positionals[0]);
  const outputPath = resolve(values.output ?? join(dirname(inputPath),
    `${basename(inputPath).replace(/\.pdf$/i, '')}.under-${limitMb}MB.pdf`));
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (same(inputPath, outputPath)) throw new Failure('output_is_input', 'The output path is the input file. Choose another -o.');

  let bytes;
  try {
    bytes = readFileSync(inputPath);
  } catch (e) {
    throw new Failure('not_found', `Can't read ${inputPath}: ${e.code ?? e.message}.`);
  }
  const limit = Math.floor(limitMb * 1e6);
  const input = { path: inputPath, bytes: bytes.length, pages: 0 };

  let doc;
  try {
    // pdf.js empties the buffer it is given, so it gets a copy.
    doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0, standardFontDataUrl: STANDARD_FONTS }).promise;
  } catch (e) {
    if (e.name === 'PasswordException') {
      throw new Failure('encrypted', 'The PDF is password-protected. Ask the user for an unprotected copy.');
    }
    throw new Failure('not_pdf', `Not a readable PDF: ${e.message}`);
  }
  try {
    input.pages = doc.numPages;
    if (bytes.length <= limit) {
      return [0, { fits: true, alreadyFits: true, limitBytes: limit, input, output: null, warnings: [] }];
    }

    const pages = [], textPages = [], warnings = [];
    for (let n = 1; n <= doc.numPages; n++) {
      process.stderr.write(`page ${n}/${doc.numPages}\n`);
      const page = await doc.getPage(n);
      let canvas;
      try {
        if ((await page.getTextContent()).items.some((item) => item.str?.trim())) textPages.push(n);
        canvas = await renderPage(page);
        const dpi = Math.round((canvas.width * 72) / page.getViewport({ scale: 1 }).width);
        if (dpi < 299) warnings.push(`page ${n} is very large, so it was rendered at ${dpi} DPI, not 300`);
        pages.push(await encodePage(page, canvas, inspect(canvas), 'bw'));
      } finally {
        if (canvas) canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
    if (textPages.length) {
      warnings.unshift(`page${textPages.length > 1 ? 's' : ''} ${textPages.join(', ')} `
        + 'had selectable text, which the output does not keep');
    }

    const sizes = {};
    for (const { id, mode } of RUNGS) if (mode === 'bw') sizes[id] = pdfSize(pages.map((p) => p[id]));
    const { pick, fits, rescue } = choose(sizes, limit, floor, 'bw');
    if (!fits) {
      return [1, {
        fits: false, limitBytes: limit, input, output: null,
        closest: { dpi: pick.dpi, bytes: pick.bytes }, rescue: rescue && { dpi: rescue.dpi, bytes: rescue.bytes },
        warnings,
      }];
    }
    const pdf = buildPdf(pages.map((p) => p[pick.id]));
    writeFileSync(outputPath, pdf);
    return [0, {
      fits: true, alreadyFits: false, limitBytes: limit, input,
      output: { path: outputPath, bytes: pdf.length, dpi: pick.dpi },
      pages: pages.map((p, i) => ({ n: i + 1, kind: p[pick.id].kind })),
      warnings,
    }];
  } finally {
    await doc.destroy();
  }
}

const STANDARD_FONTS = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts/');

canvasApi.create = () => createCanvas(1, 1);
canvasApi.jpeg = async (canvas, quality) => new Uint8Array(await canvas.encode('jpeg', Math.round(quality * 100)));
// stdout carries only the JSON result; pdf.js and anything else logging go to stderr.
console.log = console.info = console.warn = console.error;

let code, result;
try {
  [code, result] = await run(process.argv.slice(2));
} catch (e) {
  code = 2;
  result = { error: e.failure ? { code: e.failure, message: e.message } : { code: 'internal', message: String(e?.stack ?? e) } };
}
if (result) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else process.stdout.write(`${HELP}\n`);
process.exitCode = code;
