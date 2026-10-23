/**
 * Underlimit: fit a scanned PDF under an upload limit, entirely in the page.
 */
import { buildPdf, pdfSize } from './pdfwrite.js';
import { RUNGS, drawThresholded, encodePage, inspect, makeCanvas, openPdf, renderPage } from './measure.js';
import { createSamplePdf } from './sample.js';

const MB = 1e6;          // a portal's "2 MB" is read the strict way, as 2,000,000 bytes
const STOP = 62;         // where the limit line sits on the sizer, in % of the track
const THUMB_HEIGHT = 147;
const PREVIEW = { dpi: 200, width: 0.86, top: 0.42, aspect: 470 / 1920 }; // legibility band
const HINT = 'Nothing is uploaded · works offline once loaded';
const SAMPLE_LABEL = document.getElementById('btnSample').textContent;

const $ = (id) => document.getElementById(id);
const mb = (bytes) => `${(bytes / MB).toFixed(2)} MB`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const settings = { limit: 2, grey: false };

/**
 * The file being worked on. Replaced, never reset, when the file changes, so
 * work still running for an old file writes into an object nobody reads.
 *   pages  [{ look, out: { [rungId]: encoded page } }]
 *   sizes  { [rungId]: exact output bytes }, once every page has that rung
 */
let job = null;

// --- Measuring -------------------------------------------------------------

export async function load(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    return showDrop('That isn’t a PDF. Choose a PDF and it will be measured here.', true);
  }
  const j = job = { file, doc: null, pages: [], sizes: {}, ready: false };
  const stale = () => j !== job;
  const fail = (message) => { if (!stale()) showDrop(message, true); };

  showResults(file);
  try {
    j.doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return fail('This PDF can’t be opened: it may be encrypted or damaged. Try exporting it again.');
  }
  if (stale()) return;

  const n = j.doc.numPages;
  $('fmeta').textContent = plural(n, 'page');
  const thumbs = addThumbs(n);
  for (let i = 0; i < n; i++) {
    say('Working.', `Page ${i + 1} of ${n}: rendering it, then encoding it to see what it really costs.`);
    try {
      await measure(j, i, 'bw', thumbs[i]);
    } catch (e) {
      return fail(`Page ${i + 1} couldn’t be processed. ${e?.message ?? ''}`);
    }
    if (stale()) return;
  }

  const text = j.pages.filter((p) => p.look.textLike).length;
  $('pgMeta').textContent = `${text} text · ${n - text} photo · click a page to compare`;
  $('modeNote').textContent = `Auto measured every page: ${text} carry ink on paper and can go black & white, `
    + (n - text ? `${n - text} hold continuous tone and stay in grey or colour.` : 'none hold photographs.');

  tally(j);
  j.ready = true;
  paint();

  const inkiest = j.pages.reduce((best, p, i) => (p.look.ink > j.pages[best].look.ink ? i : best), 0);
  await showPreview(j, inkiest);
  if (settings.grey) await measureGrey(j);
}

/** Render page `i` once and add the encodings of every `mode` rung to it. */
async function measure(j, i, mode, thumb) {
  const page = await j.doc.getPage(i + 1);
  let canvas;
  try {
    canvas = await renderPage(page);
    if (thumb) drawThumb(canvas, thumb);
    const entry = j.pages[i] ??= { look: inspect(canvas), out: {} };
    Object.assign(entry.out, await encodePage(page, canvas, entry.look, mode));
  } finally {
    if (canvas) canvas.width = canvas.height = 0; // free the 35 MB raster now
    page.cleanup();
  }
}

/* Greyscale costs a second render of every page and is the worse answer for
   a text scan, so it is only measured when asked for. */
async function measureGrey(j) {
  if (!j?.ready || j.greyStarted) return;
  j.greyStarted = true;
  try {
    for (let i = 0; i < j.pages.length; i++) {
      $('fmeta').textContent = `measuring greyscale, page ${i + 1} of ${j.pages.length}`;
      await measure(j, i, 'grey');
      if (j !== job) return;
    }
  } catch (e) {
    if (j !== job) return;
    console.error(e);
    settings.grey = false;
    $('mode').value = 'auto';
    $('modeNote').textContent = 'Greyscale couldn’t be measured for this file, so it stays black & white.';
  }
  $('fmeta').textContent = plural(j.pages.length, 'page');
  tally(j);
  paint();
}

function tally(j) {
  for (const { id } of RUNGS) {
    if (j.pages.every((p) => p.out[id])) j.sizes[id] = pdfSize(j.pages.map((p) => p.out[id]));
  }
}

// --- Choosing --------------------------------------------------------------

