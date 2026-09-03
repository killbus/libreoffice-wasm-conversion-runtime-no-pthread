// Canonical JSON and candidate-identity derivation.
//
// The identity serialization reproduces the original validating derivation
// exactly (see constants.mjs), so it can be cross-checked against the frozen
// candidate ID in research/artifact-provenance.md.

import { createHash } from 'node:crypto'
import {
  CANDIDATE_IDENTITY_KIND,
  CANDIDATE_IDENTITY_SCHEMA_VERSION,
} from './constants.mjs'

// Serialize an object canonically: UTF-8, no BOM, LF line endings, stable key
// order (insertion order is fixed because every builder in this pipeline
// constructs objects with a fixed key sequence), and no absolute paths /
// timestamps in identity material. Identity and classified-record bytes are
// written with JSON.stringify(value, null, 2) + "\n" so human readers can
// diff them; the *candidate identity digest* uses the compact JSON.stringify
// form exactly as the original derivation did.
export function serializePrettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function serializeCompactJson(value) {
  return JSON.stringify(value)
}

// Mirrors deriveLibreOfficeCandidateId() from the original validating
// pipeline: sha256( JSON.stringify({ schemaVersion, kind, provenance, runtime,
// assets }) ) with assets mapped to identity fields and sorted by path.
export function deriveCandidateIdentity(input) {
  const identity = {
    schemaVersion: CANDIDATE_IDENTITY_SCHEMA_VERSION,
    kind: CANDIDATE_IDENTITY_KIND,
    provenance: {
      native: {
        commit: input.provenance.native.commit,
        githubActionsRunId: input.provenance.native.githubActionsRunId,
        abi: input.provenance.native.abi,
        schemaVersion: input.provenance.native.schemaVersion,
      },
      wrapper: {
        commit: input.provenance.wrapper.commit,
      },
    },
    runtime: {
      threading: input.runtime.threading,
      ...(input.runtime.capabilities
        ? { capabilities: input.runtime.capabilities }
        : {}),
    },
    assets: input.assets
      .map(({ path, role, mimeType, bytes, sha256 }) => ({
        path,
        role,
        mimeType,
        bytes,
        sha256,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
  return createHash('sha256').update(serializeCompactJson(identity)).digest('hex')
}