# Local QR code generator

`qrcode-generator.js` is the browser build of Kazuhiko Arase's
qrcode-generator, version **2.0.4** (`js2.0.4`), pinned to upstream commit
`83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8`.

The only adaptation is the final `window.qrcode = qrcode` bridge, so its browser
API is also available when the main application imports this file as an ES module.

- Source: https://github.com/kazuhikoarase/qrcode-generator/blob/83b7e8fe3fddd3b0368dbafd6ce56995bd25e3c8/js/dist/qrcode.js
- License: `qrcode-generator.LICENSE` (MIT)

Question app worksheet codes are generated in the browser. No URL, worksheet,
or student information is sent to a QR-generation service.
