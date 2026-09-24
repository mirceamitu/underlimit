/**
 * CCITT Group 4 (ITU-T T.6) encoder for bilevel images.
 *
 * Input is one byte per pixel, row-major: non-zero is white (paper), zero is
 * black (ink). Output is the raw coded stream for a PDF /CCITTFaxDecode filter
 * with /K -1 and the default /BlackIs1 false: no EOL codes, no fill bits, no
 * end-of-block marker, last byte zero-padded.
 *
 * On the same pixels the output is bit-identical to libtiff's G4 encoder,
 * minus the end-of-block marker libtiff appends (see test/ccitt.test.js).
 */

// [code, bit length] pairs from ITU-T T.4, tables 2 and 3.
const WHITE_TERM = [ // run lengths 0..63
  [0x35, 8], [0x07, 6], [0x07, 4], [0x08, 4], [0x0b, 4], [0x0c, 4], [0x0e, 4], [0x0f, 4],
  [0x13, 5], [0x14, 5], [0x07, 5], [0x08, 5], [0x08, 6], [0x03, 6], [0x34, 6], [0x35, 6],
  [0x2a, 6], [0x2b, 6], [0x27, 7], [0x0c, 7], [0x08, 7], [0x17, 7], [0x03, 7], [0x04, 7],
  [0x28, 7], [0x2b, 7], [0x13, 7], [0x24, 7], [0x18, 7], [0x02, 8], [0x03, 8], [0x1a, 8],
  [0x1b, 8], [0x12, 8], [0x13, 8], [0x14, 8], [0x15, 8], [0x16, 8], [0x17, 8], [0x28, 8],
  [0x29, 8], [0x2a, 8], [0x2b, 8], [0x2c, 8], [0x2d, 8], [0x04, 8], [0x05, 8], [0x0a, 8],
  [0x0b, 8], [0x52, 8], [0x53, 8], [0x54, 8], [0x55, 8], [0x24, 8], [0x25, 8], [0x58, 8],
  [0x59, 8], [0x5a, 8], [0x5b, 8], [0x4a, 8], [0x4b, 8], [0x32, 8], [0x33, 8], [0x34, 8],
];
const BLACK_TERM = [ // run lengths 0..63
  [0x37, 10], [0x02, 3], [0x03, 2], [0x02, 2], [0x03, 3], [0x03, 4], [0x02, 4], [0x03, 5],
  [0x05, 6], [0x04, 6], [0x04, 7], [0x05, 7], [0x07, 7], [0x04, 8], [0x07, 8], [0x18, 9],
  [0x17, 10], [0x18, 10], [0x08, 10], [0x67, 11], [0x68, 11], [0x6c, 11], [0x37, 11], [0x28, 11],
  [0x17, 11], [0x18, 11], [0xca, 12], [0xcb, 12], [0xcc, 12], [0xcd, 12], [0x68, 12], [0x69, 12],
  [0x6a, 12], [0x6b, 12], [0xd2, 12], [0xd3, 12], [0xd4, 12], [0xd5, 12], [0xd6, 12], [0xd7, 12],
  [0x6c, 12], [0x6d, 12], [0xda, 12], [0xdb, 12], [0x54, 12], [0x55, 12], [0x56, 12], [0x57, 12],
  [0x64, 12], [0x65, 12], [0x52, 12], [0x53, 12], [0x24, 12], [0x37, 12], [0x38, 12], [0x27, 12],
  [0x28, 12], [0x58, 12], [0x59, 12], [0x2b, 12], [0x2c, 12], [0x5a, 12], [0x66, 12], [0x67, 12],
];
const WHITE_MAKEUP = [ // run lengths 64, 128, ... 1728
  [0x1b, 5], [0x12, 5], [0x17, 6], [0x37, 7], [0x36, 8], [0x37, 8], [0x64, 8], [0x65, 8],
  [0x68, 8], [0x67, 8], [0xcc, 9], [0xcd, 9], [0xd2, 9], [0xd3, 9], [0xd4, 9], [0xd5, 9],
  [0xd6, 9], [0xd7, 9], [0xd8, 9], [0xd9, 9], [0xda, 9], [0xdb, 9], [0x98, 9], [0x99, 9],
  [0x9a, 9], [0x18, 6], [0x9b, 9],
];
const BLACK_MAKEUP = [ // run lengths 64, 128, ... 1728
  [0x0f, 10], [0xc8, 12], [0xc9, 12], [0x5b, 12], [0x33, 12], [0x34, 12], [0x35, 12], [0x6c, 13],
  [0x6d, 13], [0x4a, 13], [0x4b, 13], [0x4c, 13], [0x4d, 13], [0x72, 13], [0x73, 13], [0x74, 13],
  [0x75, 13], [0x76, 13], [0x77, 13], [0x52, 13], [0x53, 13], [0x54, 13], [0x55, 13], [0x5a, 13],
  [0x5b, 13], [0x64, 13], [0x65, 13],
];
const EXT_MAKEUP = [ // run lengths 1792, 1856, ... 2560, shared by both colours
  [0x08, 11], [0x0c, 11], [0x0d, 11], [0x12, 12], [0x13, 12], [0x14, 12], [0x15, 12],
  [0x16, 12], [0x17, 12], [0x1c, 12], [0x1d, 12], [0x1e, 12], [0x1f, 12],
];

