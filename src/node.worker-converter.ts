/**
 * Worker-based LibreOffice Converter
 * 
 * This converter runs the WASM module in a Worker thread to avoid
 * blocking the main Node.js event loop.
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import {
  ConversionError,
  ConversionErrorCode,
  ConversionOptions,
  ConversionResult,
  DocumentInfo,
  EditorOperationResult,
  EditorSession,
  FORMAT_FILTER_OPTIONS,
  FORMAT_MIME_TYPES,
  FullQualityPagePreview,
  FullQualityRenderOptions,
  ILibreOfficeConverter,
  InputFormatOptions,
  LibreOfficeWasmOptions,
  LOKDocumentType,
  OutputFormat,
  PagePreview,
  RenderOptions,
  buildPdfFilterOptions,
  resolveSingleResultFilterOptions,
} from './types.js';
import type { NodeWorkerOperationResponse } from './node-worker-protocol.js';

// Re-export types used by consumers
export type { LOKDocumentType, OutputFormat, PagePreview, DocumentInfo, EditorSession, RenderOptions };

type WorkerResponse = NodeWorkerOperationResponse;

/** Worker message for ready/error notifications */
interface WorkerMessage {
  type: 'ready' | 'error';
  error?: string;
}

/** Raw preview data from worker */
interface RawPreviewData {
  page: number;
  data: ArrayBuffer | Uint8Array;
  width: number;
  height: number;
}

/**
 * Worker-based LibreOffice Converter
 * Uses a separate thread to avoid blocking the main event loop
 */
export class WorkerConverter implements ILibreOfficeConverter {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
  private options: LibreOfficeWasmOptions;
  private initialized = false;
  private initializing = false;
  private restartOnNextConvert = false;

  constructor(options: LibreOfficeWasmOptions = {}) {
    this.options = {
      wasmPath: './wasm',
      verbose: false,
      ...options,
    };
  }

  private discardWorker(
    error: Error,
    restartOnNextConvert: boolean,
    targetWorker: Worker | null = this.worker
  ): void {
    if (targetWorker && this.worker !== targetWorker) return;

    const worker = this.worker;
    this.worker = null;
    this.initialized = false;
    this.restartOnNextConvert = restartOnNextConvert;

    if (worker) {
      worker.removeAllListeners();
      void worker.terminate().catch(() => undefined);
    }

    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  /**
   * Initialize the converter
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializing) {
      while (this.initializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!this.initialized) {
        throw new ConversionError(
          ConversionErrorCode.WASM_NOT_INITIALIZED,
          'Worker initialization failed'
        );
      }
      return;
    }

    this.initializing = true;

    try {
      // Find the worker script path
      let workerPath: string;

      if (this.options.workerPath) {
        // Use explicit worker path if provided
        workerPath = resolve(this.options.workerPath);
      } else {
        // Auto-detect worker path
        try {
          const currentDir = dirname(fileURLToPath(import.meta.url));
          workerPath = join(currentDir, 'node.worker.cjs');
        } catch {
          workerPath = join(__dirname, 'node.worker.cjs');
        }

        // If worker doesn't exist at computed path, try dist/ relative to cwd
        // (handles vitest running source files directly)
        if (!existsSync(workerPath)) {
          const distWorkerPath = resolve(process.cwd(), 'dist', 'node.worker.cjs');
          if (existsSync(distWorkerPath)) {
            workerPath = distWorkerPath;
          }
        }
      }

      // Create the worker
      const worker = new Worker(workerPath);
      this.worker = worker;

      // Wait for the worker script to load before sending init.
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          worker.off('message', messageHandler);
          worker.off('error', errorHandler);
        };
        const messageHandler = (message: WorkerMessage) => {
          if (message.type === 'ready') {
            cleanup();
            resolve();
          }
        };
        const errorHandler = (error: Error) => {
          cleanup();
          reject(error);
        };
        worker.on('message', messageHandler);
        worker.on('error', errorHandler);
      });

      if (this.worker !== worker) {
        throw new Error('Worker became unavailable during initialization');
      }

      // Set up operation response handling after the one-time ready signal.
      worker.on('message', (response: WorkerResponse | { type: string }) => {
        if (this.worker !== worker) return;
        if ('type' in response && response.type === 'ready') return;

        const result = response as WorkerResponse;
        const pending = this.pending.get(result.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pending.delete(result.id);

        if (result.success) {
          pending.resolve(result.data);
          return;
        }

        const error = new ConversionError(
          ConversionErrorCode.CONVERSION_FAILED,
          result.error || 'Unknown worker error'
        );
        pending.reject(error);
        if (result.quarantine) {
          this.discardWorker(error, true, worker);
        }
      });

      worker.on('error', (error) => {
        if (this.worker !== worker) return;
        this.discardWorker(error, this.initialized, worker);
      });

      // Initialize the WASM module in the worker
      await this.sendMessage('init', {
        wasmPath: this.options.wasmPath,
        verbose: this.options.verbose,
      });

      this.initialized = true;
      this.restartOnNextConvert = false;
      this.options.onReady?.();
    } catch (error) {
      const convError = error instanceof ConversionError
        ? error
        : new ConversionError(
            ConversionErrorCode.WASM_NOT_INITIALIZED,
            `Failed to initialize worker: ${String(error)}`
          );
      this.discardWorker(convError, false);
      this.options.onError?.(convError);
      throw convError;
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Send a message to the worker and wait for response
   */
  private sendMessage(type: string, payload?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new ConversionError(
          ConversionErrorCode.WASM_NOT_INITIALIZED,
          'Worker not initialized'
        ));
        return;
      }

