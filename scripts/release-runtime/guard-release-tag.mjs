#!/usr/bin/env node
// guard-release-tag.mjs — fail-closed strict release-tag gate for the
// semantic-package workflows (pages.yml, font-bundles.yml).
//
// GitHub Actions `if:` expressions cannot express a regex, so the job-level
// structural gate is reinforced by this step: the exact decision oracle in
// lib/workflow-decision.mjs is evaluated against the actual event/tag and the
// job fails (exit 1) for anything the oracle denies. A `runtime-artifact-*`
// tag is already skipped at the job gate; any tag that a structural `if:`
// allows but the strict oracle denies (e.g. `vfoo.bar`, `v1.x`) is stopped
// here, before any build / deploy / `--clobber` upload side effect runs.
//
// Usage:
//   node scripts/release-runtime/guard-release-tag.mjs <event_name> <tag>
//
// Exit 0 = the release may run semantic-package jobs.
// Exit 1 = the release must not run them (job fails closed).

import {
  shouldRunSemanticPackageJobs,
} from './lib/workflow-decision.mjs'

const [eventName = '', tag = ''] = process.argv.slice(2)

const allowed = shouldRunSemanticPackageJobs({ eventName, tag })

if (!allowed) {
  process.stderr.write(
    `[guard-release-tag] denied: event=${eventName} tag=${JSON.stringify(tag)}\n` +
      `  Strict semantic-version release tags are v<major>.<minor>.<patch>\n` +
      `  (optionally with -prerelease or +build). The 'runtime' namespace is\n` +
      `  reserved for runtime artifacts and may not reach semantic-package jobs.\n`
  )
  process.exit(1)
}

process.stdout.write(
  `[guard-release-tag] allowed: event=${eventName} tag=${JSON.stringify(tag)}\n`
)
process.exit(0)