const PASS = [0b0001, 4];
const HORIZONTAL = [0b001, 3];
const VERTICAL = [ // indexed by a1 - b1 + 3: VL3 VL2 VL1 V0 VR1 VR2 VR3
  [0b0000010, 7], [0b000010, 6], [0b010, 3], [0b1, 1], [0b011, 3], [0b000011, 6], [0b0000011, 7],
];

export function encodeG4(bits, width, height) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 0) {
    throw new RangeError(`invalid image size ${width}x${height}`);
  }
  if (bits.length < width * height) {
    throw new RangeError(`expected ${width * height} pixels, got ${bits.length}`);
  }

  const out = new BitWriter();
  let ref = []; // the line above the first row is all white

  for (let y = 0; y < height; y++) {
    const cur = changes(bits, y * width, width);
    // a0 only moves right, so both cursors do too: linear time per row.
    let a0 = -1, white = true, ia = 0, ir = 0;

    while (a0 < width) {
      while (ia < cur.length && cur[ia] <= a0) ia++;
      while (ir < ref.length && ref[ir] <= a0) ir++;
      // b1 is the first change right of a0 whose colour is opposite to a0's:
      // even entries turn black, so a white a0 wants an even index.
      const ib = ir + ((ir & 1) ^ (white ? 0 : 1));

      const a1 = cur[ia] ?? width, a2 = cur[ia + 1] ?? width;
      const b1 = ref[ib] ?? width, b2 = ref[ib + 1] ?? width;

      if (b2 < a1) {
        out.write(PASS);
        a0 = b2;
      } else if (Math.abs(a1 - b1) <= 3) {
        out.write(VERTICAL[a1 - b1 + 3]);
        a0 = a1;
        white = !white;
      } else {
        out.write(HORIZONTAL);
        writeRun(out, a1 - Math.max(a0, 0), white);
        writeRun(out, a2 - a1, !white);
        a0 = a2;
      }
    }
    ref = cur;
  }
  return out.finish();
}

/** Columns where the colour changes, starting from an imaginary white pixel.
 *  Even entries turn black, odd entries turn white. */
function changes(bits, start, width) {
  const out = [];
  let white = true;
  for (let x = 0; x < width; x++) {
    if ((bits[start + x] !== 0) !== white) {
      out.push(x);
      white = !white;
    }
  }
  return out;
}

/** A run length as make-up code(s) plus a terminating code. */
function writeRun(out, run, white) {
  const term = white ? WHITE_TERM : BLACK_TERM;
  const makeup = white ? WHITE_MAKEUP : BLACK_MAKEUP;
  for (; run >= 2624; run -= 2560) out.write(EXT_MAKEUP[12]);
  if (run >= 1792) {
    const i = (run - 1792) >> 6;
    out.write(EXT_MAKEUP[i]);
    run -= 1792 + (i << 6);
  } else if (run >= 64) {
    out.write(makeup[(run >> 6) - 1]);
    run &= 63;
  }
  out.write(term[run]);
}

class BitWriter {
  bytes = new Uint8Array(1 << 16);
  length = 0;
  #acc = 0; // pending bits, fewer than 8 between writes
  #n = 0;

  write([code, bits]) {
    this.#acc = (this.#acc << bits) | code;
    this.#n += bits;
    while (this.#n >= 8) {
      this.#n -= 8;
      this.#push((this.#acc >>> this.#n) & 0xff);
    }
    this.#acc &= (1 << this.#n) - 1;
  }

  finish() {
    if (this.#n) this.#push((this.#acc << (8 - this.#n)) & 0xff);
    this.#n = this.#acc = 0;
    return this.bytes.subarray(0, this.length);
  }

  #push(byte) {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }
}
