import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withEmscriptenStartupPolicy } from '../src/emscripten-startup-policy.js';

const readSource = (path: string): string => readFileSync(path, 'utf8');

describe('Emscripten startup policy', () => {
  it('forces noInitialRun while preserving caller callbacks and config', () => {
    const onRuntimeInitialized = () => undefined;
    const config = withEmscriptenStartupPolicy({
      noInitialRun: false,
      onRuntimeInitialized,
      marker: 'preserved',
    });

    expect(config.noInitialRun).toBe(true);
    expect(config.onRuntimeInitialized).toBe(onRuntimeInitialized);
    expect(config.marker).toBe('preserved');
  });

  it.each([
    ['browser worker', 'src/browser.worker.ts', /self\.Module = withEmscriptenStartupPolicy\(\{/],
    ['browser main thread', 'src/browser.ts', /win\.Module = withEmscriptenStartupPolicy\(\{/],
    ['browser converter factory', 'src/converter.ts', /const moduleWithCallback = withEmscriptenStartupPolicy\(\{/],
    ['node converter', 'src/converter-node.ts', /const config = withEmscriptenStartupPolicy\(\{/],
    ['legacy subprocess', 'src/subprocess.cts', /\(global as any\)\.Module = \{\s+noInitialRun: true,/],
    ['legacy fork worker', 'src/fork-worker.cts', /\(global as any\)\.Module = \{\s+noInitialRun: true,/],
  ])('applies the policy in the %s loading path', (_name, path, pattern) => {
    expect(readSource(path)).toMatch(pattern);
  });

  it('applies the invariant after caller config in both Node loader APIs', () => {
    const source = readSource('wasm/loader.cjs');

    const asyncStart = source.indexOf('function createModule(config = {})');
    const asyncEnd = source.indexOf('function createModuleSync(config = {})');
    const asyncBody = source.slice(asyncStart, asyncEnd);
    expect(asyncBody.indexOf('...Object.fromEntries(')).toBeGreaterThan(-1);
    expect(asyncBody.lastIndexOf('noInitialRun: true')).toBeGreaterThan(
      asyncBody.indexOf('...Object.fromEntries(')
    );

    const syncEnd = source.indexOf('function preloadWasmBinary()');
    const syncBody = source.slice(asyncEnd, syncEnd);
    expect(syncBody.indexOf('...config,')).toBeGreaterThan(-1);
    expect(syncBody.lastIndexOf('noInitialRun: true')).toBeGreaterThan(
      syncBody.indexOf('...config,')
    );
  });

  it.each(['wasm/soffice.js', 'wasm/soffice.cjs'])(
    'generated lifecycle in %s honors noInitialRun after runtime callback',
    (path) => {
      const source = readSource(path);
      const initRuntime = source.indexOf('initRuntime();');
      const preMain = source.indexOf('preMain();', initRuntime);
      const callback = source.indexOf('Module["onRuntimeInitialized"]?.();', preMain);
      const conditionalMain = source.indexOf('if(shouldRunNow)callMain(args);', callback);

      expect(source).toContain('if(Module["noInitialRun"])shouldRunNow=false');
      expect(initRuntime).toBeGreaterThan(-1);
      expect(preMain).toBeGreaterThan(initRuntime);
      expect(callback).toBeGreaterThan(preMain);
      expect(conditionalMain).toBeGreaterThan(callback);
    }
  );
});
