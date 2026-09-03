import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerBrowserConverter } from '../src/browser.js';
import { LOKBindings } from '../src/lok-bindings.js';
import {
  FONT_PROFILE_SCHEMA_VERSION,
  type EmscriptenModule,
  type FontProfileRequest,
  type FontProfileResult,
  type NativeFontProfileRequest,
} from '../src/types.js';

interface PostedMessage extends Record<string, unknown> {
  type: string;
  id: number;
}

class FontProfileWorker {
  static instances: FontProfileWorker[] = [];
  readonly messages: Array<{ message: PostedMessage; transfer: Transferable[] }> = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private readonly messageListeners = new Set<(event: MessageEvent) => void>();

  constructor(readonly url: string) {
    FontProfileWorker.instances.push(this);
    queueMicrotask(() => this.emit({ type: 'loaded', id: 0 }));
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const posted = message as PostedMessage;
    this.messages.push({ message: posted, transfer });
    queueMicrotask(() => {
      if (posted.type === 'init') {
        this.emit({ type: 'ready', id: posted.id });
      } else if (posted.type === 'setFontProfile') {
        const profile = posted.profile as FontProfileRequest;
        const result: FontProfileResult = {
          schemaVersion: FONT_PROFILE_SCHEMA_VERSION,
          transitionId: profile.transitionId,
          ok: false,
          code: 'UNSUPPORTED',
          expectedActiveFingerprint: profile.expectedActiveFingerprint,
          targetFingerprint: profile.targetFingerprint,
          activeFingerprint: profile.expectedActiveFingerprint,
          appliedFingerprint: profile.expectedActiveFingerprint,
          addedCount: 0,
          removedCount: 0,
          mutation: { attempted: false, committed: false, stage: 'validate' },
          rollback: { attempted: false, succeeded: null },
          stateKnown: true,
          runtimeReusable: true,
          quarantine: false,
          identity: { worker: 'worker:1', module: 'module:1', lok: 'lok:1' },
          diagnostics: {
            activeFontCount: 0,
            activeFontBytes: 0,
            stagedFontCount: 0,
            retiredFontCount: 0,
            cleanupDebtPaths: [],
            messages: ['Native lok_setFontProfile export is unavailable'],
          },
        };
        this.emit({ type: 'fontProfileResult', id: posted.id, fontProfileResult: result });
      }
    });
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.messageListeners.add(listener as (event: MessageEvent) => void);
  }

  removeEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.messageListeners.delete(listener as (event: MessageEvent) => void);
  }

  terminate(): void {}

  private emit(data: Record<string, unknown>): void {
    const event = { data } as MessageEvent;
    this.onmessage?.(event);
    for (const listener of this.messageListeners) listener(event);
  }
}

