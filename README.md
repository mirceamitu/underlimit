# Underlimit

> **Never upload contracts, tax forms, or passport scans to random cloud compressors again. Underlimit shrinks scanned PDFs by up to 95% using 1984 fax compression (CCITT Group 4) — running 100% offline in browser JavaScript, with zero network traffic.**

Government and institutional portals love setting brutal upload caps (2 MB, 5 MB). Meanwhile, modern desktop scanners churn out 30–50 MB multi-page scans full of contracts, IDs, and tax documents.

Popular cloud compressors shave off only 10–20% while exposing your most sensitive identity documents to third-party servers. **Underlimit** solves this by reviving **CCITT Group 4 fax compression** — the 1984 international standard engineered specifically for black text on white paper — implemented directly in client-side JavaScript.

An 18-page, 300 DPI colour scan goes from **26.9 MB to 1.26 MB** (a 95% reduction) at crisp full resolution, with stamps, seals, and signatures preserved.

**[Open Underlimit Live Demo](https://mirceamitu.github.io/underlimit/)** · **[Save Single-File HTML Offline](#offline-on-your-own-computer)**

---

## 🔒 The Zero-Trust Privacy Guarantee

- **Zero Data Uploaded:** Your PDF is decoded, measured, and encoded entirely inside your local browser memory via JavaScript and HTML5 Canvas. Nothing touches a backend server — ever.
- **Works with Wi-Fi Disabled:** Download `underlimit.html` (<950 KB), turn off your Wi-Fi, and shrink your files completely air-gapped.
- **Single-File Lifetime Utility:** The entire tool — application UI, Mozilla's pdf.js engine, IBM Plex typography, and CCITT Group 4 encoder — is bundled into **one self-contained HTML file**. Save it once; run it forever on any computer without installing Node, Python, or plugins.

---

## 📊 Comparison Matrix

How Underlimit (CCITT Group 4) compares against cloud compressors, standard Flate, and JPEG for scanned documents:

| Dimension | **Underlimit (CCITT G4)** | **Cloud Compressors** (e.g. Smallpdf, iLovePDF) | **Standard PDF (Flate/ZIP)** | **Brute-Force JPEG** |
| :--- | :--- | :--- | :--- | :--- |
| **Privacy & Zero-Trust** | 🟢 **100% Local / Air-Gapped** (Zero data leaves device) | 🔴 **Remote Server Upload** (Confidential contracts & IDs leave your hands) | 🟢 Local (when created locally) | 🟡 Local or remote |
| **Compression on Scans** | 🟢 **90% – 96% reduction** (e.g., 26.9 MB → 1.26 MB) | 🟡 10% – 30% reduction (struggles with scanned bitmaps) | 🔴 0% – 10% reduction (Flate cannot compress scan sensor noise) | 🟡 50% – 70% reduction (sacrifices legibility) |
| **Text & Stamp Legibility** | 🟢 **Crisp 1-bit contrast** (Adaptive thresholding removes paper grain) | 🟡 Muddy or compressed edges | 🟢 Original (uncompressed) | 🔴 Ringing artifacts & halo blur around letters & signatures |
| **Offline / Air-Gapped** | 🟢 **Yes** (Single standalone `.html` file) | 🔴 **No** (Requires active internet connection) | 🟢 Yes | 🟢 Yes |
| **Cost & Restrictions** | 🟢 **Free & Open Source** (Unlimited pages, no accounts) | 🔴 Freemium paywalls (Daily limits, page caps, upsells) | 🟢 Free | 🟢 Free |
| **Footprint & Dependencies** | 🟢 **<950 KB standalone file** (Runs in any browser) | 🔴 Third-party web service | 🟡 Heavy desktop software | 🟡 Image editing software |

---

## Why this exists

Recently I had to submit documents through my local authority's new online portal, launched with some fanfare as a major step forward. Several of them were scans running to tens of pages, and each one came out of the scanner at 30–50 MB. The portal's upload limit was 5 MB.

The popular PDF compressors didn't get me there. The ones I tried shaved off 10–30%, and the text got visibly worse along the way.

Plenty of websites promise to fix exactly this: upload your PDF, download a smaller one. But I work in cybersecurity, and these were contracts and documents full of personal data. Handing them to someone else's server to "compress" was never an option.

So I built my own, holding it to the rules I'd hold anyone else to: well-known open-source components, a published standard, and nothing leaves the machine. Mozilla's pdf.js reads the scan. The compression is implemented from the international standard and checked bit for bit against libtiff, the long-standing open-source TIFF library.

That standard is where it gets ironic. We like to joke that government offices still run on fax machines, their systems and processes stuck somewhere in the '80s and '90s. I got past this brand-new government portal's limit with fax technology from 1984.

CCITT Group 4 was designed for fax machines, and it is extraordinarily good at one kind of page: black text and lines on white paper. Underlimit first turns each page into pure black and white, correcting for the scanner's uneven lighting. What's left is long runs of identical pixels: white paper, black characters. G4 encodes those runs, and it encodes each line as the difference from the line above. A line of blank paper under another one costs a single bit: 2,480 pixels, one bit.

And because it all runs in the browser, anyone can do the same: download one HTML file, open it, and shrink their own scans without them ever leaving their computer.

## How it works

1. **Render.** Each page is rendered once at 300 DPI with [pdf.js](https://github.com/mozilla/pdf.js).
2. **Sort.** Pages that are ink on paper are told apart from photographs by their colour and how much of them is dark.
3. **Encode.** Text pages are thresholded to pure black and white — each pixel is compared with the local paper brightness, so uneven lighting doesn't turn into black bands — then compressed with CCITT Group 4, the fax standard, which is several times smaller than JPEG for this kind of page. Photo pages stay JPEG. Each page is encoded at 300, 200 and 150 DPI.
4. **Choose.** The best resolution that fits under the limit wins. The sizes shown are exact: they are the byte counts of the file you download. If nothing fits above your resolution floor, it says so and names the DPI that would.

The output keeps every page's size and order, and adds nothing: no metadata, no text layer.

The Group 4 encoder (`src/ccitt.js`, about 150 lines) is written from ITU-T T.4/T.6. It produces the same bit stream as libtiff's encoder, and the tests check that.

## Use

### Online

Open **[mirceamitu.github.io/underlimit](https://mirceamitu.github.io/underlimit/)**.
The page is static: GitHub only serves it. Your PDF is read, compressed and saved by your browser, and never sent anywhere.

### Offline, on your own computer

Underlimit is one self-contained HTML file of about 0.9 MB. The app, Mozilla's PDF engine and the fonts are all inside it, so a saved copy needs no internet connection and no installation:

1. Open the page and click **save for offline use** at the bottom.
2. Open the saved `underlimit.html` in your browser (double-click it).
3. Drop in a scanned PDF from your computer, choose the limit, and download the result. Or click **Try sample scan** to test immediately without a PDF.

To see for yourself that nothing leaves your machine, turn off your network before step 3. It works the same.

It's made for scanned documents: typed pages, forms, stamps, signatures. PDFs created on a computer work too, but come out as images and lose their selectable text (see [Limits](#limits)).

Tested in Chrome and other Chromium browsers. Firefox 113+ and Safari 16.4+ have everything it uses, but haven't been tested yet — reports welcome.

## Build

```sh
npm ci
npm run build      # → dist/underlimit.html
```

`src/index.html` is a template: `build.mjs` inlines the app (bundled with esbuild), pdf.js (gzipped, decompressed in the page) and the fonts, and copies the third-party licences into the output.

## Test

```sh
npm test
```

The tests decode everything the encoder produces with two independent decoders, poppler and libtiff, and compare the result pixel by pixel. They need `pdfimages` and `pdfinfo` (poppler-utils) and Python 3 with Pillow.

## Limits

- **Text and vector pages become images.** A PDF made on a computer, rather than scanned, loses its selectable text. Underlimit is for scans.
- **Processing runs on the page’s main thread**, so the tab is busy while it works: about 13 seconds for 18 A4 pages. (A page opened from disk can’t start pdf.js’s worker, and the hosted page behaves the same way.)
- **Password-protected PDFs** can't be opened.
- **Greyscale** (under Advanced) costs a second pass over every page and is much larger. It's there for scans where tone matters.

## Licence

MIT. The built file includes pdf.js (Apache-2.0) and IBM Plex (OFL-1.1); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
