// Tiny dependency-free CLI option parser shared by the release-runtime CLIs.
//
// Every non-boolean option is `--name <value>` (a value is mandatory for those).
// Boolean options (`--dry-run`) take no value; their presence is recorded as
// `true`. Options may be declared optional; an absent optional option simply
// stays `undefined` (callers fall back to documented defaults). Anything else
// (unknown flag, missing required option, missing value, duplicate) throws a
// CliUsageError with the usage text.

export function parseOptions(args, flags, usage, options = {}) {
  if (args.length === 1 && args[0] === '--help') {
    throw new CliUsageError(usage)
  }
  const optional = new Set(options.optional ?? [])
  const bool = new Set(options.bool ?? [])

  const values = {}
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!flag?.startsWith('--')) {
      throw new CliUsageError(`Every option must be a --flag\n\n${usage}`)
    }
    const name = flag.slice(2)
    if (!flags.has(name)) {
      throw new CliUsageError(`Unknown option: ${flag}\n\n${usage}`)
    }
    if (values[name] !== undefined) {
      throw new CliUsageError(`Duplicate option: ${flag}`)
    }
    if (bool.has(name)) {
      values[name] = true
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new CliUsageError(`Option requires a value: ${flag}\n\n${usage}`)
    }
    values[name] = value
    index += 1
  }

  for (const flag of flags) {
    if (values[flag] === undefined && !optional.has(flag)) {
      throw new CliUsageError(`Missing required option: --${flag}\n\n${usage}`)
    }
  }
  return values
}

export class CliUsageError extends Error {}