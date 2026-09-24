# Third-party notices

The built file, `dist/underlimit.html`, bundles the following. Their full
licence texts are copied into a comment at the top of that file by `build.mjs`.

| Component | Version | Licence | Source |
|---|---|---|---|
| pdf.js (`pdfjs-dist`) | 4.10.38 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| IBM Plex Sans, latin subset (`@fontsource/ibm-plex-sans`) | 5.3.0 | OFL-1.1 | https://github.com/IBM/plex |
| IBM Plex Mono, latin subset (`@fontsource/ibm-plex-mono`) | 5.3.0 | OFL-1.1 | https://github.com/IBM/plex |

Nothing else from `node_modules` ends up in the built file. esbuild is used at
build time only.
