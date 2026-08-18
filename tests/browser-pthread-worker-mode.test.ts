import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  locateBrowserRuntimeFile,
  resolveBrowserWasmPaths,
  validateExplicitBrowserWasmPaths,
} from '../src/browser-runtime-paths.js';
import { WorkerBrowserConverter } from '../src/browser.js';
import { createWasmPaths } from '../src/types.js';
import type { BrowserConverterOptions, BrowserWasmPaths } from '../src/types.js';

interface PostedMessage extends Record<string, unknown> {
  type: string;
  id: number;
}

class CapturingWorker {
  static instances: CapturingWorker[] = [];

  readonly messages: PostedMessage[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private readonly messageListeners = new Set<(event: MessageEvent) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  constructor(readonly url: string) {
    CapturingWorker.instances.push(this);
    queueMicrotask(() => this.emitMessage({ type: 'loaded', id: 0 }));
  }

  postMessage(message: unknown): void {
    const posted = message as PostedMessage;
    this.messages.push(posted);
    if (posted.type === 'init') {
      queueMicrotask(() => this.emitMessage({ type: 'ready', id: posted.id }));
    }
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent) => void);
    } else if (type === 'error') {
      this.errorListeners.add(listener as (event: ErrorEvent) => void);
    }
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent) => void);
    } else if (type === 'error') {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void);
    }
  }

  terminate(): void {}

  private emitMessage(data: Record<string, unknown>): void {
    const event = { data } as MessageEvent;
    this.onmessage?.(event);
    for (const listener of this.messageListeners) listener(event);
  }
}

function getInitMessage(): PostedMessage {
  const init = CapturingWorker.instances[0]?.messages.find((message) => message.type === 'init');
  if (!init) throw new Error('Expected an init message');
  return init;
}

beforeEach(() => {
  CapturingWorker.instances.length = 0;
  vi.stubGlobal('Worker', CapturingWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser pthread worker artifact contract', () => {
  it('assigns omitted mode to the main-script type branch', () => {
    const omittedModePaths = {
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
    } satisfies BrowserWasmPaths;

    // @ts-expect-error external mode requires an explicit worker URL
    const externalWithoutWorker: BrowserWasmPaths = {
      ...omittedModePaths,
      pthreadWorkerMode: 'external',
    };
    // @ts-expect-error a worker URL never implies external mode
    const legacyWorkerOnly: BrowserWasmPaths = {
      ...omittedModePaths,
      sofficeWorkerJs: '/candidate/soffice.worker.js',
    };

    expect(omittedModePaths.pthreadWorkerMode).toBeUndefined();
    expect(externalWithoutWorker.pthreadWorkerMode).toBe('external');
    expect(legacyWorkerOnly.sofficeWorkerJs).toBe('/candidate/soffice.worker.js');
  });

  it('creates an explicit main-script path set without a standalone worker URL', () => {
    const paths = createWasmPaths('/candidate');

    expect(paths).toEqual({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
      pthreadWorkerMode: 'main-script',
    });
    expect(Object.hasOwn(paths, 'sofficeWorkerJs')).toBe(false);
  });

  it('defaults Worker initialization to main-script without a standalone worker URL', async () => {
    const converter = new WorkerBrowserConverter({ browserWorkerJs: '/browser-worker.js' });

    await converter.initialize();

    const init = getInitMessage();
    expect(init.pthreadWorkerMode).toBe('main-script');
    expect(Object.hasOwn(init, 'sofficeWorkerJs')).toBe(false);
  });

  it('passes an explicitly selected external worker URL', async () => {
    const converter = new WorkerBrowserConverter({
      browserWorkerJs: '/browser-worker.js',
      pthreadWorkerMode: 'external',
      sofficeWorkerJs: '/candidate/soffice.worker.js',
    });

    await converter.initialize();

    expect(getInitMessage()).toMatchObject({
      pthreadWorkerMode: 'external',
      sofficeWorkerJs: '/candidate/soffice.worker.js',
    });
  });

  it('declares main-script mode without sending an external worker URL', async () => {
    const converter = new WorkerBrowserConverter({
      browserWorkerJs: '/browser-worker.js',
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
      pthreadWorkerMode: 'main-script',
    });

    await converter.initialize();

    const init = getInitMessage();
    expect(init.pthreadWorkerMode).toBe('main-script');
    expect(Object.hasOwn(init, 'sofficeWorkerJs')).toBe(false);
  });

  it('rejects a mixed main-script and external-worker configuration', () => {
    expect(() => new WorkerBrowserConverter({
      pthreadWorkerMode: 'main-script',
      sofficeWorkerJs: '/borrowed/soffice.worker.js',
    })).toThrow('sofficeWorkerJs must be omitted unless pthreadWorkerMode is explicitly "external"');
    expect(CapturingWorker.instances).toHaveLength(0);
  });

  it('rejects a legacy worker URL when the mode is omitted', () => {
    expect(() => new WorkerBrowserConverter({
      sofficeWorkerJs: '/borrowed/soffice.worker.js',
    })).toThrow('sofficeWorkerJs must be omitted unless pthreadWorkerMode is explicitly "external"');
    expect(CapturingWorker.instances).toHaveLength(0);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('rejects an explicit external mode with a %s worker URL', (_label, sofficeWorkerJs) => {
    expect(() => new WorkerBrowserConverter({
      pthreadWorkerMode: 'external',
      sofficeWorkerJs,
    })).toThrow('sofficeWorkerJs must be a non-empty URL');
    expect(CapturingWorker.instances).toHaveLength(0);
  });

  it.each(['', 'sidecar', null])('rejects unsupported pthread mode %j synchronously', (mode) => {
    const options = {
      pthreadWorkerMode: mode,
    } as unknown as BrowserConverterOptions;

    expect(() => new WorkerBrowserConverter(options)).toThrow('unsupported pthreadWorkerMode');
    expect(CapturingWorker.instances).toHaveLength(0);
  });

  it('normalizes an omitted mode to main-script at the explicit Worker boundary', () => {
    const paths = validateExplicitBrowserWasmPaths({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
    });

    expect(paths.pthreadWorkerMode).toBe('main-script');
    expect(Object.hasOwn(paths, 'sofficeWorkerJs')).toBe(false);
  });

  it('requires an explicit worker URL for external mode at the Worker boundary', () => {
    expect(() => validateExplicitBrowserWasmPaths({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
      pthreadWorkerMode: 'external',
    })).toThrow('sofficeWorkerJs must be a non-empty URL');
  });

  it('fails closed when main-script glue unexpectedly asks for an external worker', () => {
    const paths = resolveBrowserWasmPaths({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
      pthreadWorkerMode: 'main-script',
    });

    for (const request of [
      'soffice.worker.js',
      'nested/custom.worker.mjs',
      'nested/custom.worker.wasm',
      'nested/custom.worker.data',
    ]) {
      expect(() => locateBrowserRuntimeFile(request, paths))
        .toThrow('main-script pthread glue unexpectedly requested external worker');
    }
    expect(locateBrowserRuntimeFile('soffice.wasm', paths)).toBe('/candidate/soffice.wasm');
    expect(locateBrowserRuntimeFile('soffice.data', paths)).toBe('/candidate/soffice.data');
  });
});
