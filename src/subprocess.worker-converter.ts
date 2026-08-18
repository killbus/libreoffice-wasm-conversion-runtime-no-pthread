/**
 * Forked Process LibreOffice Converter
 *
 * Runs the WASM module in a completely separate Node.js process.
 * Includes retry logic for handling transient WASM memory errors.
 */

import { fork, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import {
  ConversionError,
  ConversionErrorCode,
  ConversionOptions,
  ConversionResult,
  DocumentInfo,
  EditorOperationResult,
  EditorSession,
  FORMAT_MIME_TYPES,
  FullQualityPagePreview,
  FullQualityRenderOptions,
  FORMAT_FILTER_OPTIONS,
  buildPdfFilterOptions,
  resolveSingleResultFilterOptions,
  ILibreOfficeConverter,
  InputFormatOptions,
  LibreOfficeWasmOptions,
  LOKDocumentType,
  OutputFormat,
  PagePreview,
  RenderOptions,
} from './types.js';
import type { NodeWorkerOperationResponse } from './node-worker-protocol.js';

// Re-export types used by consumers
export type { LOKDocumentType, OutputFormat, PagePreview, DocumentInfo, EditorSession, RenderOptions };

type WorkerMessage =
  | { type: 'ready' | 'error'; error?: string }
  | ({ type: 'response' } & NodeWorkerOperationResponse);

interface SubprocessConverterOptions extends LibreOfficeWasmOptions {
  /** Max retries for initialization (default: 3) */
  maxInitRetries?: number;
  /** Max retries for conversion (default: 2) */
  maxConversionRetries?: number;
  /** Whether to restart subprocess on memory errors (default: true) */
  restartOnMemoryError?: boolean;
}

export class SubprocessConverter implements ILibreOfficeConverter {
  private child: ChildProcess | null = null;
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private options: SubprocessConverterOptions;
  private initialized = false;
  private initializing = false;
  private restartOnNextConvert = false;
  private workerPath: string = '';

  constructor(options: SubprocessConverterOptions = {}) {
    this.options = {
      wasmPath: './wasm',
      verbose: false,
      maxInitRetries: 3,
      maxConversionRetries: 2,
      restartOnMemoryError: true,
      ...options
    };
  }

  private rejectPending(error: Error): void {
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private discardChild(
    error: Error,
    restartOnNextConvert: boolean,
    targetChild: ChildProcess | null = this.child
  ): void {
    if (targetChild && this.child !== targetChild) return;

    const child = this.child;
    this.child = null;
    this.initialized = false;
    this.restartOnNextConvert = restartOnNextConvert;

    if (child) {
      child.removeAllListeners();
      try { child.kill('SIGKILL'); } catch { /* Already stopped. */ }
    }

    this.rejectPending(error);
  }

  private killWorker(): void {
    this.discardChild(
      new ConversionError(ConversionErrorCode.WASM_NOT_INITIALIZED, 'Subprocess restarted'),
      false
    );
  }

  private isMemoryError(error: string | Error): boolean {
    const msg = error instanceof Error ? error.message : error;
    return msg.includes('memory access out of bounds') ||
           msg.includes('unreachable') ||
           msg.includes('table index is out of bounds') ||
           msg.includes('null function');
  }

  private async spawnWorker(): Promise<void> {
    // Determine worker path
    if (!this.workerPath) {
      try {
        const currentDir = dirname(fileURLToPath(import.meta.url));
        // Check if running from src (development/test) or dist (production)
        if (currentDir.endsWith('/src') || currentDir.endsWith('\\src')) {
          // Running from source - worker is in dist/
          this.workerPath = join(currentDir, '..', 'dist', 'subprocess.worker.cjs');
        } else {
          // Running from dist
          this.workerPath = join(currentDir, 'subprocess.worker.cjs');
        }
      } catch {
        this.workerPath = join(__dirname, 'subprocess.worker.cjs');
      }
    }

    const wasmPath = resolve(this.options.wasmPath || './wasm');

    const child = fork(this.workerPath, [], {
      env: { ...process.env, WASM_PATH: wasmPath, VERBOSE: String(this.options.verbose || false) },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;

    child.stdout?.on('data', (d: Buffer) => { if (this.options.verbose) process.stdout.write(d); });
    child.stderr?.on('data', (d: Buffer) => { if (this.options.verbose) process.stderr.write(d); });

    child.on('message', (msg: WorkerMessage) => {
      if (this.child !== child || msg.type !== 'response') return;

      const pending = this.pending.get(msg.id);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pending.delete(msg.id);

      if (msg.success) {
        pending.resolve(msg.data);
        return;
      }

      const error = new ConversionError(
        ConversionErrorCode.CONVERSION_FAILED,
        msg.error || 'Unknown subprocess error'
      );
      pending.reject(error);
      if (msg.quarantine) {
        this.discardChild(error, true, child);
      }
    });

    child.on('error', (error) => {
      if (this.child !== child) return;
      this.discardChild(error, this.initialized, child);
    });

    child.on('exit', (code) => {
      if (this.child !== child) return;

      const wasInitialized = this.initialized;
      this.child = null;
      this.initialized = false;
      this.restartOnNextConvert = wasInitialized;
      this.rejectPending(new Error(`Subprocess exited with code ${code ?? 'unknown'}`));
    });

    // Wait for ready signal (subprocess started)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Subprocess start timeout')), 30000);
      const handler = (msg: WorkerMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          child.off('message', handler);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          child.off('message', handler);
          reject(new Error(msg.error || 'Subprocess failed to start'));
        }
      };
      child.on('message', handler);
    });

    // Build init payload with fonts and options
    const hasFonts = this.options.fonts?.length;
    const hasSystemFonts = this.options.includeSystemFonts;
    const initPayload = (hasFonts || hasSystemFonts)
      ? {
          fonts: this.options.fonts?.map(f => ({
            filename: f.filename,
            data: Array.from(f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : f.data),
          })),
          includeSystemFonts: this.options.includeSystemFonts,
        }
      : undefined;

    // Now send init message to start WASM loading
    await this.send('init', initPayload, 180000); // 3 minute timeout for WASM init
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) {
      while (this.initializing) await new Promise(r => setTimeout(r, 100));
      if (!this.initialized) {
        throw new ConversionError(
          ConversionErrorCode.WASM_NOT_INITIALIZED,
          'Subprocess initialization failed'
        );
      }
      return;
    }
    this.initializing = true;

    const maxRetries = this.options.maxInitRetries || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.killWorker();
        await this.spawnWorker();
        this.initialized = true;
        this.initializing = false;
        this.restartOnNextConvert = false;
        this.options.onReady?.();
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (this.options.verbose) {
          console.error(`[SubprocessConverter] Init attempt ${attempt}/${maxRetries} failed:`, lastError.message);
        }
        await this.killWorker();

        // Wait before retry
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
    }

    this.initializing = false;
    const err = new ConversionError(ConversionErrorCode.WASM_NOT_INITIALIZED, `Init failed after ${maxRetries} attempts: ${lastError?.message}`);
    this.options.onError?.(err);
    throw err;
  }

  private send(type: string, payload?: unknown, timeoutMs: number = 300000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = this.child;
      if (!child) {
        reject(new ConversionError(ConversionErrorCode.WASM_NOT_INITIALIZED, 'No process'));
        return;
      }

      const id = randomUUID();
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.reject(new ConversionError(ConversionErrorCode.CONVERSION_FAILED, 'Timeout'));
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      try {
        child.send({ type, id, payload });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private normalizeInput(input: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
    if (input instanceof Uint8Array) {
      return input;
    }
    if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    }
    return new Uint8Array(input);
  }

  async convert(input: Uint8Array | ArrayBuffer | Buffer, options: ConversionOptions, filename = 'document'): Promise<ConversionResult> {
    const effectiveFilterOptions = resolveSingleResultFilterOptions(
      options.outputFormat,
      options.filterOptions
    );

    if ((!this.initialized || !this.child) && this.restartOnNextConvert) {
      await this.initialize();
    }
    if (!this.initialized || !this.child) {
      throw new ConversionError(ConversionErrorCode.WASM_NOT_INITIALIZED, 'Not initialized');
    }

    const start = Date.now();
    const data = this.normalizeInput(input);
    if (data.length === 0) throw new ConversionError(ConversionErrorCode.INVALID_INPUT, 'Empty');

    const inputFormat = options.inputFormat || (filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : 'docx');
    let filterOptions = effectiveFilterOptions ?? FORMAT_FILTER_OPTIONS[options.outputFormat] ?? '';
    if (!options.filterOptions && options.outputFormat === 'pdf' && options.pdf) {
      filterOptions = buildPdfFilterOptions(options.pdf) || filterOptions;
    }

    const maxRetries = this.options.maxConversionRetries || 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const r = await this.send('convert', {
          inputData: Array.from(data),
          inputFormat,
          outputFormat: options.outputFormat,
          filterOptions,
          password: options.password,
        }) as number[];

        const base = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
        return {
          data: new Uint8Array(r),
          mimeType: FORMAT_MIME_TYPES[options.outputFormat],
          filename: `${base}.${options.outputFormat}`,
          duration: Date.now() - start
        };
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        if (this.options.verbose) {
          console.error(`[SubprocessConverter] Conversion attempt ${attempt}/${maxRetries} failed:`, lastError.message);
        }

        // A quarantined runtime must not retry inside the poisoned subprocess.
        if (this.restartOnNextConvert) break;

        // If it's a memory error and we should restart, do so
        if (this.isMemoryError(lastError) && this.options.restartOnMemoryError && attempt < maxRetries) {
          if (this.options.verbose) {
            console.error('[SubprocessConverter] Memory error detected, restarting subprocess...');
          }
          await this.killWorker();
          await this.spawnWorker();
          this.initialized = true;
        } else if (attempt < maxRetries) {
          // Small delay before retry
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    throw lastError || new ConversionError(ConversionErrorCode.CONVERSION_FAILED, 'Conversion failed');
  }

  /**
   * Get the number of pages in a document
   */
  async getPageCount(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions
  ): Promise<number> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    return this.send('getPageCount', {
      inputData: Array.from(inputData),
      inputFormat: options.inputFormat
    }) as Promise<number>;
  }

  /**
   * Get document information including type and valid output formats
   */
  async getDocumentInfo(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions
  ): Promise<DocumentInfo> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    return this.send('getDocumentInfo', {
      inputData: Array.from(inputData),
      inputFormat: options.inputFormat
    }) as Promise<DocumentInfo>;
  }

  /**
   * Render a single page as an image
   */
  async renderPage(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions,
    pageIndex: number,
    width: number,
    height = 0
  ): Promise<PagePreview> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const result = await this.send('renderPage', {
      inputData: Array.from(inputData),
      inputFormat: options.inputFormat,
      pageIndex,
      width,
      height,
    }) as { data: number[]; width: number; height: number };

    return {
      page: pageIndex,
      data: new Uint8Array(result.data),
      width: result.width,
      height: result.height,
    };
  }

  /**
   * Render multiple page previews
   */
  async renderPagePreviews(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions,
    renderOptions: RenderOptions = {}
  ): Promise<PagePreview[]> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const result = await this.send('renderPagePreviews', {
      inputData: Array.from(inputData),
      inputFormat: options.inputFormat,
      width: renderOptions.width || 800,
      height: renderOptions.height || 0,
      pageIndices: renderOptions.pageIndices,
    }) as Array<{ page: number; data: number[]; width: number; height: number }>;

    return result.map((preview) => ({
      page: preview.page,
      data: new Uint8Array(preview.data),
      width: preview.width,
      height: preview.height,
    }));
  }

  /**
   * Render a page at full quality (native resolution based on DPI)
   * @param input Document data
   * @param options Must include inputFormat
   * @param pageIndex Zero-based page index to render
   * @param renderOptions DPI and max dimension settings
   * @returns Full quality page preview with RGBA data and DPI info
   */
  async renderPageFullQuality(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions,
    pageIndex: number,
    renderOptions: FullQualityRenderOptions = {}
  ): Promise<FullQualityPagePreview> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const result = await this.send('renderPageFullQuality', {
      inputData: Array.from(inputData),
      inputFormat: options.inputFormat,
      pageIndex,
      dpi: renderOptions.dpi ?? 150,
      maxDimension: renderOptions.maxDimension,
      editMode: renderOptions.editMode ?? false,
    }) as { page: number; data: number[]; width: number; height: number; dpi: number };

    return {
      page: result.page,
      data: new Uint8Array(result.data),
      width: result.width,
      height: result.height,
      dpi: result.dpi,
    };
  }

  /**
   * Extract text content from a document
   */
  async getDocumentText(
    input: Uint8Array | ArrayBuffer | Buffer,
    inputFormat: string
  ): Promise<string | null> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    return this.send('getDocumentText', {
      inputData: Array.from(inputData),
      inputFormat
    }) as Promise<string | null>;
  }

  /**
   * Get page/slide names from a document
   */
  async getPageNames(
    input: Uint8Array | ArrayBuffer | Buffer,
    inputFormat: string
  ): Promise<string[]> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    return this.send('getPageNames', {
      inputData: Array.from(inputData),
      inputFormat
    }) as Promise<string[]>;
  }

  // ============================================
  // Editor Operations
  // ============================================

  /**
   * Open a document for editing
   * Returns a session ID that can be used for subsequent editor operations
   */
  async openDocument(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions
  ): Promise<EditorSession> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    return this.send('openDocument', {
      inputData: Array.from(inputData),
      inputFormat: options.inputFormat
    }) as Promise<EditorSession>;
  }

  /**
   * Execute an editor operation on an open document session
   * @param sessionId - The session ID from openDocument
   * @param method - The editor method to call (e.g., 'insertParagraph', 'getStructure')
   * @param args - Arguments to pass to the method
   */
  async editorOperation<T = unknown>(
    sessionId: string,
    method: string,
    args?: unknown[]
  ): Promise<EditorOperationResult<T>> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    return this.send('editorOperation', { sessionId, method, args: args ?? [] }) as Promise<EditorOperationResult<T>>;
  }

  /**
   * Close an editor session and get the modified document
   * @param sessionId - The session ID from openDocument
   * @returns The modified document data, or undefined if save failed
   */
  async closeDocument(sessionId: string): Promise<Uint8Array | undefined> {
    if (!this.initialized || !this.child) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const result = await this.send('closeDocument', { sessionId }) as number[] | undefined;
    return result ? new Uint8Array(result) : undefined;
  }

  async destroy(): Promise<void> {
    if (this.child) {
      try {
        await this.send('destroy');
      } catch {
        // Child may have already exited, that's fine.
      }
    }

    const error = new ConversionError(
      ConversionErrorCode.WASM_NOT_INITIALIZED,
      'Converter destroyed'
    );
    if (this.child) {
      this.discardChild(error, false, this.child);
    } else {
      this.initialized = false;
      this.restartOnNextConvert = false;
      this.rejectPending(error);
    }
  }

  isReady(): boolean { return this.initialized && this.child !== null; }
}

export async function createSubprocessConverter(options: SubprocessConverterOptions = {}): Promise<SubprocessConverter> {
  const c = new SubprocessConverter(options);
  await c.initialize();
  return c;
}