/** The best measured rung under the limit and DPI floor, or the closest miss. */
function choose() {
  const limit = settings.limit * MB, floor = +$('dpi').value;
  const mode = settings.grey ? 'grey' : 'bw';
  const rungs = RUNGS.filter((r) => r.mode === mode && job?.sizes[r.id] != null)
    .map((r) => ({ ...r, bytes: job.sizes[r.id] }));
  if (!rungs.length) return null;
  const allowed = rungs.filter((r) => r.dpi >= floor);
  const pick = allowed.find((r) => r.bytes <= limit) ?? allowed.at(-1) ?? rungs.at(-1);
  const fits = pick.bytes <= limit;
  return { pick, fits, floor, rescue: fits ? null : rungs.find((r) => r.bytes <= limit) };
}

// --- Drawing ---------------------------------------------------------------

function paint() {
  const limit = settings.limit * MB;
  const width = (bytes) => `${Math.min(100, (bytes / limit) * STOP)}%`;
  $('rail').style.setProperty('--stop', `${STOP}%`);
  $('stopCap').textContent = `Limit ${settings.limit} MB`;

  const sent = job?.file.size;
  $('barBefore').style.width = sent ? width(sent) : '0';
  $('barBefore').classList.toggle('inside', sent <= (limit * 100) / STOP);
  $('valBefore').classList.toggle('over', !!sent);
  $('sentSize').textContent = sent ? mb(sent) : '-';
  $('overBy').textContent = sent > limit ? `×${(sent / limit).toFixed(1)} over` : '';

  const choice = job?.ready && choose();
  $('btnDl').disabled = !choice; // e.g. greyscale picked but not measured yet
  const after = $('valAfter');
  after.classList.toggle('fits', !!choice?.fits);
  after.classList.toggle('over', !!choice && !choice.fits);
  $('barAfter').classList.toggle('over', !!choice && !choice.fits);
  if (!choice) {
    $('barAfter').style.width = '0';
    after.textContent = job ? 'measuring…' : '-';
    return;
  }

  const { pick, fits, floor, rescue } = choice;
  $('barAfter').style.width = width(pick.bytes);
  after.textContent = mb(pick.bytes);
  document.querySelectorAll('.pg .mode').forEach((chip, i) => {
    chip.textContent = pick.mode === 'bw' && job.pages[i]?.look.textLike ? 'B&W' : 'Grey';
  });

  $('verdict').classList.toggle('bad', !fits);
  $('btnDl').textContent = `${platform.verb} ${fits ? 'PDF' : 'anyway'}`;
  if (fits) {
    say(`Fits at ${mb(pick.bytes)}.`, `${capitalise(pick.name)}: the best quality that stays under `
      + `${settings.limit} MB. ${mb(limit - pick.bytes)} spare, all ${plural(job.pages.length, 'page')}, page size untouched.`);
  } else {
    say(`Can’t reach ${settings.limit} MB at ${floor} DPI or better.`, `Closest fit is ${mb(pick.bytes)} (${pick.name}). `
      + (rescue ? `Dropping to ${rescue.dpi} DPI would land at ${mb(rescue.bytes)}, still readable on screen.`
        : 'Raise the limit, or split the document into two uploads.'));
  }
  $('btnRescue').hidden = !rescue;
  if (rescue) {
    $('btnRescue').textContent = `Allow ${rescue.dpi} DPI`;
    $('btnRescue').onclick = () => setFloor(rescue.dpi);
  }
}

const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

function say(head, body) {
  $('verdictHead').textContent = head;
  $('verdictBody').textContent = body;
}

function showResults(file) {
  $('results').hidden = false;
  $('dropWrap').hidden = true;
  $('fname').textContent = file.name;
  $('fmeta').textContent = 'reading…';
  $('pgMeta').textContent = $('cmpMeta').textContent = '';
  $('pages').replaceChildren();
  $('verdict').classList.remove('bad');
  $('btnRescue').hidden = true;
  say('Working.', 'Opening the document.');
  paint();
}

export function showDrop(message = HINT, error = false) {
  job = null;
  $('results').hidden = true;
  $('dropWrap').hidden = false;
  $('hint').textContent = message;
  $('hint').classList.toggle('error', error);
  $('file').value = '';
  $('btnSample').disabled = false;
  $('btnSample').textContent = SAMPLE_LABEL;
  paint();
}

function addThumbs(n) {
  const template = $('thumb').content.firstElementChild;
  const thumbs = Array.from({ length: n }, (_, i) => {
    const thumb = template.cloneNode(true);
    thumb.dataset.i = i;
    thumb.querySelector('.num').textContent = String(i + 1).padStart(2, '0');
    return thumb;
  });
  $('pages').replaceChildren(...thumbs);
  return thumbs;
}

