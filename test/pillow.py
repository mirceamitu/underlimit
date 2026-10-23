"""Reference encoder, decoder and fixtures for the tests, via Pillow (libtiff).

    python3 test/pillow.py decode SPEC.json   [{g4, width, height, out}]  G4 stream -> PBM
    python3 test/pillow.py encode SPEC.json   [{pbm, out}]                PBM -> libtiff's G4 stream
    python3 test/pillow.py scan OUT.pgm                                   synthetic 300 DPI A4 scan
    python3 test/pillow.py jpeg OUT.jpg                                   small grey JPEG, 3 channels
"""
import io
import json
import random
import struct
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont


def tiff(g4, width, height):
    """A single-strip TIFF around a raw G4 stream. MinIsWhite, the fax polarity."""
    tags = [(256, 4, width), (257, 4, height), (258, 3, 1), (259, 3, 4), (262, 3, 0),
            (273, 4, None), (277, 3, 1), (278, 4, height), (279, 4, len(g4))]
    data_at = 8 + 2 + 12 * len(tags) + 4
    out = bytearray(b'II' + struct.pack('<HIH', 42, 8, len(tags)))
    for tag, kind, value in tags:
        value = data_at if value is None else value
        if kind == 3:  # SHORT, left-justified in the 4-byte value field
            out += struct.pack('<HHIHH', tag, kind, 1, value, 0)
        else:          # LONG
            out += struct.pack('<HHII', tag, kind, 1, value)
    return bytes(out + struct.pack('<I', 0) + g4)


def decode(spec):
    for e in json.load(open(spec)):
        Image.open(io.BytesIO(tiff(open(e['g4'], 'rb').read(), e['width'], e['height']))).save(e['out'])


def encode(spec):
    # libtiff's fax coder codes 0 samples as white whatever the photometric
    # says, so paper goes in as 0. One strip, so it is a single G4 block.
    for e in json.load(open(spec)):
        buf = io.BytesIO()
        Image.open(e['pbm']).point(lambda v: 255 - v).convert('1').save(buf, 'TIFF', compression='group4', strip_size=1 << 30)
        t = Image.open(io.BytesIO(buf.getvalue()))
        (at,), (length,) = t.tag_v2[273], t.tag_v2[279]
        open(e['out'], 'wb').write(buf.getvalue()[at:at + length])


WORDS = ('the parties agree that article clause shall pursuant hereby notice payment '
         'property owner buyer seller within days of signing registered annex').split()


def scan(out):
    """Typed text on paper lit unevenly from the top, plus sensor noise. Seeded."""
    w, h, rng = 2480, 3508, random.Random(7)
    ink = Image.new('L', (w, h), 255)
    draw, font = ImageDraw.Draw(ink), ImageFont.load_default(size=38)
    y = 260
    while y < h - 300:
        draw.text((220, y), ' '.join(rng.choice(WORDS) for _ in range(12)), font=font, fill=30)
        y += 62 if rng.random() > 0.15 else 124
    light = Image.linear_gradient('L').resize((w, h)).point(lambda v: 245 - v * 70 // 255)
    noise = Image.frombytes('L', (w, h), rng.randbytes(w * h)).point(lambda v: v // 16)
    ImageChops.subtract(ImageChops.multiply(ink, light), noise).save(out)


def jpeg(out):
    # Grey pixels in 3 channels: what canvas.toBlob('image/jpeg') writes.
    Image.linear_gradient('L').resize((64, 48)).convert('RGB').save(out, quality=80)


if __name__ == '__main__':
    {'decode': decode, 'encode': encode, 'scan': scan, 'jpeg': jpeg}[sys.argv[1]](sys.argv[2])
