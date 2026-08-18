import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNodeWorkerConversionOptions,
  createNodeWorkerFailureResponse,
} from '../src/node-worker-protocol.js';
import { ConversionErrorCode } from '../src/types.js';

type ConversionOutcome = 'success' | 'failure' | 'quarantine';
type InitializationOutcome = 'success' | 'failure';

const workerHarness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  type PostedMessage = {
    type: string;
    id: string;
    payload?: Record<string, unknown>;
  };

  class FakeEmitter {
    private listeners = new Map<string, Set<Listener>>();

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: Listener): this {
      this.listeners.get(event)?.delete(listener);
      return this;
    }

    removeAllListeners(event?: string): this {
      if (event === undefined) {
        this.listeners.clear();
      } else {
        this.listeners.delete(event);
      }
      return this;
    }

    protected emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) {
        listener(...args);
      }
    }
  }

  const workerInstances: FakeWorker[] = [];
  const workerOutcomes: ConversionOutcome[] = [];
  const workerInitOutcomes: InitializationOutcome[] = [];

  class FakeWorker extends FakeEmitter {
    readonly messages: PostedMessage[] = [];
    terminated = false;
    terminateCalls = 0;

    constructor(readonly path: string) {
      super();
      workerInstances.push(this);
      queueMicrotask(() => this.emit('message', { type: 'ready' }));
    }

    postMessage(message: unknown): void {
      const posted = message as PostedMessage;
      this.messages.push(posted);

      queueMicrotask(() => {
        if (this.terminated) return;

        if (posted.type === 'convert') {
          const outcome = workerOutcomes.shift() ?? 'success';
          if (outcome === 'quarantine') {
            this.emit('message', {
              id: posted.id,
              success: false,
              error: 'cleanup uncertain',
              quarantine: true,
            });
          } else if (outcome === 'failure') {
            this.emit('message', {
              id: posted.id,
              success: false,
              error: 'clean conversion failure',
            });
          } else {
            this.emit('message', {
              id: posted.id,
              success: true,
              data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
            });
          }
          return;
        }

        if (posted.type === 'init' && workerInitOutcomes.shift() === 'failure') {
          this.emit('message', {
            id: posted.id,
            success: false,
            error: 'worker init failed',
          });
          return;
        }

        this.emit('message', {
          id: posted.id,
          success: true,
        });
      });
    }

    async terminate(): Promise<number> {
      this.terminated = true;
      this.terminateCalls += 1;
      return 0;
    }
  }

  const childInstances: FakeChild[] = [];
  const childOutcomes: ConversionOutcome[] = [];
  const childInitOutcomes: InitializationOutcome[] = [];

  class FakeChild extends FakeEmitter {
    readonly messages: PostedMessage[] = [];
    readonly stdout = { on: () => undefined };
    readonly stderr = { on: () => undefined };
    killed = false;
    killCalls = 0;

    constructor() {
      super();
      childInstances.push(this);
      queueMicrotask(() => this.emit('message', { type: 'ready' }));
    }

    send(message: unknown): boolean {
      const posted = message as PostedMessage;
      this.messages.push(posted);

      queueMicrotask(() => {
        if (this.killed) return;

        if (posted.type === 'convert') {
          const outcome = childOutcomes.shift() ?? 'success';
          if (outcome === 'quarantine') {
            this.emit('message', {
              type: 'response',
              id: posted.id,
              success: false,
              error: 'cleanup uncertain',
              quarantine: true,
            });
          } else if (outcome === 'failure') {
            this.emit('message', {
              type: 'response',
              id: posted.id,
              success: false,
              error: 'clean conversion failure',
            });
          } else {
            this.emit('message', {
              type: 'response',
              id: posted.id,
              success: true,
              data: [0x25, 0x50, 0x44, 0x46, 0x2d],
            });
          }
          return;
        }

        if (posted.type === 'init' && childInitOutcomes.shift() === 'failure') {
          this.emit('message', {
            type: 'response',
            id: posted.id,
            success: false,
            error: 'subprocess init failed',
          });
          return;
        }

        this.emit('message', {
          type: 'response',
          id: posted.id,
          success: true,
        });
      });
      return true;
    }

    kill(_signal?: string): boolean {
      this.killed = true;
      this.killCalls += 1;
      return true;
    }
  }

  return {
    FakeWorker,
    workerInstances,
    workerOutcomes,
    workerInitOutcomes,
    childInstances,
    childOutcomes,
    childInitOutcomes,
    fork: () => new FakeChild(),
  };
});