function drawThumb(canvas, thumb) {
  const target = thumb.querySelector('canvas');
  target.height = THUMB_HEIGHT;
  target.width = Math.round((THUMB_HEIGHT * canvas.width) / canvas.height);
  let src = canvas;
  while (src.width > target.width * 2) { // halve in steps: one 24× reduction aliases badly
    const half = makeCanvas(Math.max(target.width, src.width >> 1), Math.max(THUMB_HEIGHT, src.height >> 1));
    smooth(half).drawImage(src, 0, 0, half.width, half.height);
    src = half;
  }
  smooth(target).drawImage(src, 0, 0, target.width, target.height);
  thumb.classList.remove('working');
}

function smooth(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** A band from the middle of a page, as scanned and as it will be sent. */
async function showPreview(j, i) {
  const page = await j.doc.getPage(i + 1);
  try {
    const full = await renderPage(page, PREVIEW.dpi);
    if (j !== job) return;
    const before = $('cvBefore');
    before.width = Math.round(full.width * PREVIEW.width);
    before.height = Math.max(40, Math.round(before.width * PREVIEW.aspect));
    before.getContext('2d').drawImage(full, Math.round((full.width - before.width) / 2),
      Math.round(full.height * PREVIEW.top), before.width, before.height, 0, 0, before.width, before.height);
    drawThresholded(before, $('cvAfter'));
    $('compare').style.aspectRatio = `${before.width} / ${before.height}`;
    $('cmpMeta').textContent = `Page ${i + 1} · drag to wipe`;
    setWipe(0.5);
  } finally {
    page.cleanup();
  }
}

function setWipe(fraction) {
  const p = Math.max(0, Math.min(1, fraction)) * 100;
  $('topLayer').style.clipPath = `inset(0 ${100 - p}% 0 0)`;
  $('handle').style.left = `${p}%`;
}

function download() {
  const { pick } = choose();
  const bytes = buildPdf(job.pages.map((p) => p.out[pick.id]));
  platform.save(bytes, `${job.file.name.replace(/\.pdf$/i, '')} - under ${settings.limit}MB.pdf`);
}

/** What differs in the mobile app, which swaps these out (underlimit-mobile/src/main.js). */
export const platform = {
  verb: 'Download',
  save(bytes, name) {
    const link = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })),
      download: name,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  },
};

// --- Controls --------------------------------------------------------------

function setLimit(limit, custom = false) {
  settings.limit = limit;
  for (const b of $('seg').children) b.setAttribute('aria-pressed', String(!custom && +b.dataset.mb === limit));
  if (!custom) $('cust').value = '';
  paint();
}

function setFloor(dpi) {
  $('dpi').value = dpi;
  $('dpiVal').textContent = `${dpi} DPI`;
  paint();
}

$('seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setLimit(+b.dataset.mb);
});
$('cust').addEventListener('input', (e) => {
  const limit = parseFloat(e.target.value);
  if (limit >= 0.2) setLimit(limit, true);
});
$('dpi').addEventListener('input', (e) => setFloor(+e.target.value));
$('mode').addEventListener('change', (e) => {
  settings.grey = e.target.value === 'grey';
  paint();
  if (settings.grey) measureGrey(job);
});
$('btnDl').addEventListener('click', download);
$('btnOther').addEventListener('click', () => { showDrop(); $('drop').focus(); });

const drop = $('drop');
drop.addEventListener('click', () => $('file').click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); }
});
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hot'); });
drop.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && drop.contains(e.relatedTarget)) return;
  drop.classList.remove('hot');
});
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('hot');
  if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
});
$('file').addEventListener('change', (e) => {
  if (e.target.files[0]) load(e.target.files[0]);
});

$('pages').addEventListener('click', (e) => {
  const thumb = e.target.closest('.pg');
  if (!thumb || !job?.ready) return;
  for (const t of $('pages').children) t.setAttribute('aria-current', String(t === thumb));
  showPreview(job, +thumb.dataset.i);
});

const compare = $('compare');
const wipeTo = (x) => { const r = compare.getBoundingClientRect(); setWipe((x - r.left) / r.width); };
compare.addEventListener('pointerdown', (e) => { compare.setPointerCapture(e.pointerId); wipeTo(e.clientX); });
compare.addEventListener('pointermove', (e) => { if (compare.hasPointerCapture(e.pointerId)) wipeTo(e.clientX); });

$('btnSample').addEventListener('click', async (e) => {
  e.stopPropagation(); // the button sits inside the drop zone, which opens the file picker
  const btn = e.currentTarget, before = job;
  btn.disabled = true;
  btn.textContent = 'Generating sample scan…';
  try {
    const file = await createSamplePdf();
    if (job === before) await load(file); // unless a file was dropped meanwhile
  } catch (err) {
    console.error(err);
    if (job === before) showDrop(`Could not create sample PDF. ${err?.message ?? ''}`, true);
  }
});
$('btnSample').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
});

// Offer the page itself as a download, unless this already is a saved copy.
if (location.protocol === 'file:') $('saveCopy').remove();
else $('saveCopy').querySelector('a').href = location.href;

paint();
