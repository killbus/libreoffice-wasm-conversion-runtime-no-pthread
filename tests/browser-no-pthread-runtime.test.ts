import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  locateBrowserRuntimeFile,
  resolveBrowserWasmPaths,
  validateExplicitBrowserWasmPaths,
} from '../src/browser-runtime-paths.js';
import { createWorkerBrowserConverter } from '../src/browser.js';
import { createWasmPaths } from '../src/types.js';
import type { BrowserWasmPaths } from '../src/types.js';

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
    if (type === 'message') this.messageListeners.add(listener as (event: MessageEvent) => void);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.messageListeners.delete(listener as (event: MessageEvent) => void);
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

afterEach(() => vi.unstubAllGlobals());

describe('browser no-pthread runtime contract', () => {
  it('creates exactly the three native runtime paths', () => {
    expect(createWasmPaths('/candidate')).toEqual({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
    });
  });

  it('does not accept legacy pthread fields in the public type', () => {
    const paths: BrowserWasmPaths = createWasmPaths('/candidate');
    // @ts-expect-error no-pthread profile has no pthread bootstrap selector
    paths.pthreadWorkerMode = 'main-script';
    // @ts-expect-error no-pthread profile has no internal worker URL
    paths.sofficeWorkerJs = '/candidate/soffice.worker.js';
    expect(paths.sofficeJs).toBe('/candidate/soffice.js');
  });

  it('sends only core runtime paths to the outer browser worker', async () => {
    const converter = createWorkerBrowserConverter({
      browserWorkerJs: '/browser-worker.js',
      ...createWasmPaths('/candidate'),
    });
    await converter.initialize();
    const init = getInitMessage();
    expect(init).toMatchObject({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
    });
    expect(Object.hasOwn(init, 'pthreadWorkerMode')).toBe(false);
    expect(Object.hasOwn(init, 'sofficeWorkerJs')).toBe(false);
  });

  it('requires all explicit worker-boundary paths', () => {
    expect(() => validateExplicitBrowserWasmPaths({ sofficeJs: '/soffice.js' }))
      .toThrow('sofficeWasm must be a non-empty URL');
  });

  it('resolves wasm and data requests but rejects nested workers', () => {
    const paths = resolveBrowserWasmPaths(createWasmPaths('/candidate'));
    expect(locateBrowserRuntimeFile('soffice.wasm', paths)).toBe('/candidate/soffice.wasm');
    expect(locateBrowserRuntimeFile('soffice.data', paths)).toBe('/candidate/soffice.data');
    expect(() => locateBrowserRuntimeFile('soffice.worker.js', paths))
      .toThrow('no-pthread glue unexpectedly requested worker');
  });
});
