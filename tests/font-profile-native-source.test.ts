import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const abiPatch = readFileSync(
  new URL('../build/patches/wasm-font-profile-abi.patch', import.meta.url),
  'utf8'
);
const removalPatch = readFileSync(
  new URL('../build/patches/wasm-font-removal-primitives.patch', import.meta.url),
  'utf8'
);
const buildScript = readFileSync(
  new URL('../build/build-wasm.sh', import.meta.url),
  'utf8'
);
const workerSource = readFileSync(
  new URL('../src/browser.worker.ts', import.meta.url),
  'utf8'
);

function patchTargets(patch: string): string[] {
  return [...patch.matchAll(/^\+\+\+ b\/(\S+)$/gm)].map((match) => match[1]!);
}

describe('native font profile source contract', () => {
  it('keeps the ABI patch limited to the reviewed bridge files', () => {
    expect(patchTargets(abiPatch)).toEqual([
      'desktop/source/lib/init.cxx',
      'desktop/Executable_soffice_bin.mk',
    ]);
  });

  it('applies removal primitives before the font profile ABI', () => {
    const removalIndex = buildScript.indexOf('"wasm-font-removal-primitives.patch"');
    const abiIndex = buildScript.indexOf('"wasm-font-profile-abi.patch"');
    expect(removalIndex).toBeGreaterThan(-1);
    expect(abiIndex).toBeGreaterThan(removalIndex);
    expect(removalPatch).toContain('ReplaceTempDevFonts');
    expect(removalPatch).toContain('ImplInvalidateAllFontData(true)');
    expect(abiPatch).toContain('pDevice->ReplaceTempDevFonts(aRemovedURLs, aAddedURLs)');
  });

  it('invalidates collections before registry replacement and rebuilds afterward', () => {
    expect(removalPatch).toContain('ImplInvalidateAllFontData(true);');
    expect(removalPatch).toContain('mpGraphics->ClearDevFontCache();');
    expect(removalPatch).toContain('mpGraphics->ReplaceTempDevFonts(rRemovedURLs, rAddedURLs)');
    expect(removalPatch).toContain('ImplRefreshAllFontData(true);');
    expect(removalPatch).toContain('if (pFontCollection)');
    expect(removalPatch).toContain('m_aCachedFontOptions.clear();');
    expect(removalPatch).toContain('rWrapper.getFontSet();');
    expect(removalPatch).toContain('FcConfigAppFontClear(pConfig);');
    expect(removalPatch).not.toContain('FcConfigAppFontClear(pConfig) != FcTrue');
    expect(removalPatch).not.toContain('FcConfigAppFontClear(pConfig) == FcTrue');
    expect(abiPatch).not.toContain('nativeFontProfileRollback');
  });

  it('exports a paired allocation ABI and quarantines boundary failures', () => {
    expect(abiPatch).toContain('char* lok_setFontProfile(');
    expect(abiPatch).toContain('void lok_setFontProfileFree(char* pAllocation) noexcept');
    expect(abiPatch).toContain('"_lok_setFontProfile"');
    expect(abiPatch).toContain('"_lok_setFontProfileFree"');
    expect(abiPatch).toContain('aJSON.put("stateKnown", rResult.mbStateKnown);');
    expect(abiPatch).toContain('aResult.mbStateKnown = false;');
    expect(abiPatch).toContain('aResult.mbRuntimeReusable = false;');
    expect(abiPatch).not.toContain('nativeFontProfileRollback');
  });

  it('validates complete array manifests before native mutation', () => {
    expect(abiPatch).toContain('nativeFontProfileValidateRootTypes');
    expect(abiPatch).toContain('Font profile manifests must be JSON arrays');
    expect(abiPatch).toContain('Added and removed lists do not match the complete target manifest');
    expect(abiPatch).toContain('A target font file size does not match its manifest');
    expect(abiPatch).toContain('Font filename must use a supported SFNT extension');
    expect(abiPatch).toContain('rEntry.maSha256 + "." + aExtension');
    expect(abiPatch).toContain('SolarMutexGuard aGuard;');
  });

  it('rejects expensive or ambiguous Worker requests before staging', () => {
    expect(workerSource).toContain('const FONT_PROFILE_MAX_FONTS = 128;');
    expect(workerSource).toContain('const FONT_PROFILE_MAX_BYTES = 512 * 1024 * 1024;');
    expect(workerSource).toContain('Duplicate font content must use one logical filename');
    expect(workerSource).toContain('Duplicate font profile entry');
    expect(workerSource).toContain("const FONT_PROFILE_EXTENSIONS = new Set(['otf', 'ttc', 'tte', 'ttf'])");
    expect(workerSource).toContain('function assertSfntHeader(');
    expect(workerSource).toContain('const runtimeReusable = stateKnown && reportedRuntimeReusable;');
    expect(workerSource).toContain('Font file has an invalid SFNT signature');
    expect(workerSource).toContain(
      'Dynamic font profiles require initialization without legacy static fonts'
    );
    expect(workerSource.indexOf('if (!lokBindings?.supportsFontProfile())')).toBeLessThan(
      workerSource.indexOf('const authoritativeTarget = await calculateProfileFingerprint')
    );
  });
});
