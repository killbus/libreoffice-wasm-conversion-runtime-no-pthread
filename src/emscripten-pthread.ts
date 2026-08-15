interface TerminableWorker {
  terminate?: () => void;
}

interface ExportedPThreadRuntime {
  terminateAllThreads?: () => void;
  runningWorkers?: TerminableWorker[];
  unusedWorkers?: TerminableWorker[];
}

interface EmscriptenRuntimeWithOptionalPThread {
  PThread?: ExportedPThreadRuntime;
}

/**
 * Best-effort pthread cleanup for Emscripten runtimes.
 *
 * Emscripten installs throwing accessors for runtime methods that were not
 * included in EXPORTED_RUNTIME_METHODS. Reading Module.PThread can therefore
 * throw before optional chaining gets a chance to handle an absent export.
 */
export function terminateExportedPThreads(target: unknown): void {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) return;

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, 'PThread');
  } catch {
    return;
  }
  if (descriptor?.get && !('value' in descriptor)) return;

  let pthread: ExportedPThreadRuntime | undefined;
  try {
    pthread = (target as EmscriptenRuntimeWithOptionalPThread).PThread;
  } catch {
    return;
  }
  if (!pthread) return;

  try {
    pthread.terminateAllThreads?.();
  } catch {
    // Fall through to terminating any exported worker collections directly.
  }

  for (const key of ['runningWorkers', 'unusedWorkers'] as const) {
    let workers: TerminableWorker[] | undefined;
    try {
      workers = pthread[key];
    } catch {
      continue;
    }
    for (const worker of workers ?? []) {
      try { worker.terminate?.(); } catch { /* continue best-effort cleanup */ }
    }
    if (workers) {
      try { pthread[key] = []; } catch { /* collection may be read-only */ }
    }
  }
}
