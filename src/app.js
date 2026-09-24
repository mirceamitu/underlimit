/**
 * Underlimit — fit a scanned PDF under an upload limit, entirely in the page.
 */
import { buildPdf, pdfSize } from './pdfwrite.js';
import { RUNGS, drawThresholded, encodePage, inspect, makeCanvas, openPdf, renderPage } from './measure.js';

const MB = 1e6;          // a portal's "2 MB" is read the strict way, as 2,000,000 bytes
const STOP = 62;         // where the limit line sits on the sizer, in % of the track
const THUMB_HEIGHT = 147;
const PREVIEW = { dpi: 200, width: 0.86, top: 0.42, aspect: 470 / 1920 }; // legibility band
const HINT = 'Nothing is uploaded · works offline once loaded';

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
let sampleGenToken = 0;

// --- Measuring -------------------------------------------------------------

async function load(file) {
  sampleGenToken++;
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
    return fail('This PDF can’t be opened — it may be encrypted or damaged. Try exporting it again.');
  }
  if (stale()) return;

  const n = j.doc.numPages;
  $('fmeta').textContent = plural(n, 'page');
  const thumbs = addThumbs(n);
  for (let i = 0; i < n; i++) {
    say('Working.', `Page ${i + 1} of ${n} — rendering it, then encoding it to see what it really costs.`);
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
  $('btnDl').disabled = false;
  paint();

  const inkiest = j.pages.reduce((best, p, i) => (p.look.ink > j.pages[best].look.ink ? i : best), 0);
  await showPreview(j, inkiest);
  if (settings.grey) await measureGrey(j);
}

