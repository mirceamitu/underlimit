"""Reference encoder, decoder and fixtures for the tests, via Pillow (libtiff).

    python3 test/pillow.py decode SPEC.json   [{g4, width, height, out}]  G4 stream -> PBM
    python3 test/pillow.py encode SPEC.json   [{pbm, out}]                PBM -> libtiff's G4 stream
    python3 test/pillow.py scan OUT.pgm                                   synthetic 300 DPI A4 scan
    python3 test/pillow.py jpeg OUT.jpg                                   small greyscale JPEG
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
    Image.linear_gradient('L').resize((64, 48)).save(out, quality=80)


def og(out):
    """Generate high-contrast 1200x630 social preview PNG."""
    im = Image.new('RGBA', (1200, 630), (25, 28, 34, 255))
    draw = ImageDraw.Draw(im)

    def load_font(name, size, bold=False):
        candidates = []
        if bold:
            candidates += [f"C:/Windows/Fonts/{name}bd.ttf", f"C:/Windows/Fonts/{name}b.ttf", f"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        else:
            candidates += [f"C:/Windows/Fonts/{name}.ttf", f"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
        for c in candidates:
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                pass
        return ImageFont.load_default()

    font_title = load_font('segoeui', 56, bold=True)
    font_sub = load_font('segoeui', 22)
    font_mono_sm = load_font('consola', 11, bold=True)
    font_mono = load_font('consola', 13, bold=True)
    font_mono_lg = load_font('consola', 15, bold=True)
    font_sans_sm = load_font('segoeui', 13)

    # Frame
    draw.rounded_rectangle([24, 24, 1176, 606], radius=8, outline=(240, 241, 236, 30), width=2)

    # Top pill
    draw.rounded_rectangle([70, 75, 500, 107], radius=16, fill=(61, 59, 168, 80), outline=(94, 92, 230, 200))
    draw.ellipse([85, 87, 93, 95], fill=(47, 107, 79, 255))
    draw.text((105, 83), "1984 FAX COMPRESSION · 100% OFFLINE IN BROWSER", font=font_mono_sm, fill=(224, 226, 255))

    # Headline
    draw.text((70, 125), "UNDERLIMIT", font=font_title, fill=(240, 241, 236))
    draw.text((70, 195), "Fit scanned PDFs under upload limits — no servers, no uploads.", font=font_sub, fill=(176, 181, 192))

    # Card
    draw.rounded_rectangle([70, 245, 1130, 500], radius=8, fill=(30, 34, 42), outline=(240, 241, 236, 35))
    # Card Header
    draw.rounded_rectangle([70, 245, 1130, 290], radius=8, fill=(22, 24, 30))
    draw.line([(70, 290), (1130, 290)], fill=(240, 241, 236, 25), width=1)
    draw.text((95, 258), "PORTAL UPLOAD LIMIT: 2.00 MB", font=font_mono, fill=(142, 149, 162))
    draw.text((960, 258), "18-PAGE CONTRACT", font=font_mono, fill=(110, 116, 126))

    # Row 1: As sent
    draw.text((95, 325), "AS SENT", font=font_mono, fill=(142, 149, 162))
    draw.rounded_rectangle([200, 315, 870, 350], radius=3, fill=(42, 46, 56))
    draw.rounded_rectangle([200, 315, 840, 350], radius=3, fill=(168, 44, 58))
    draw.text((890, 322), "26.90 MB  (x13.5 over)", font=font_mono_lg, fill=(255, 123, 136))

    # Row 2: Trimmed
    draw.text((95, 400), "TRIMMED", font=font_mono, fill=(142, 149, 162))
    draw.rounded_rectangle([200, 390, 870, 425], radius=3, fill=(42, 46, 56))
    draw.rounded_rectangle([200, 390, 360, 425], radius=3, fill=(47, 107, 79))
    draw.text((890, 397), "1.26 MB  (95% smaller · fits!)", font=font_mono_lg, fill=(74, 222, 128))

    # Limit Line at x=585
    draw.rectangle([585, 305, 870, 435], fill=(168, 44, 58, 28))
    draw.line([(585, 300), (585, 440)], fill=(240, 241, 236), width=3)
    draw.rounded_rectangle([535, 296, 635, 316], radius=3, fill=(240, 241, 236))
    draw.text((543, 300), "LIMIT 2.00 MB", font=font_mono_sm, fill=(25, 28, 34))

    # Footer
    draw.text((70, 545), "Zero Data Uploaded  ·  Works Air-Gapped with Wi-Fi Off  ·  Single-File Utility", font=font_sans_sm, fill=(240, 241, 236))
    draw.text((880, 545), "github.com/mirceamitu/underlimit", font=font_mono, fill=(142, 149, 162))

    im.convert('RGB').save(out, 'PNG', optimize=True)


if __name__ == '__main__':
    {'decode': decode, 'encode': encode, 'scan': scan, 'jpeg': jpeg, 'og': og}[sys.argv[1]](sys.argv[2])
