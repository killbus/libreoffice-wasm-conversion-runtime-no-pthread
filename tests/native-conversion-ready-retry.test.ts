import { describe, expect, it, vi } from 'vitest';
import {
  NATIVE_CONVERSION_RUNTIME_NOT_READY_MESSAGE,
  NativeConversionError,
  isNativeConversionRuntimeNotReady,
  runNativeConversionWhenReady,
} from '../src/native-conversion-bridge.js';
import type { NativeConversionResult } from '../src/native-conversion-bridge.js';

const successResult: NativeConversionResult = {
  schemaVersion: 1,
  ok: true,
  stage: 'complete',
  cleanup: 'clean',
  hiddenLoad: true,
  visibleFrameSetupEntered: false,
};

function runtimeNotReadyResult(): NativeConversionResult {
  return {
    schemaVersion: 1,
    ok: false,
    stage: 'validate',
    cleanup: 'not-needed',
    hiddenLoad: false,
    visibleFrameSetupEntered: false,
    message: NATIVE_CONVERSION_RUNTIME_NOT_READY_MESSAGE,
  };
}

describe('native conversion runtime-ready retry', () => {
  it('recognizes only the exact safe pre-document retry result', () => {
    const result = runtimeNotReadyResult();
    expect(isNativeConversionRuntimeNotReady(result)).toBe(true);

    expect(isNativeConversionRuntimeNotReady({
      ...result,
      stage: 'load',
    })).toBe(false);
    expect(isNativeConversionRuntimeNotReady({
      ...result,
      cleanup: 'uncertain',
    })).toBe(false);
    expect(isNativeConversionRuntimeNotReady({
      ...result,
      hiddenLoad: true,
    })).toBe(false);
    expect(isNativeConversionRuntimeNotReady({
      ...result,
      message: 'another validation failure',
    })).toBe(false);
  });

  it('yields between temporary failures and returns the first non-busy result', async () => {
    let nowMs = 0;
    let attempts = 0;
    const events: string[] = [];
    const sleep = vi.fn(async (delayMs: number) => {
      events.push(`sleep:${delayMs}`);
      nowMs += delayMs;
    });

    const result = await runNativeConversionWhenReady(
      () => {
        attempts += 1;
        events.push(`convert:${attempts}`);
        return attempts < 3 ? runtimeNotReadyResult() : successResult;
      },
      {
        timeoutMs: 100,
        retryDelayMs: 10,
        now: () => nowMs,
        sleep,
      }
    );

    expect(result).toBe(successResult);
    expect(events).toEqual([
      'convert:1',
      'sleep:10',
      'convert:2',
      'sleep:10',
      'convert:3',
    ]);
  });

  it('does not retry an ordinary native conversion failure', async () => {
    const loadFailure: NativeConversionResult = {
      schemaVersion: 1,
      ok: false,
      stage: 'load',
      cleanup: 'not-needed',
      hiddenLoad: false,
      visibleFrameSetupEntered: false,
      message: 'Document could not be loaded',
    };
    const convert = vi.fn(() => loadFailure);
    const sleep = vi.fn(async () => undefined);

    await expect(runNativeConversionWhenReady(convert, { sleep })).resolves.toBe(loadFailure);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails clearly and keeps the untouched runtime reusable at the deadline', async () => {
    let nowMs = 0;
    const convert = vi.fn(() => runtimeNotReadyResult());
    const sleep = vi.fn(async (delayMs: number) => {
      nowMs += delayMs;
    });

    let observed: unknown;
    try {
      await runNativeConversionWhenReady(convert, {
        timeoutMs: 20,
        retryDelayMs: 10,
        now: () => nowMs,
        sleep,
      });
    } catch (error) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(NativeConversionError);
    const error = observed as NativeConversionError;
    expect(error.kind).toBe('conversion');
    expect(error.runtimeReusable).toBe(true);
    expect(error.result).toEqual(runtimeNotReadyResult());
    expect(error.message).toBe(
      'LibreOffice runtime did not become ready for conversion within 20 ms'
    );
    expect(convert).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});