/** Render page `i` once and add the encodings of every `mode` rung to it. */
async function measure(j, i, mode, thumb) {
  const page = await j.doc.getPage(i + 1);
  try {
    const canvas = await renderPage(page);
    if (thumb) drawThumb(canvas, thumb);
    const entry = j.pages[i] ??= { look: inspect(canvas), out: {} };
    Object.assign(entry.out, await encodePage(page, canvas, entry.look, mode));
  } finally {
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
  $('sentSize').textContent = sent ? mb(sent) : '—';
  $('overBy').textContent = sent > limit ? `×${(sent / limit).toFixed(1)} over` : '';

  const choice = job?.ready && choose();
  const after = $('valAfter');
  after.classList.toggle('fits', !!choice?.fits);
  after.classList.toggle('over', !!choice && !choice.fits);
  $('barAfter').classList.toggle('over', !!choice && !choice.fits);
  if (!choice) {
    $('barAfter').style.width = '0';
    after.textContent = job ? 'measuring…' : '—';
    return;
  }

  const { pick, fits, floor, rescue } = choice;
  $('barAfter').style.width = width(pick.bytes);
  after.textContent = mb(pick.bytes);
  document.querySelectorAll('.pg .mode').forEach((chip, i) => {
    chip.textContent = pick.mode === 'bw' && job.pages[i]?.look.textLike ? 'B&W' : 'Grey';
  });

  $('verdict').classList.toggle('bad', !fits);
  $('btnDl').textContent = fits ? 'Download PDF' : 'Download anyway';
  if (fits) {
    say(`Fits at ${mb(pick.bytes)}.`, `${capitalise(pick.name)} — the best quality that stays under `
      + `${settings.limit} MB. ${mb(limit - pick.bytes)} spare, all ${plural(job.pages.length, 'page')}, page size untouched.`);
  } else {
    say(`Can’t reach ${settings.limit} MB at ${floor} DPI or better.`, `Closest fit is ${mb(pick.bytes)} — ${pick.name}. `
      + (rescue ? `Dropping to ${rescue.dpi} DPI would land at ${mb(rescue.bytes)} — still readable on screen.`
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
  $('btnDl').disabled = true;
  $('btnRescue').hidden = true;
  say('Working.', 'Opening the document.');
  paint();
}

function showDrop(message = HINT, error = false) {
  sampleGenToken++;
  job = null;
  $('results').hidden = true;
  $('dropWrap').hidden = false;
  $('hint').textContent = message;
  $('hint').classList.toggle('error', error);
  $('file').value = '';
  const btn = $('btnSample');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '⚡ Try 3-page sample scan (2.6 MB → under 2 MB)';
  }
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
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })),
    download: `${job.file.name.replace(/\.pdf$/i, '')} - under ${settings.limit}MB.pdf`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

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
  sampleGenToken++;
  if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]);
});
$('file').addEventListener('change', (e) => {
  sampleGenToken++;
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

// --- Sample Document Generation -------------------------------------------

async function createSamplePdf() {
  const W = 1240, H = 1754;
  const pagesData = [];

  function drawScanNoise(ctx, w, h) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#fbfbfa');
    grad.addColorStop(0.5, '#f3f4ee');
    grad.addColorStop(1, '#e8ebe1');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.03)';
    ctx.fillRect(0, 0, 16, h);
    ctx.fillRect(w - 16, 0, 16, h);
  }

  function drawText(ctx, text, x, y, font = '18px monospace', fill = '#1a1c20') {
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  // Helper to convert canvas to JPEG Uint8Array
  async function canvasToJpegBytes(canvas, quality = 0.85) {
    if (typeof canvas.toBlob === 'function') {
      try {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob) return new Uint8Array(await blob.arrayBuffer());
      } catch {}
    }
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const comma = dataUrl.indexOf(',');
    const bin = atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // Page 1: Official Contract & Stamp
  {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawScanNoise(ctx, W, H);
    ctx.save();
    ctx.rotate(0.003);

    drawText(ctx, 'DEPARTMENT OF PUBLIC ADMINISTRATION & ARCHIVES', 130, 140, 'bold 24px monospace', '#111');
    drawText(ctx, 'STANDARD STATUTORY LEASE AGREEMENT — OFFICIAL FILING', 130, 180, 'bold 18px monospace', '#222');
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(130, 205);
    ctx.lineTo(1110, 205);
    ctx.stroke();

    drawText(ctx, 'Document Ref: DPA-2026-0984-G4       Filing Date: 24 September 2026', 130, 245, '15px monospace', '#444');
    drawText(ctx, 'Submission Category: Required Public Archival Scan', 130, 275, '15px monospace', '#444');

    const clauses = [
      '1. PURPOSE AND JURISDICTION: This instrument constitutes a formal public submission',
      'under municipal governance regulations requiring verification of tenancy and verified',
      'identity credentials for electronic administrative archival purposes.',
      '',
      '2. STATUTORY ATTESTATION: The applicant acknowledges that submitting illegible or',
      'falsified documentation carries administrative sanctions and filing rejections under',
      'statutory regulatory procedural codes section 44-B.',
      '',
      '3. SCANNING COMPLIANCE: All uploaded digital scans must preserve official rubber',
      'stamps, department seals, counter-signatures, and alphanumeric serial markings',
      'without destructive lossy artifacts obscuring registration records.',
      '',
      '4. IN WITNESS WHEREOF, the undersigned parties have executed this certified filing',
      'as of the date entered below, subject to audit and verification by the registrar.',
    ];
    let y = 350;
    for (const line of clauses) {
      if (line) drawText(ctx, line, 130, y, '16px monospace', '#1a1c22');
      y += 32;
    }

    // Official Seal Stamp
    ctx.save();
    ctx.translate(340, 940);
    ctx.rotate(-0.08);
    ctx.strokeStyle = '#263a8a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 90, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 80, 0, Math.PI * 2);
    ctx.stroke();
    drawText(ctx, '★ OFFICIAL SEAL ★', -68, -25, 'bold 13px sans-serif', '#263a8a');
    drawText(ctx, 'STATE REGISTRY', -62, 5, 'bold 15px sans-serif', '#263a8a');
    drawText(ctx, 'APPROVED 2026', -54, 32, 'bold 13px sans-serif', '#263a8a');
    ctx.restore();

    // Signature Block
    drawText(ctx, 'Certified Registrar Signature:', 640, 910, '15px monospace', '#444');
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(640, 980);
    ctx.lineTo(1050, 980);
    ctx.stroke();
    ctx.strokeStyle = '#0e1d54';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(660, 970);
    ctx.bezierCurveTo(710, 920, 740, 1000, 810, 940);
    ctx.bezierCurveTo(860, 910, 900, 960, 970, 950);
    ctx.bezierCurveTo(1000, 950, 1010, 930, 1035, 965);
    ctx.stroke();
    drawText(ctx, 'Bureau of Public Records & Attestation', 640, 1005, '13px monospace', '#666');

    ctx.restore();
    pagesData.push(await canvasToJpegBytes(canvas, 0.85));
  }

  // Page 2: Schedule A Fee Table
  {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawScanNoise(ctx, W, H);
    ctx.save();
    ctx.rotate(-0.002);

    drawText(ctx, 'SCHEDULE A: FEE STRUCTURE & RECONCILIATION SUMMARY', 130, 140, 'bold 22px monospace', '#111');
    drawText(ctx, 'All monetary assessments calculated under Municipal Administrative Directive 12.', 130, 175, '15px monospace', '#444');

    const top = 230, rowH = 44;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    for (let r = 0; r <= 13; r++) {
      ctx.beginPath();
      ctx.moveTo(130, top + r * rowH);
      ctx.lineTo(1110, top + r * rowH);
      ctx.stroke();
    }
    const cols = [130, 240, 680, 890, 1110];
    for (const c of cols) {
      ctx.beginPath();
      ctx.moveTo(c, top);
      ctx.lineTo(c, top + 13 * rowH);
      ctx.stroke();
    }
    drawText(ctx, 'ITEM #', 148, top + 28, 'bold 15px monospace', '#111');
    drawText(ctx, 'STATUTORY DESCRIPTION', 260, top + 28, 'bold 15px monospace', '#111');
    drawText(ctx, 'CODE REF', 710, top + 28, 'bold 15px monospace', '#111');
    drawText(ctx, 'ASSESSMENT', 920, top + 28, 'bold 15px monospace', '#111');

    const items = [
      ['001', 'Physical Document Processing and Stamp Verification', 'SEC-01', '$145.00'],
      ['002', 'Biometric Signature Validation and Identity Confirmation', 'SEC-04', '$210.00'],
      ['003', 'Public Register Landlord Registry Fee (Zone B)', 'MUN-88', '$520.00'],
      ['004', 'Environmental Impact Statement Archival Filing', 'ENV-12', '$85.00'],
      ['005', 'Commercial Tenancy Protection Fund Contribution', 'PROT-9', '$330.00'],
      ['006', 'Expedited Counter Filing & Electronic Audit Pass', 'AUD-02', '$75.00'],
      ['007', 'Inter-Agency Notice Transmission Surcharge', 'NOT-55', '$42.50'],
      ['008', 'Regional Infrastructure Maintenance Assessment', 'INF-10', '$190.00'],
      ['009', 'Annual Registry Maintenance and Seal Renewal', 'REG-01', '$120.00'],
      ['010', 'Digital Retention Guarantee (10-Year Safe Storage)', 'STOR-7', '$95.00'],
      ['011', 'Administrative Notarial Certification & Tax Stamp', 'NOT-01', '$60.00'],
      ['TOT', 'FINAL CERTIFIED BALANCE DUE TO MUNICIPALITY', 'ALL-OK', '$1,872.50'],
    ];

    items.forEach((row, i) => {
      const y = top + (i + 1) * rowH + 28;
      const isBold = i === items.length - 1;
      const fn = isBold ? 'bold 15px monospace' : '15px monospace';
      drawText(ctx, row[0], 152, y, fn, '#222');
      drawText(ctx, row[1], 260, y, fn, '#222');
      drawText(ctx, row[2], 710, y, fn, '#222');
      drawText(ctx, row[3], 930, y, fn, '#222');
    });

    ctx.restore();
    pagesData.push(await canvasToJpegBytes(canvas, 0.85));
  }

  // Page 3: Exhibit B Identity Verification & Photo
  {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawScanNoise(ctx, W, H);
    ctx.save();
    ctx.rotate(0.002);

    drawText(ctx, 'EXHIBIT B: APPLICANT IDENTITY & BIOMETRIC VERIFICATION', 130, 140, 'bold 22px monospace', '#111');
    drawText(ctx, 'Attach passport-style photograph and primary identification credential.', 130, 175, '15px monospace', '#444');

    // Photo Box
    ctx.strokeStyle = '#333';
    ctx.strokeRect(130, 230, 280, 360);
    const gradPhoto = ctx.createLinearGradient(130, 230, 410, 590);
    gradPhoto.addColorStop(0, '#537895');
    gradPhoto.addColorStop(1, '#09203f');
    ctx.fillStyle = gradPhoto;
    ctx.fillRect(131, 231, 278, 358);
    // Silhouette
    ctx.fillStyle = '#e0ac69';
    ctx.beginPath();
    ctx.arc(270, 370, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.ellipse(270, 510, 110, 80, 0, 0, Math.PI);
    ctx.fill();
    drawText(ctx, 'GOVERNMENT ID PHOTO', 170, 570, 'bold 12px sans-serif', '#fff');

    const fields = [
      ['SURNAME:', 'MITCHELL'],
      ['GIVEN NAMES:', 'ALEXANDER DANIEL'],
      ['NATIONALITY:', 'CITIZEN OF RECORD'],
      ['DATE OF BIRTH:', '14 MAY 1984'],
      ['ISSUING AUTHORITY:', 'STATE CIVIL REGISTRY'],
      ['EXPIRY DATE:', '31 DEC 2034'],
      ['DOCUMENT NO:', 'A-84920491-CCITT'],
    ];
    fields.forEach(([k, v], idx) => {
      drawText(ctx, k, 450, 260 + idx * 48, 'bold 14px monospace', '#444');
      drawText(ctx, v, 650, 260 + idx * 48, '16px monospace', '#111');
    });

    drawText(ctx, 'DECLARATION OF ACCURACY AND OFFICIAL ENDORSEMENT', 130, 670, 'bold 17px monospace', '#111');
    const decl = [
      'I hereby certify under penalty of perjury that the attached photographic',
      'identification and credentials correspond truthfully to the applicant named',
      'herein, verified by an accredited municipal recording officer.',
    ];
    decl.forEach((l, idx) => drawText(ctx, l, 130, 710 + idx * 30, '15px monospace', '#222'));

    // Red Stamp
    ctx.save();
    ctx.translate(850, 910);
    ctx.rotate(0.06);
    ctx.strokeStyle = '#a82c3a';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(-120, -45, 240, 90);
    drawText(ctx, 'VERIFIED & RECORDED', -105, -10, 'bold 16px sans-serif', '#a82c3a');
    drawText(ctx, 'ARCHIVE COMPLIANT', -95, 22, 'bold 14px sans-serif', '#a82c3a');
    ctx.restore();

    ctx.restore();
    pagesData.push(await canvasToJpegBytes(canvas, 0.85));
  }

  const pdfBytes = buildPdf(pagesData.map((data) => ({
    widthPt: 595.28,
    heightPt: 841.89,
    pixW: W,
    pixH: H,
    kind: 'jpeg',
    colour: true,
    data,
  })));

  try {
    return new File([pdfBytes], 'sample-scanned-contract.pdf', { type: 'application/pdf' });
  } catch {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    blob.name = 'sample-scanned-contract.pdf';
    return blob;
  }
}

const btnSample = $('btnSample');
if (btnSample) {
  btnSample.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (btnSample.disabled) return;
    const orig = btnSample.textContent;
    btnSample.disabled = true;
    btnSample.textContent = 'Generating sample scan…';
    const currentToken = ++sampleGenToken;
    try {
      const sampleFile = await createSamplePdf();
      if (currentToken !== sampleGenToken) return;
      await load(sampleFile);
    } catch (err) {
      if (currentToken !== sampleGenToken) return;
      console.error(err);
      showDrop('Could not create sample PDF. ' + (err?.message ?? ''), true);
    } finally {
      if (currentToken === sampleGenToken) {
        btnSample.disabled = false;
        btnSample.textContent = orig;
      }
    }
  });
  btnSample.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  });
}

// Offer the page itself as a download, unless this already is a saved copy.
if (location.protocol === 'file:') $('saveCopy').remove();
else $('saveCopy').querySelector('a').href = location.href;

paint();