      const id = randomUUID();

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id);
          pending.reject(new ConversionError(
            ConversionErrorCode.CONVERSION_FAILED,
            'Worker operation timeout'
          ));
        }
      }, 300000);

      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.worker.postMessage({ type, id, payload });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Convert a document
   */
  async convert(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: ConversionOptions,
    filename = 'document'
  ): Promise<ConversionResult> {
    const effectiveFilterOptions = resolveSingleResultFilterOptions(
      options.outputFormat,
      options.filterOptions
    );

    if ((!this.initialized || !this.worker) && this.restartOnNextConvert) {
      await this.initialize();
    }
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const startTime = Date.now();
    const inputData = this.normalizeInput(input);

    if (inputData.length === 0) {
      throw new ConversionError(
        ConversionErrorCode.INVALID_INPUT,
        'Empty document provided'
      );
    }

    const inputFormat = options.inputFormat || this.getExtensionFromFilename(filename) || 'docx';
    const outputFormat = options.outputFormat;

    let filterOptions = effectiveFilterOptions ?? FORMAT_FILTER_OPTIONS[outputFormat] ?? '';
    if (!options.filterOptions && outputFormat === 'pdf' && options.pdf) {
      filterOptions = buildPdfFilterOptions(options.pdf) || filterOptions;
    }

    const result = await this.sendMessage('convert', {
      inputData,
      inputFormat,
      outputFormat,
      filterOptions,
      password: options.password,
      filename,
    });

    const baseName = this.getBasename(filename);
    const outputFilename = `${baseName}.${outputFormat}`;

    return {
      data: new Uint8Array(result),
      mimeType: FORMAT_MIME_TYPES[outputFormat],
      filename: outputFilename,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Get the number of pages in a document
   */
  async getPageCount(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions
  ): Promise<number> {
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const inputFormat = options.inputFormat || 'docx';
    return this.sendMessage('getPageCount', { inputData, inputFormat });
  }

  /**
   * Get document information including type and valid output formats
   */
  async getDocumentInfo(
    input: Uint8Array | ArrayBuffer | Buffer,
    options: InputFormatOptions
  ): Promise<DocumentInfo> {
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const inputFormat = options.inputFormat || 'docx';
    return this.sendMessage('getDocumentInfo', { inputData, inputFormat });
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
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const inputFormat = options.inputFormat || 'docx';
    const result = await this.sendMessage('renderPage', {
      inputData,
      inputFormat,
      pageIndex,
      width,
      height,
    });

    const preview = result as RawPreviewData;
    return {
      page: pageIndex,
      data: new Uint8Array(preview.data),
      width: preview.width,
      height: preview.height,
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
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const inputFormat = options.inputFormat || 'docx';
    const rawPreviews = await this.sendMessage('renderPagePreviews', {
      inputData,
      inputFormat,
      width: renderOptions.width || 800,
      height: renderOptions.height || 0,
      pageIndices: renderOptions.pageIndices,
    }) as RawPreviewData[];

    return rawPreviews.map((preview) => ({
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
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const inputFormat = options.inputFormat || 'docx';
    const rawPreview = await this.sendMessage('renderPageFullQuality', {
      inputData,
      inputFormat,
      pageIndex,
      dpi: renderOptions.dpi ?? 150,
      maxDimension: renderOptions.maxDimension,
      editMode: renderOptions.editMode ?? false,
    }) as RawPreviewData & { dpi: number };

    return {
      page: rawPreview.page,
      data: new Uint8Array(rawPreview.data),
      width: rawPreview.width,
      height: rawPreview.height,
      dpi: rawPreview.dpi,
    };
  }

  /**
   * Extract text content from a document
   */
  async getDocumentText(
    input: Uint8Array | ArrayBuffer | Buffer,
    inputFormat: string
  ): Promise<string | null> {
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    return this.sendMessage('getDocumentText', { inputData, inputFormat });
  }

  /**
   * Get page/slide names from a document
   */
  async getPageNames(
    input: Uint8Array | ArrayBuffer | Buffer,
    inputFormat: string
  ): Promise<string[]> {
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    return this.sendMessage('getPageNames', { inputData, inputFormat });
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
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const inputData = this.normalizeInput(input);
    const inputFormat = options.inputFormat || 'docx';
    return this.sendMessage('openDocument', { inputData, inputFormat });
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
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    return this.sendMessage('editorOperation', { sessionId, method, args: args ?? [] });
  }

  /**
   * Close an editor session and get the modified document
   * @param sessionId - The session ID from openDocument
   * @returns The modified document data, or undefined if save failed
   */
  async closeDocument(sessionId: string): Promise<Uint8Array | undefined> {
    if (!this.initialized || !this.worker) {
      throw new ConversionError(
        ConversionErrorCode.WASM_NOT_INITIALIZED,
        'Converter not initialized. Call initialize() first.'
      );
    }

    const result = await this.sendMessage('closeDocument', { sessionId });
    return result ? new Uint8Array(result) : undefined;
  }

  /**
   * Destroy the converter and terminate the worker
   */
  async destroy(): Promise<void> {
    const worker = this.worker;
    if (worker) {
      try {
        await this.sendMessage('destroy');
      } catch {
        // Ignore errors during cleanup
      }
    }

    this.discardWorker(
      new ConversionError(ConversionErrorCode.WASM_NOT_INITIALIZED, 'Converter destroyed'),
      false,
      worker
    );
  }

  /**
   * Check if the converter is ready
   */
  isReady(): boolean {
    return this.initialized && this.worker !== null;
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

  private getExtensionFromFilename(filename: string): string | null {
    const parts = filename.split('.');
    if (parts.length > 1) {
      return parts.pop()?.toLowerCase() || null;
    }
    return null;
  }

  private getBasename(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot > 0) {
      return filename.substring(0, lastDot);
    }
    return filename;
  }
}

/**
 * Create and initialize a worker-based converter
 */
export async function createWorkerConverter(
  options: LibreOfficeWasmOptions = {}
): Promise<WorkerConverter> {
  const converter = new WorkerConverter(options);
  await converter.initialize();
  return converter;
}