vi.mock('worker_threads', () => ({ Worker: workerHarness.FakeWorker }));
vi.mock('child_process', () => ({ fork: workerHarness.fork }));

import { WorkerConverter } from '../src/node.worker-converter.js';
import { SubprocessConverter } from '../src/subprocess.worker-converter.js';

function findConvertMessage(messages: Array<{ type: string; payload?: Record<string, unknown> }>) {
  const message = messages.find((candidate) => candidate.type === 'convert');
  expect(message).toBeDefined();
  return message!;
}

beforeEach(() => {
  workerHarness.workerInstances.length = 0;
  workerHarness.workerOutcomes.length = 0;
  workerHarness.workerInitOutcomes.length = 0;
  workerHarness.childInstances.length = 0;
  workerHarness.childOutcomes.length = 0;
  workerHarness.childInitOutcomes.length = 0;
});

describe('shared Node worker protocol', () => {
  it('guards every concurrent initialization waiter against a failed owner', () => {
    const expectedGuardCounts = new Map([
      ['../src/browser.ts', 2],
      ['../src/converter.ts', 2],
      ['../src/converter-node.ts', 2],
      ['../src/node.worker-converter.ts', 1],
      ['../src/subprocess.worker-converter.ts', 1],
    ]);

    for (const [relativePath, expectedCount] of expectedGuardCounts) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      const guards = source.match(
        /while \(this\.initializing\)[\s\S]{0,300}?if \(!this\.initialized\) \{[\s\S]{0,200}?ConversionErrorCode\.WASM_NOT_INITIALIZED/g
      ) ?? [];
      expect(guards, relativePath).toHaveLength(expectedCount);
    }
  });

  it('wires both inner workers through the shared conversion and failure helpers', () => {
    for (const relativePath of ['../src/node.worker.ts', '../src/subprocess.worker.cts']) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      expect(source).toContain('createNodeWorkerConversionOptions(payload)');
      expect(source).toContain('createNodeWorkerFailureResponse(');
      expect(source).not.toContain('inputExt:');
    }
  });

  it('preserves password/filter fields and quarantines only poisoned conversions', () => {
    expect(createNodeWorkerConversionOptions({
      inputFormat: 'docx',
      outputFormat: 'pdf',
      filterOptions: '{"Quality":90}',
      password: 'secret',
    })).toEqual({
      inputFormat: 'docx',
      outputFormat: 'pdf',
      filterOptions: '{"Quality":90}',
      password: 'secret',
    });

    const poisonedRuntime = { isReady: () => false };
    expect(createNodeWorkerFailureResponse(
      'convert-id',
      'convert',
      new Error('cleanup uncertain'),
      poisonedRuntime
    )).toEqual({
      id: 'convert-id',
      success: false,
      error: 'cleanup uncertain',
      quarantine: true,
    });
    expect(createNodeWorkerFailureResponse(
      'render-id',
      'renderPage',
      new Error('render failed'),
      poisonedRuntime
    )).not.toHaveProperty('quarantine');
  });
});

