/** Shared startup policy for every Emscripten module-loading entry point. */
export interface EmscriptenStartupPolicy {
  noInitialRun: true;
}

export const EMSCRIPTEN_STARTUP_POLICY: Readonly<EmscriptenStartupPolicy> =
  Object.freeze({ noInitialRun: true });

export type EmscriptenStartupConfig<T extends object> =
  Omit<T, keyof EmscriptenStartupPolicy> &
  EmscriptenStartupPolicy &
  Record<string, unknown>;

/** Apply the invariant last so callers cannot accidentally re-enable main(). */
export function withEmscriptenStartupPolicy<T extends object>(
  config: T
): EmscriptenStartupConfig<T> {
  return {
    ...config,
    ...EMSCRIPTEN_STARTUP_POLICY,
  } as EmscriptenStartupConfig<T>;
}