function profileFingerprint(filename: string, sha256: string): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify([{ filename, sha256 }]))
    .digest('hex')}`;
}

beforeEach(() => {
  FontProfileWorker.instances.length = 0;
  vi.stubGlobal('Worker', FontProfileWorker);
});

afterEach(() => vi.unstubAllGlobals());

describe('browser dynamic font profile runtime', () => {
  it('transfers copied font ArrayBuffers with the complete profile contract', async () => {
    const converter = createWorkerBrowserConverter({ browserWorkerJs: '/font-worker.js' });
    await converter.initialize();

    const source = new Uint8Array([1, 2, 3, 4]);
    const sha256 = createHash('sha256').update(source).digest('hex');
    const profile: FontProfileRequest = {
      schemaVersion: FONT_PROFILE_SCHEMA_VERSION,
      transitionId: 'transition-1',
      expectedActiveFingerprint: `sha256:${createHash('sha256').update('[]').digest('hex')}`,
      targetFingerprint: profileFingerprint('Test.ttf', sha256),
      fonts: [{ filename: 'Test.ttf', sha256, data: source }],
    };

    await expect(converter.setFontProfile(profile)).resolves.toMatchObject({
      code: 'UNSUPPORTED',
      transitionId: 'transition-1',
      runtimeReusable: true,
    });

    const posted = FontProfileWorker.instances[0]!.messages.find(
      ({ message }) => message.type === 'setFontProfile'
    );
    const postedProfile = posted?.message.profile as FontProfileRequest;
    expect(posted?.transfer).toHaveLength(1);
    expect(posted?.transfer[0]).toBe(postedProfile.fonts[0]!.data);
    expect(postedProfile.fonts[0]!.data).not.toBe(source.buffer);
    expect(source).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('safely reports an unavailable native export', () => {
    const module = {
      HEAPU8: new Uint8Array(16),
      HEAP32: new Int32Array(4),
      HEAPU32: new Uint32Array(4),
      FS: {},
      _malloc: () => 1,
      _free: () => undefined,
      ccall: () => undefined,
      cwrap: () => () => undefined,
    } as unknown as EmscriptenModule;
    const bindings = new LOKBindings(module);
    const request = {} as NativeFontProfileRequest;
    expect(bindings.supportsFontProfile()).toBe(false);
    expect(bindings.setFontProfile(request)).toBeNull();
  });

  it('requires the paired native free export', () => {
    const module = {
      HEAPU8: new Uint8Array(16),
      HEAP32: new Int32Array(4),
      HEAPU32: new Uint32Array(4),
      FS: {},
      _lok_setFontProfile: () => 1,
      _lok_documentLoad: () => 1,
      _lok_documentLoadWithOptions: () => 1,
      _lok_documentDestroy: () => undefined,
      _malloc: () => 1,
      _free: () => undefined,
      ccall: () => undefined,
      cwrap: () => () => undefined,
    } as unknown as EmscriptenModule;
    const bindings = new LOKBindings(module);
    expect(bindings.supportsFontProfile()).toBe(false);
    expect(bindings.setFontProfile({} as NativeFontProfileRequest)).toBeNull();
  });

  it('requires tracked document lifecycle shims for dynamic profiles', () => {
    const module = {
      HEAPU8: new Uint8Array(16),
      HEAP32: new Int32Array(4),
      HEAPU32: new Uint32Array(4),
      FS: {},
      _lok_setFontProfile: () => 1,
      _lok_setFontProfileFree: () => undefined,
      _malloc: () => 1,
      _free: () => undefined,
      ccall: () => undefined,
      cwrap: () => () => undefined,
    } as unknown as EmscriptenModule;
    const bindings = new LOKBindings(module);
    expect(bindings.supportsFontProfile()).toBe(false);
  });

  it('rejects malformed native result JSON', () => {
    const freeResult = vi.fn();
    const heap = new Uint8Array(8192);
    heap.set(new TextEncoder().encode('{}\0'), 8);
    const module = {
      HEAPU8: heap,
      HEAP32: new Int32Array(heap.buffer),
      HEAPU32: new Uint32Array(heap.buffer),
      FS: {},
      _lok_setFontProfile: () => 8,
      _lok_setFontProfileFree: freeResult,
      _lok_documentLoad: () => 1,
      _lok_documentLoadWithOptions: () => 1,
      _lok_documentDestroy: () => undefined,
      _malloc: () => 128,
      _free: () => undefined,
      ccall: () => undefined,
      cwrap: () => () => undefined,
    } as unknown as EmscriptenModule;
    const bindings = new LOKBindings(module);
    Object.defineProperty(bindings, 'lokPtr', { value: 1 });

    expect(() => bindings.setFontProfile({} as NativeFontProfileRequest)).toThrow(
      'Native font profile bridge returned an invalid result contract'
    );
    expect(freeResult).toHaveBeenCalledWith(8);
  });

  it('keeps the Worker protocol serialized and content-addressed', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser.worker.ts', import.meta.url)), 'utf8');
    expect(source).toContain("globalThis.crypto.subtle.digest('SHA-256'");
    expect(source).toContain("const FONT_PROFILE_ROOT = '/tmp/font-profiles/sha256'");
    expect(source).toContain("const FONT_PROFILE_EXTENSIONS = new Set(['otf', 'ttc', 'tte', 'ttf'])");
    expect(source).toContain('`${FONT_PROFILE_ROOT}/${sha256}.${fontProfileExtension(font.filename)}`');
    expect(source).toContain('closeCachedDocumentStrict()');
    expect(source).toContain("code: 'FONT_PROFILE_BUSY'");
    expect(source).toContain('nativeOperationTail.then(() => dispatchMessage(msg))');
    expect(source).toContain('lokBindings.setFontProfile({');
    expect(source.indexOf('if (!lokBindings?.supportsFontProfile())')).toBeGreaterThan(-1);
    expect(source).not.toContain(
      'if (profile.targetFingerprint.toLowerCase() === activeFontFingerprint)'
    );
  });
});