describe('Node worker owners', () => {
  it('materializes the CSV zero default in Worker and subprocess owner messages', async () => {
    const expected = '44,34,76,1,,0,false,true,false,false,false,0';
    const workerConverter = new WorkerConverter({ workerPath: './fake-node-worker.cjs' });
    await workerConverter.initialize();
    await workerConverter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    );
    expect(findConvertMessage(workerHarness.workerInstances[0]!.messages).payload)
      .toMatchObject({ filterOptions: expected });
    await workerConverter.destroy();

    const subprocessConverter = new SubprocessConverter({
      maxInitRetries: 1,
      maxConversionRetries: 1,
    });
    await subprocessConverter.initialize();
    await subprocessConverter.convert(
      new Uint8Array([1]),
      { inputFormat: 'xlsx', outputFormat: 'csv' },
      'report.xlsx'
    );
    expect(findConvertMessage(workerHarness.childInstances[0]!.messages).payload)
      .toMatchObject({ filterOptions: expected });
    await subprocessConverter.destroy();
  });

  it('rejects non-singular CSV options before either owner posts a conversion', async () => {
    const options = {
      inputFormat: 'xlsx' as const,
      outputFormat: 'csv' as const,
      filterOptions: '44,34,76,1,,0,false,true,false,false,false,-1',
    };
    const workerConverter = new WorkerConverter({ workerPath: './fake-node-worker.cjs' });
    await workerConverter.initialize();
    await expect(workerConverter.convert(new Uint8Array([1]), options, 'report.xlsx'))
      .rejects.toMatchObject({ code: ConversionErrorCode.INVALID_INPUT });
    expect(workerHarness.workerInstances[0]!.messages.filter(
      (message) => message.type === 'convert'
    )).toHaveLength(0);
    await workerConverter.destroy();

    const subprocessConverter = new SubprocessConverter({
      maxInitRetries: 1,
      maxConversionRetries: 1,
    });
    await subprocessConverter.initialize();
    await expect(subprocessConverter.convert(new Uint8Array([1]), options, 'report.xlsx'))
      .rejects.toMatchObject({ code: ConversionErrorCode.INVALID_INPUT });
    expect(workerHarness.childInstances[0]!.messages.filter(
      (message) => message.type === 'convert'
    )).toHaveLength(0);
    await subprocessConverter.destroy();
  });

  it('terminates a quarantined Worker and converts next time with a fresh Worker', async () => {
    workerHarness.workerOutcomes.push('quarantine', 'success');
    const converter = new WorkerConverter({ workerPath: './fake-node-worker.cjs' });

    await converter.initialize();
    const firstWorker = workerHarness.workerInstances[0]!;

    await expect(converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf', password: 'secret' },
      'report.docx'
    )).rejects.toThrow('cleanup uncertain');

    expect(firstWorker.terminated).toBe(true);
    expect(firstWorker.terminateCalls).toBe(1);
    expect(findConvertMessage(firstWorker.messages).payload).toMatchObject({
      inputFormat: 'docx',
      outputFormat: 'pdf',
      password: 'secret',
    });

    const result = await converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf', password: 'secret' },
      'report.docx'
    );

    expect(workerHarness.workerInstances).toHaveLength(2);
    expect(workerHarness.workerInstances[1]).not.toBe(firstWorker);
    expect(result.data).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    await converter.destroy();
  });

  it('rejects concurrent conversions when a fresh Worker fails to initialize', async () => {
    workerHarness.workerOutcomes.push('quarantine');
    const converter = new WorkerConverter({ workerPath: './fake-node-worker.cjs' });

    await converter.initialize();
    await expect(converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'docx', outputFormat: 'pdf' }
    )).rejects.toThrow('cleanup uncertain');

    workerHarness.workerInitOutcomes.push('failure');
    const results = await Promise.allSettled([
      converter.convert(new Uint8Array([1]), { inputFormat: 'docx', outputFormat: 'pdf' }),
      converter.convert(new Uint8Array([1]), { inputFormat: 'docx', outputFormat: 'pdf' }),
    ]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { code: ConversionErrorCode.WASM_NOT_INITIALIZED },
    });
    const failedWorker = workerHarness.workerInstances[1]!;
    expect(failedWorker.messages.filter((message) => message.type === 'convert')).toHaveLength(0);
    expect(failedWorker.terminated).toBe(true);
    await converter.destroy();
  });

  it('keeps a Worker after a clean conversion failure', async () => {
    workerHarness.workerOutcomes.push('failure', 'success');
    const converter = new WorkerConverter({ workerPath: './fake-node-worker.cjs' });

    await converter.initialize();
    const worker = workerHarness.workerInstances[0]!;

    await expect(converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'docx', outputFormat: 'pdf' }
    )).rejects.toThrow('clean conversion failure');
    expect(worker.terminated).toBe(false);

    await converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'docx', outputFormat: 'pdf' }
    );
    expect(workerHarness.workerInstances).toHaveLength(1);
    await converter.destroy();
  });

  it('kills a quarantined subprocess without retrying it and restarts next time', async () => {
    workerHarness.childOutcomes.push('quarantine', 'success');
    const converter = new SubprocessConverter({
      maxInitRetries: 1,
      maxConversionRetries: 3,
    });

    await converter.initialize();
    const firstChild = workerHarness.childInstances[0]!;

    await expect(converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf', password: 'secret' },
      'report.docx'
    )).rejects.toThrow('cleanup uncertain');

    expect(firstChild.killed).toBe(true);
    expect(firstChild.killCalls).toBe(1);
    expect(firstChild.messages.filter((message) => message.type === 'convert')).toHaveLength(1);
    expect(findConvertMessage(firstChild.messages).payload).toMatchObject({
      inputFormat: 'docx',
      outputFormat: 'pdf',
      password: 'secret',
    });

    const result = await converter.convert(
      new Uint8Array([1, 2, 3]),
      { inputFormat: 'docx', outputFormat: 'pdf', password: 'secret' },
      'report.docx'
    );

    expect(workerHarness.childInstances).toHaveLength(2);
    expect(workerHarness.childInstances[1]).not.toBe(firstChild);
    expect(result.data).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    await converter.destroy();
  });

  it('rejects concurrent conversions when a fresh subprocess fails to initialize', async () => {
    workerHarness.childOutcomes.push('quarantine');
    const converter = new SubprocessConverter({
      maxInitRetries: 1,
      maxConversionRetries: 1,
    });

    await converter.initialize();
    await expect(converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'docx', outputFormat: 'pdf' }
    )).rejects.toThrow('cleanup uncertain');

    workerHarness.childInitOutcomes.push('failure');
    const results = await Promise.allSettled([
      converter.convert(new Uint8Array([1]), { inputFormat: 'docx', outputFormat: 'pdf' }),
      converter.convert(new Uint8Array([1]), { inputFormat: 'docx', outputFormat: 'pdf' }),
    ]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    for (const result of results) {
      expect(result).toMatchObject({
        status: 'rejected',
        reason: { code: ConversionErrorCode.WASM_NOT_INITIALIZED },
      });
    }
    const failedChild = workerHarness.childInstances[1]!;
    expect(failedChild.messages.filter((message) => message.type === 'convert')).toHaveLength(0);
    expect(failedChild.killed).toBe(true);
    await converter.destroy();
  });

  it('keeps a subprocess after a clean conversion failure', async () => {
    workerHarness.childOutcomes.push('failure', 'success');
    const converter = new SubprocessConverter({
      maxInitRetries: 1,
      maxConversionRetries: 1,
    });

    await converter.initialize();
    const child = workerHarness.childInstances[0]!;

    await expect(converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'docx', outputFormat: 'pdf' }
    )).rejects.toThrow('clean conversion failure');
    expect(child.killed).toBe(false);

    await converter.convert(
      new Uint8Array([1]),
      { inputFormat: 'docx', outputFormat: 'pdf' }
    );
    expect(workerHarness.childInstances).toHaveLength(1);
    await converter.destroy();
  });
});
