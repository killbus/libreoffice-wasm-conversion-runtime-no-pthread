import { describe, expect, it } from 'vitest';

const sorted = (value: object): string[] => Object.keys(value).sort();

describe('conversion-only public entry points', () => {
  it('does not publish raw runtime, editor, LOK, or rendering symbols', async () => {
    const [root, server, browser, types] = await Promise.all([
      import('../src/index.js'),
      import('../src/server.js'),
      import('../src/browser.js'),
      import('../src/types-entry.js'),
    ]);

    for (const entry of [root, server, browser, types]) {
      expect(sorted(entry)).not.toContain('LibreOfficeConverter');
      expect(sorted(entry)).not.toContain('WorkerConverter');
      expect(sorted(entry)).not.toContain('SubprocessConverter');
      expect(sorted(entry)).not.toContain('BrowserConverter');
      expect(sorted(entry)).not.toContain('WorkerBrowserConverter');
      expect(sorted(entry)).not.toContain('createEditor');
      expect(sorted(entry)).not.toContain('OfficeEditor');
      expect(sorted(entry)).not.toContain('LOK_MOUSEEVENT_MOVE');
      expect(sorted(entry)).not.toContain('LOKDocumentType');
      expect(sorted(entry)).not.toContain('LOK_DOCTYPE_OUTPUT_FORMATS');
      expect(sorted(entry)).not.toContain('getOutputFormatsForDocType');
      expect(sorted(entry)).not.toContain('getPageCount');
    }
  });

  it('returns a facade with only lifecycle and conversion methods', async () => {
    const { createWorkerBrowserConverter } = await import('../src/browser.js');
    const facade = createWorkerBrowserConverter({ browserWorkerJs: '/worker.js' });

    expect(Object.keys(facade).sort()).toEqual([
      'convert',
      'destroy',
      'initialize',
      'isReady',
    ]);
    expect(Object.isFrozen(facade)).toBe(true);
  });

  it('keeps JPEG available as a standalone encoder, not a document conversion output', async () => {
    const root = await import('../src/index.js');
    const types = await import('../src/types.js');

    expect(root.rgbaToJpeg).toBeTypeOf('function');
    expect(types.FORMAT_MIME_TYPES.jpg).toBeUndefined();
    expect(types.FORMAT_FILTERS.jpg).toBeUndefined();
    expect(types.getValidOutputFormats('docx')).not.toContain('jpg');
    expect(types.getValidOutputFormats('docx')).not.toContain('html');
  });
});
