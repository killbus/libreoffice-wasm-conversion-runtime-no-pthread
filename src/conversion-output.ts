import {
  ConversionError,
  ConversionErrorCode,
} from './types.js';
import type { OutputFormat } from './types.js';

interface ConversionOutputFs {
  readFile(path: string): Uint8Array | string;
  readdir(path: string): string[];
  unlink(path: string): void;
}

interface SplitPath {
  directory: string;
  filename: string;
}

export interface CsvConversionTransaction {
  fs: ConversionOutputFs;
  input: SplitPath;
  output: SplitPath;
  siblingPrefix: string;
  existingOutputEntries: ReadonlySet<string>;
}

export class ConversionCleanupUncertaintyError extends ConversionError {
  public readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      ConversionErrorCode.CONVERSION_FAILED,
      `Conversion cleanup uncertainty: ${issues.join('; ')}`
    );
    this.name = 'ConversionCleanupUncertaintyError';
    this.issues = [...issues];
  }
}

function splitPath(path: string): SplitPath {
  const separator = path.lastIndexOf('/');
  if (separator === -1) return { directory: '.', filename: path };
  return {
    directory: path.slice(0, separator) || '/',
    filename: path.slice(separator + 1),
  };
}

function joinPath(directory: string, filename: string): string {
  return directory === '/' ? `/${filename}` : `${directory}/${filename}`;
}

function cleanupFailure(action: string, error: unknown): ConversionCleanupUncertaintyError {
  return new ConversionCleanupUncertaintyError([`${action}: ${String(error)}`]);
}

/**
 * Start a singular CSV transaction by proving that the exact output is absent.
 * A stale exact output is removed and its absence is re-enumerated before native
 * execution. Failure to establish this precondition makes the runtime unsafe to
 * reuse because a later read could accept bytes from an older transaction.
 */
export function beginCsvConversionTransaction(
  fs: ConversionOutputFs,
  inputPath: string,
  outputPath: string,
  outputFormat: OutputFormat
): CsvConversionTransaction | null {
  if (outputFormat !== 'csv') return null;

  const input = splitPath(inputPath);
  const output = splitPath(outputPath);
  let entries: string[];
  try {
    entries = fs.readdir(output.directory);
  } catch (error) {
    throw cleanupFailure(
      `could not enumerate ${output.directory} before CSV conversion`,
      error
    );
  }

  const existingOutputEntries = new Set(entries);
  if (existingOutputEntries.has(output.filename)) {
    try {
      fs.unlink(outputPath);
    } catch (error) {
      throw cleanupFailure(`could not remove stale exact output ${outputPath}`, error);
    }

    let afterRemoval: string[];
    try {
      afterRemoval = fs.readdir(output.directory);
    } catch (error) {
      throw cleanupFailure(
        `could not prove stale exact output ${outputPath} was removed`,
        error
      );
    }
    if (afterRemoval.includes(output.filename)) {
      throw new ConversionCleanupUncertaintyError([
        `stale exact output ${outputPath} survived pre-transaction removal`,
      ]);
    }
  }

  const stem = output.filename.endsWith('.csv')
    ? output.filename.slice(0, -'.csv'.length)
    : output.filename;

  return {
    fs,
    input,
    output,
    siblingPrefix: `${stem}-`,
    existingOutputEntries,
  };
}

function listDirectory(
  fs: ConversionOutputFs,
  directory: string,
  phase: string,
  issues: string[]
): string[] | null {
  try {
    return fs.readdir(directory);
  } catch (error) {
    issues.push(`could not enumerate ${directory} ${phase}: ${String(error)}`);
    return null;
  }
}

function unlinkTrackedPath(
  fs: ConversionOutputFs,
  path: string,
  label: string,
  issues: string[]
): void {
  try {
    fs.unlink(path);
  } catch (error) {
    issues.push(`could not remove ${label} ${path}: ${String(error)}`);
  }
}

/**
 * Finish a CSV transaction and prove all transaction-owned paths are absent.
 * Every enumeration/unlink failure is retained. The caller must quarantine the
 * runtime whenever this function throws.
 */
export function finishCsvConversionTransaction(
  transaction: CsvConversionTransaction
): void {
  const { fs, input, output } = transaction;
  const issues: string[] = [];
  const inputBefore = listDirectory(fs, input.directory, 'during cleanup', issues);
  const outputBefore = listDirectory(fs, output.directory, 'during cleanup', issues);

  if (inputBefore?.includes(input.filename)) {
    unlinkTrackedPath(
      fs,
      joinPath(input.directory, input.filename),
      'transaction input',
      issues
    );
  }

  if (outputBefore?.includes(output.filename)) {
    unlinkTrackedPath(
      fs,
      joinPath(output.directory, output.filename),
      'exact output',
      issues
    );
  }

  for (const entry of outputBefore ?? []) {
    if (
      transaction.existingOutputEntries.has(entry)
      || !entry.startsWith(transaction.siblingPrefix)
      || !entry.endsWith('.csv')
    ) {
      continue;
    }
    unlinkTrackedPath(
      fs,
      joinPath(output.directory, entry),
      'unexpected CSV sibling',
      issues
    );
  }

  const inputAfter = listDirectory(fs, input.directory, 'after cleanup', issues);
  const outputAfter = listDirectory(fs, output.directory, 'after cleanup', issues);

  if (inputAfter?.includes(input.filename)) {
    issues.push(`transaction input ${joinPath(input.directory, input.filename)} survived cleanup`);
  }
  if (outputAfter?.includes(output.filename)) {
    issues.push(`exact output ${joinPath(output.directory, output.filename)} survived cleanup`);
  }
  for (const entry of outputAfter ?? []) {
    if (
      !transaction.existingOutputEntries.has(entry)
      && entry.startsWith(transaction.siblingPrefix)
      && entry.endsWith('.csv')
    ) {
      issues.push(`unexpected CSV sibling ${joinPath(output.directory, entry)} survived cleanup`);
    }
  }

  if (issues.length > 0) {
    throw new ConversionCleanupUncertaintyError(issues);
  }
}

/** Preserve the primary conversion failure while recording cleanup uncertainty. */
export function attachCleanupUncertainty(
  primaryError: unknown,
  cleanupError: ConversionCleanupUncertaintyError
): Error {
  if (!(primaryError instanceof Error)) {
    Object.defineProperty(cleanupError, 'primaryFailure', {
      value: primaryError,
      enumerable: false,
    });
    return cleanupError;
  }

  Object.defineProperty(primaryError, 'cleanupUncertainty', {
    value: cleanupError,
    enumerable: false,
    configurable: true,
  });
  if (primaryError instanceof ConversionError) {
    const details = [primaryError.details, cleanupError.message]
      .filter((value): value is string => Boolean(value))
      .join('; ');
    Object.defineProperty(primaryError, 'details', {
      value: details,
      enumerable: true,
      configurable: true,
    });
  }
  return primaryError;
}

/** Read the one exact artifact promised by the singular conversion API. */
export function readExactConvertedOutput(
  fs: ConversionOutputFs,
  outputPath: string
): Uint8Array {
  let output: Uint8Array | string;
  try {
    output = fs.readFile(outputPath);
  } catch (error) {
    throw new ConversionError(
      ConversionErrorCode.CONVERSION_FAILED,
      `Conversion output contract violation: exact output ${outputPath} is missing`,
      String(error)
    );
  }

  if (!(output instanceof Uint8Array) || output.length === 0) {
    throw new ConversionError(
      ConversionErrorCode.CONVERSION_FAILED,
      `Conversion output contract violation: exact output ${outputPath} is empty`
    );
  }

  return output;
}
