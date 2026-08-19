import type { ILibreOfficeConverter, ImageOptions, OutputFormat } from '../src/types.js';
import { createConverter } from '../src/index.js';

declare const converter: ILibreOfficeConverter;

// The public object cannot expose document inspection, rendering, or editor sessions.
// @ts-expect-error conversion-only facade has no page inspection API
converter.getPageCount;
// @ts-expect-error conversion-only facade has no editor API
converter.openDocument;
// @ts-expect-error raw converter classes are not part of the package entry point
import { LibreOfficeConverter } from '../src/index.js';

void createConverter;
void LibreOfficeConverter;

// @ts-expect-error JPEG is only a standalone encoder format
const documentOutput: OutputFormat = 'jpg';
// @ts-expect-error multi-page orchestration belongs to exportAsImage
const imageOptions: ImageOptions = { pages: [0, 1] };

void documentOutput;
void imageOptions;
