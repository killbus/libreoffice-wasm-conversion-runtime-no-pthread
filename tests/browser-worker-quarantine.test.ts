import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerBrowserConverter } from '../src/browser.js';

interface PostedMessage {
  type: string;
  id: number;
  filterOptions?: string;
}

class RestartingFakeWorker {
  static instances: RestartingFakeWorker[] = [];

  readonly index: number;
  readonly messages: PostedMessage[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private readonly messageListeners = new Set<(event: MessageEvent) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  constructor(readonly url: string) {
    this.index = RestartingFakeWorker.instances.length;
    RestartingFakeWorker.instances.push(this);
    queueMicrotask(() => this.emitMessage({ type: 'loaded', id: 0 }));
  }

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    const posted = message as PostedMessage;
    this.messages.push(posted);

    queueMicrotask(() => {
      if (this.terminated) return;

      if (posted.type === 'init') {
        this.emitMessage({ type: 'ready', id: posted.id });
      } else if (posted.type === 'convert' && this.index === 0) {
        this.emitMessage({
          type: 'error',
          id: posted.id,
          error: 'cleanup uncertain',
          quarantine: true,
        });
      } else if (posted.type === 'convert') {
        this.emitMessage({
          type: 'result',
          id: posted.id,
          data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
        });
      }
    });
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

  terminate = vi.fn(() => {
    this.terminated = true;
  });

  private emitMessage(data: Record<string, unknown>): void {
    const event = { data } as MessageEvent;
    this.onmessage?.(event);
    for (const listener of this.messageListeners) {
      listener(event);
    }
  }
}

beforeEach(() => {
  RestartingFakeWorker.instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkerBrowserConverter quarantine lifecycle', () => {
  it('materializes the CSV zero default before crossing the Worker boundary', async () => {
    vi.stubGlobal('Worker', RestartingFakeWorker);
    const converter = new WorkerBrowserConverter({ browserWorkerJs: '/fake-worker.js' });

    await converter.initialize();
    await expect(converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    )).rejects.toThrow('cleanup uncertain');

    const convertMessage = RestartingFakeWorker.instances[0]!.messages.find(
      (message) => message.type === 'convert'
    );
    expect(convertMessage?.filterOptions).toBe(
      '44,34,76,1,,0,false,true,false,false,false,0'
    );
  });

  it('rejects non-singular CSV options before posting to the Worker', async () => {
    vi.stubGlobal('Worker', RestartingFakeWorker);
    const converter = new WorkerBrowserConverter({ browserWorkerJs: '/fake-worker.js' });

    await converter.initialize();
    await expect(converter.convert(
      new Uint8Array([1]),
      {
        inputFormat: 'xlsx',
        outputFormat: 'csv',
        filterOptions: '44,34,76,1,,0,false,true,false,false,false,-1',
      },
      'report.xlsx'
    )).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(RestartingFakeWorker.instances[0]!.messages.filter(
      (message) => message.type === 'convert'
    )).toHaveLength(0);
  });

  it('terminates a quarantined Worker and automatically converts with a fresh Worker', async () => {
    vi.stubGlobal('Worker', RestartingFakeWorker);
    const converter = new WorkerBrowserConverter({ browserWorkerJs: '/fake-worker.js' });

    await converter.initialize();
    const firstWorker = RestartingFakeWorker.instances[0];

    await expect(converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf' },
      'report.docx'
    )).rejects.toThrow('cleanup uncertain');

    expect(firstWorker.terminate).toHaveBeenCalledOnce();

    const result = await converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf' },
      'report.docx'
    );

    expect(RestartingFakeWorker.instances).toHaveLength(2);
    expect(RestartingFakeWorker.instances[1]).not.toBe(firstWorker);
    expect(result.data).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
  });

  it('does not retain a pending request when postMessage throws synchronously', async () => {
    const converter = new WorkerBrowserConverter();
    const worker = {
      postMessage: vi.fn(() => {
        throw new Error('structured clone failed');
      }),
      terminate: vi.fn(),
    } as unknown as Worker;
    Object.assign(converter as unknown as Record<string, unknown>, {
      worker,
      initialized: true,
    });

    await expect(converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf' },
      'report.docx'
    )).rejects.toThrow('structured clone failed');

    const internals = converter as unknown as {
      pendingRequests: Map<number, unknown>;
    };
    expect(internals.pendingRequests).toHaveLength(0);
  });
});
