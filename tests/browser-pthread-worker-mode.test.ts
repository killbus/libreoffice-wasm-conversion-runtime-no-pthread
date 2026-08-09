import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  locateBrowserRuntimeFile,
  resolveBrowserWasmPaths,
  validateExplicitBrowserWasmPaths,
} from '../src/browser-runtime-paths.js';
import { WorkerBrowserConverter } from '../src/browser.js';

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
  it('preserves the legacy external-worker default', async () => {
    const converter = new WorkerBrowserConverter({ browserWorkerJs: '/browser-worker.js' });

    await converter.initialize();

    expect(getInitMessage()).toMatchObject({
      pthreadWorkerMode: 'external',
      sofficeWorkerJs: '/wasm/soffice.worker.js',
    });
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
    })).toThrow('sofficeWorkerJs must be omitted');
  });

  it('requires an explicit external worker in Worker init messages', () => {
    expect(() => validateExplicitBrowserWasmPaths({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
    })).toThrow('sofficeWorkerJs must be a non-empty URL');
  });

  it('fails closed when main-script glue unexpectedly asks for an external worker', () => {
    const paths = resolveBrowserWasmPaths({
      sofficeJs: '/candidate/soffice.js',
      sofficeWasm: '/candidate/soffice.wasm',
      sofficeData: '/candidate/soffice.data',
      pthreadWorkerMode: 'main-script',
    });

    expect(() => locateBrowserRuntimeFile('soffice.worker.js', paths))
      .toThrow('main-script pthread glue unexpectedly requested external worker');
    expect(locateBrowserRuntimeFile('soffice.wasm', paths)).toBe('/candidate/soffice.wasm');
    expect(locateBrowserRuntimeFile('soffice.data', paths)).toBe('/candidate/soffice.data');
  });
});
