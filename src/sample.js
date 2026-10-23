/**
 * A synthetic 3-page scan for the "Try sample scan" button: a contract with a
 * seal and signature, a fee table, and an ID page with a photo. Drawn on
 * canvases, so the page needs no bundled sample file.
 */
import { jpeg, makeCanvas } from './measure.js';
import { buildPdf } from './pdfwrite.js';

const GRAIN = 24; // grain spread, in grey levels

export async function createSamplePdf() {
  const W = 1240, H = 1754, S = 2; // drawn at 150 DPI, rendered at 300 DPI like a real scan
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

  // Sensor grain: it is what makes real scans big, and thresholding drops it.
  function addGrain(canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * GRAIN;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Page 1: Official Contract & Stamp
  {
    const canvas = makeCanvas(W * S, H * S);
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    drawScanNoise(ctx, W, H);
    ctx.save();
    ctx.rotate(0.003);

    drawText(ctx, 'DEPARTMENT OF PUBLIC ADMINISTRATION & ARCHIVES', 130, 140, 'bold 24px monospace', '#111');
    drawText(ctx, 'STANDARD STATUTORY LEASE AGREEMENT - OFFICIAL FILING', 130, 180, 'bold 18px monospace', '#222');
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
    addGrain(canvas);
    pagesData.push(await jpeg(canvas, 0.85));
  }

  // Page 2: Schedule A Fee Table
  {
    const canvas = makeCanvas(W * S, H * S);
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
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
    addGrain(canvas);
    pagesData.push(await jpeg(canvas, 0.85));
  }

  // Page 3: Exhibit B Identity Verification & Photo
  {
    const canvas = makeCanvas(W * S, H * S);
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
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
    addGrain(canvas);
    pagesData.push(await jpeg(canvas, 0.85));
  }

  const pdfBytes = buildPdf(pagesData.map((data) => ({
    widthPt: 595.28,
    heightPt: 841.89,
    pixW: W * S,
    pixH: H * S,
    kind: 'jpeg',
    data,
  })));

  return new File([pdfBytes], 'sample-scanned-contract.pdf', { type: 'application/pdf' });
}
