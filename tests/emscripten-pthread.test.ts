import { describe, expect, it, vi } from 'vitest';
import { terminateExportedPThreads } from '../src/emscripten-pthread.js';

describe('terminateExportedPThreads', () => {
  it('does not throw when PThread is an unexported Emscripten runtime method', () => {
    const getter = vi.fn(() => {
      throw new Error("'PThread' was not exported");
    });
    const runtime = {};
    Object.defineProperty(runtime, 'PThread', { get: getter });

    expect(() => terminateExportedPThreads(runtime)).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('terminates exported pthread workers and clears their collections', () => {
    const runningWorker = { terminate: vi.fn() };
    const unusedWorker = { terminate: vi.fn() };
    const terminateAllThreads = vi.fn(() => {
      throw new Error('runtime termination failed');
    });
    const pthread = {
      terminateAllThreads,
      runningWorkers: [runningWorker],
      unusedWorkers: [unusedWorker],
    };

    expect(() => terminateExportedPThreads({ PThread: pthread })).not.toThrow();
    expect(terminateAllThreads).toHaveBeenCalledOnce();
    expect(runningWorker.terminate).toHaveBeenCalledOnce();
    expect(unusedWorker.terminate).toHaveBeenCalledOnce();
    expect(pthread.runningWorkers).toEqual([]);
    expect(pthread.unusedWorkers).toEqual([]);
  });
});
