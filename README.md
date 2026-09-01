# LibreOffice WASM Document Converter

Convert documents between formats (DOCX, PDF, XLSX, PPTX, etc.) in Node.js or browsers using LibreOffice compiled to WebAssembly. No native dependencies required.

## Features

- **Pure WebAssembly** - No native LibreOffice installation required
- **Wide Format Support** - Convert between 15+ document formats
- **Cross-Platform** - Works in Node.js and browsers
- **Fast** - ~35ms per conversion after initialization

## Installation

```bash
npm install @killbus/libreoffice-converter
```

## Demo
https://convertmydocuments.com

## Quick Start

### One-Shot Conversion (Simplest)

```javascript
import { convertDocument } from '@killbus/libreoffice-converter';
import fs from 'fs';

const docx = fs.readFileSync('document.docx');
const result = await convertDocument(docx, { outputFormat: 'pdf' });
fs.writeFileSync('document.pdf', result.data);
```

### Export as Image

```javascript
import { exportAsImage } from '@killbus/libreoffice-converter';
import fs from 'fs';

// Export single page (0-indexed)
const [cover] = await exportAsImage(docxBuffer, 'docx', 0, 'png');
fs.writeFileSync('cover.png', cover.data);

// Export multiple pages
const slides = await exportAsImage(pptxBuffer, 'pptx', [0, 1, 2], 'png');
slides.forEach((img, i) => fs.writeFileSync(`slide-${i}.png`, img.data));

// Export with options
const highRes = await exportAsImage(pptxBuffer, 'pptx', [0, 1, 2], 'png', { dpi: 300, width: 1920 });
```

### Server Usage (Recommended)

For servers, use the worker converter to avoid blocking the main thread:

```javascript
import { createConverter } from '@killbus/libreoffice-converter/server';

const converter = await createConverter();

// Reuse for multiple conversions
const pdf = await converter.convert(docxBuffer, { outputFormat: 'pdf' });
const csv = await converter.convert(xlsxBuffer, { outputFormat: 'csv' });

await converter.destroy(); // Clean up when done
```

## Supported Formats

**Input:** doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp, rtf, txt, html, csv, pdf, epub

**Output:** pdf, docx, doc, odt, rtf, txt, html, xlsx, xls, ods, csv, pptx, ppt, odp, png, svg

## Browser Usage

```javascript
import { createWorkerBrowserConverter, createWasmPaths } from '@killbus/libreoffice-converter/browser';

const converter = createWorkerBrowserConverter({
  ...createWasmPaths('/wasm/'),
  browserWorkerJs: '/assets/libreoffice/browser.worker.global.js',
  onProgress: (info) => console.log(`${info.percent}%: ${info.message}`),
});

await converter.initialize();

const result = await converter.convert(fileData, { outputFormat: 'pdf' }, 'doc.docx');

// Download result
const blob = new Blob([result.data], { type: result.mimeType });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = result.filename;
a.click();
```

### Deploying browser assets

The package does not copy browser files during installation. A build/sync script should
import the immutable package contract and copy every `packagePath` to application-owned
public URLs:

```javascript
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { LIBREOFFICE_BROWSER_ASSET_CONTRACT } from '@killbus/libreoffice-converter/browser-assets';

const require = createRequire(import.meta.url);
const packageRoot = dirname(
  require.resolve('@killbus/libreoffice-converter/package.json'),
);

for (const asset of Object.values(LIBREOFFICE_BROWSER_ASSET_CONTRACT.assets)) {
  const sourcePath = resolve(packageRoot, asset.packagePath);
  // Hash/copy sourcePath to your own public asset directory and URL.
}
```

The runtime is compiled without pthread support. Deploy the four declared assets with
their declared MIME types and pass the resulting URLs to
`createWorkerBrowserConverter`. Cross-origin isolation headers are not required.

## Font Support

The WASM build includes Latin, Arabic, Hebrew, and other common fonts. For CJK (Chinese, Japanese, Korean), Indic, and other scripts, you can inject additional fonts at runtime.

### Using System Fonts (Node.js)

```javascript
const converter = await createConverter({ includeSystemFonts: true });
```

### Using @fontsource Packages

Install fonts from npm, then load them:

```bash
npm install @fontsource/noto-sans-jp @fontsource/noto-sans-kr
```

```javascript
import { loadFontsFromPackages, createConverter } from '@killbus/libreoffice-converter';

const fonts = await loadFontsFromPackages([
  '@fontsource/noto-sans-jp',
  '@fontsource/noto-sans-kr',
]);
const converter = await createConverter({ fonts });
```

### Using Prebuilt Font Bundles

Download regional font bundles from [GitHub Releases](https://github.com/killbus/libreoffice-wasm-conversion-runtime-no-pthread/releases):

| Bundle | Scripts | Size |
|--------|---------|------|
| `fonts-core.zip` | Latin, Cyrillic, Greek | ~6 MB |
| `fonts-cjk.zip` | Chinese, Japanese, Korean | ~250 MB |
| `fonts-arabic.zip` | Arabic, Hebrew | ~1.3 MB |
| `fonts-indic.zip` | Devanagari, Bengali, Tamil, Telugu, etc. | ~4.5 MB |
| `fonts-southeast-asian.zip` | Thai, Myanmar, Khmer, Lao | ~1.4 MB |
| `fonts-african.zip` | Ethiopic | ~835 KB |
| `fonts-all.zip` | All of the above | ~264 MB |

```javascript
import { loadFontsFromZip, createConverter } from '@killbus/libreoffice-converter';

const fonts = await loadFontsFromZip('./fonts/fonts-cjk.zip');
const converter = await createConverter({ fonts });
```

### Custom Font Files

```javascript
import { loadFontsFromDirectory, createConverter } from '@killbus/libreoffice-converter';

const fonts = await loadFontsFromDirectory('./my-fonts/');
const converter = await createConverter({ fonts });
```

### Browser Font Loading

```javascript
import { loadFontsFromUrl, createWorkerBrowserConverter } from '@killbus/libreoffice-converter/browser';

const fonts = await loadFontsFromUrl('/assets/fonts-cjk.zip');
const converter = createWorkerBrowserConverter({ ...wasmPaths, fonts });
await converter.initialize();
```

## Documentation

- **[API Reference](docs/API.md)** - Complete API documentation, types, configuration options
- **[Examples](docs/EXAMPLES.md)** - Express server, React component, batch conversion, and more

## System Requirements

- Node.js 18.0.0+
- `unzip` for restoring the qualified development runtime
- ~250MB disk space for the materialized runtime, plus ~250MB for its reusable download cache
- Browser: ~240MB initial download (cached after first load)

## License

MPL-2.0 (same as LibreOffice)

## Contributing

The heavyweight `soffice.wasm` and `soffice.data` files are intentionally not stored in Git or Git LFS. Restore the exact qualified release before building or packaging:

```bash
git clone https://github.com/killbus/libreoffice-wasm-conversion-runtime-no-pthread.git
cd libreoffice-wasm-conversion-runtime-no-pthread
npm ci
npm run runtime:restore
npm run build
npm test
```

The restore command pins the release repository, asset ID, byte length, archive SHA-256, candidate identity, and every packaged runtime asset hash. Downloads are cached outside the repository and transient HTTP or network failures are retried. Set `LIBREOFFICE_RUNTIME_CACHE_DIR` to choose another cache location.

See [docs/API.md#building-from-source](docs/API.md#building-from-source) only when rebuilding the native WASM runtime itself.
