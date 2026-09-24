/**
 * Minimal PDF writer: one full-page image per page and nothing else — no
 * metadata, fonts or text. Each page keeps the size it came in with.
 *
 * A page is { widthPt, heightPt, pixW, pixH, kind, data, colour? }:
 *   kind 'g4'    CCITT Group 4, 1 bit per pixel (/CCITTFaxDecode)
 *   kind 'jpeg'  JPEG, grey or colour           (/DCTDecode)
 */

export const buildPdf = (pages) => concat(layout(pages));

/** The exact byte length buildPdf() would produce, without assembling it. */
export const pdfSize = (pages) => layout(pages).reduce((n, part) => n + part.length, 0);

// The second line's high bytes tell transfer tools the file is binary.
const HEADER = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

/**
 * The file as a list of parts: ASCII strings for structure, the pages' own
 * byte arrays for image data (referenced, not copied). Objects are numbered
 * 1 catalog, 2 page tree, then page / content / image for each page.
 */
function layout(pages) {
  const parts = [];
  const offsets = [];
  let pos = 0;
  const put = (...xs) => xs.forEach((x) => { parts.push(x); pos += x.length; });
  const object = (dict, stream) => {
    offsets.push(pos);
    put(`${offsets.length} 0 obj\n${dict}\n`);
    if (stream) put('stream\n', stream, '\nendstream\n');
    put('endobj\n');
  };

  put(HEADER);
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`);

  pages.forEach((p, i) => {
    const [content, image] = [4 + 3 * i, 5 + 3 * i];
    const w = num(p.widthPt), h = num(p.heightPt);
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    const encoding = p.kind === 'g4'
      ? `/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns ${p.pixW} /Rows ${p.pixH} >>`
      : `/ColorSpace /Device${p.colour ? 'RGB' : 'Gray'} /BitsPerComponent 8 /Filter /DCTDecode`;

    object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] `
      + `/Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    object(`<< /Length ${draw.length} >>`, draw);
    object(`<< /Type /XObject /Subtype /Image /Width ${p.pixW} /Height ${p.pixH} ${encoding} /Length ${p.data.length} >>`, p.data);
  });

  const xref = pos, size = offsets.length + 1;
  put(`xref\n0 ${size}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return parts;
}

/** Points to at most two decimals, integers without any. */
const num = (v) => String(Math.round(v * 100) / 100);

function concat(parts) {
  const ascii = new TextEncoder();
  const bytes = parts.map((p) => (typeof p === 'string' ? ascii.encode(p) : p));
  const out = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of bytes) { out.set(b, at); at += b.length; }
  return out;
}
