// Tiny dependency-free CLI option parser shared by the release-runtime CLIs.

export function parseOptions(args, flags, usage) {
  if (args.length === 1 && args[0] === '--help') {
    throw new CliUsageError(usage)
  }
  const values = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new CliUsageError(`Every option requires a value\n\n${usage}`)
    }
    const name = flag.slice(2)
    if (!flags.has(name)) {
      throw new CliUsageError(`Unknown option: ${flag}\n\n${usage}`)
    }
    if (values[name] !== undefined) {
      throw new CliUsageError(`Duplicate option: ${flag}`)
    }
    values[name] = value
  }
  for (const flag of flags) {
    if (values[flag] === undefined) {
      throw new CliUsageError(`Missing required option: --${flag}\n\n${usage}`)
    }
  }
  return values
}

export class CliUsageError extends Error {}