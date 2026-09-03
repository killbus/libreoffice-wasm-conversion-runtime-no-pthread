// Lightweight schema validators for the runtime publication control records.
//
// Distinct records have distinct kinds (design.md §4):
//   - frozen candidate spec          -> libreoffice-wasm-runtime-frozen-spec
//   - candidate manifest             -> pdfhow-libreoffice-runtime-candidate
//                                      (byte-identical identity contract)
//   - staging/handoff report         -> ...staging-report
//   - acceptance receipt             -> ...acceptance-receipt
//   - qualified release manifest     -> ...release-manifest
//
// Release qualification is a distinct fact from candidate identity
// (prd.md R2.7): `releaseQualified: true` is valid ONLY in a release manifest.

import {
  CANDIDATE_IDENTITY_KIND,
  CANDIDATE_IDENTITY_SCHEMA_VERSION,
  CONTROL_SCHEMA_VERSION,
  RELEASE_MANIFEST_KIND,
  ACCEPTANCE_RECEIPT_KIND,
  STAGING_REPORT_KIND,
  isForbiddenWorkerPath,
} from "./constants.mjs";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/;
const ABI_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const REQUIRED_ACCEPTANCE_GATES = Object.freeze([
  "archive-verification",
  "node-smoke",
  "browser-worker-no-pthread",
  "font-profile-lifecycle",
  "font-profile-fault-quarantine",
  "pdfhow-product-integration",
]);

const ASSET_ROLES = new Set([
  "browserModule",
  "browserTypes",
  "browserWorker",
  "nodeLoader",
  "nodeGlue",
  "browserGlue",
  "wasmBinary",
  "filesystemData",
  "controlFile",
  "payloadArchive",
  "stagingReport",
]);

export class SchemaError extends Error {}

function expectString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new SchemaError(`${label} must be a non-empty string`);
  }
  return value;
}

function expectPositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new SchemaError(`${label} must be a positive integer`);
  }
  return normalized;
}

function expectCommit(value, label) {
  const normalized = expectString(value, label);
  if (!COMMIT_PATTERN.test(normalized)) {
    throw new SchemaError(
      `${label} must be an exact 40-character hex Git commit`,
    );
  }
  return normalized.toLowerCase();
}

function expectSha256(value, label) {
  const normalized = expectString(value, label);
  if (!SHA256_PATTERN.test(normalized)) {
    throw new SchemaError(`${label} must be a 64-character hex SHA-256`);
  }
  return normalized.toLowerCase();
}

function expectRunId(value) {
  const normalized = String(value ?? "");
  if (!RUN_ID_PATTERN.test(normalized)) {
    throw new SchemaError(
      "GitHub Actions run ID must contain only decimal digits",
    );
  }
  return normalized;
}

function expectAbi(value) {
  const normalized = expectString(value, "native ABI");
  if (!ABI_PATTERN.test(normalized)) {
    throw new SchemaError(
      "native ABI must be a non-empty lowercase identifier",
    );
  }
  return normalized;
}

export function normalizeProvenance(provenance) {
  const native = provenance?.native;
  const wrapper = provenance?.wrapper;
  if (!native || !wrapper) {
    throw new SchemaError(
      "provenance.native and provenance.wrapper are required",
    );
  }
  const nativeSchemaVersion =
    provenance.native.schemaVersion === undefined
      ? CANDIDATE_IDENTITY_SCHEMA_VERSION
      : expectPositiveInteger(native.schemaVersion, "native schemaVersion");
  return {
    native: {
      commit: expectCommit(native.commit, "native commit"),
      githubActionsRunId: expectRunId(native.githubActionsRunId),
      abi: expectAbi(native.abi),
      schemaVersion: nativeSchemaVersion,
    },
    wrapper: {
      commit: expectCommit(wrapper.commit, "wrapper commit"),
    },
  };
}

export function normalizeRuntime(runtime) {
  const threading = expectString(runtime?.threading, "runtime threading");
  if (threading !== "none") {
    throw new SchemaError("runtime threading must be none");
  }
  if ("pthreadWorkerMode" in runtime || "externalWorker" in runtime) {
    throw new SchemaError("legacy pthread runtime metadata is not accepted");
  }

  const capabilities = runtime?.capabilities;
  if (capabilities === undefined) return { threading };
  if (
    !capabilities ||
    typeof capabilities !== "object" ||
    Array.isArray(capabilities)
  ) {
    throw new SchemaError("runtime capabilities must be an object");
  }
  const capabilityNames = Object.keys(capabilities);
  if (
    capabilityNames.length !== 1 ||
    capabilityNames[0] !== "dynamicFontProfiles" ||
    capabilities.dynamicFontProfiles !== 1
  ) {
    throw new SchemaError(
      "runtime capabilities must declare dynamicFontProfiles: 1 only",
    );
  }
  return { threading, capabilities: { dynamicFontProfiles: 1 } };
}

export function expectAsset(asset, { requireSource = true } = {}) {
  const path = expectString(asset?.path, "asset path");
  const role = expectString(asset?.role, `asset role for ${path}`);
  if (!ASSET_ROLES.has(role)) {
    throw new SchemaError(`unknown asset role '${role}' for ${path}`);
  }
  const mimeType = expectString(asset?.mimeType, `asset mimeType for ${path}`);
  const bytes = expectPositiveInteger(asset?.bytes, `asset bytes for ${path}`);
  const sha256 = expectSha256(asset?.sha256, `asset sha256 for ${path}`);
  if (role !== "controlFile" && path.includes("\\")) {
    throw new SchemaError(`asset path must use forward slashes: ${path}`);
  }
  if (role !== "controlFile" && path.startsWith("/")) {
    throw new SchemaError(`asset path must be relative: ${path}`);
  }
  if (path.split("/").includes("..")) {
    throw new SchemaError(`asset path must not traverse: ${path}`);
  }
  const normalized = { path, role, mimeType, bytes, sha256 };
  if (requireSource) {
    const sourceRoot = expectString(
      asset?.sourceRoot,
      `sourceRoot for ${path}`,
    );
    if (sourceRoot !== "native" && sourceRoot !== "wrapper") {
      throw new SchemaError(`unknown sourceRoot '${sourceRoot}' for ${path}`);
    }
    const sourcePath = expectString(
      asset?.sourcePath,
      `sourcePath for ${path}`,
    );
    normalized.sourceRoot = sourceRoot;
    normalized.sourcePath = sourcePath;
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Frozen candidate spec
// ---------------------------------------------------------------------------

export function validateFrozenSpec(value) {
  if (value?.kind !== "libreoffice-wasm-runtime-frozen-spec") {
    throw new SchemaError(
      `frozen spec kind must be libreoffice-wasm-runtime-frozen-spec`,
    );
  }
  if (value.schemaVersion !== CONTROL_SCHEMA_VERSION) {
    throw new SchemaError(
      `frozen spec schemaVersion must be ${CONTROL_SCHEMA_VERSION}`,
    );
  }
  const candidateId = expectSha256(
    value.candidateId,
    "frozen spec candidateId",
  );
  const provenance = normalizeProvenance(value.provenance);
  const runtime = normalizeRuntime(value.runtime);
  const originalNativeArchive = value.originalNativeArchive;
  if (
    !originalNativeArchive ||
    typeof originalNativeArchive.name !== "string" ||
    originalNativeArchive.name.length === 0
  ) {
    throw new SchemaError("originalNativeArchive.name is required");
  }
  const originalNativeArchiveBytes = expectPositiveInteger(
    originalNativeArchive.bytes,
    "originalNativeArchive.bytes",
  );
  const originalNativeArchiveSha256 = expectSha256(
    originalNativeArchive.sha256,
    "originalNativeArchive.sha256",
  );

  const assets = [];
  const seenPaths = new Set();
  if (!Array.isArray(value.assets) || value.assets.length !== 8) {
    throw new SchemaError(
      "frozen spec must declare exactly eight runtime assets",
    );
  }
  for (const asset of value.assets) {
    const normalized = expectAsset(asset, { requireSource: true });
    if (seenPaths.has(normalized.path)) {
      throw new SchemaError(`duplicate asset path ${normalized.path}`);
    }
    seenPaths.add(normalized.path);
    assets.push(normalized);
  }
  if (assets.some((asset) => isForbiddenWorkerPath(asset.path))) {
    throw new SchemaError("frozen spec must not contain soffice.worker.js");
  }

  const controlFiles = value.controlFiles ?? [];
  if (
    !Array.isArray(controlFiles) ||
    controlFiles.some((name) => typeof name !== "string" || name.length === 0)
  ) {
    throw new SchemaError("controlFiles must be a list of non-empty names");
  }

  const expectedPayloadArchiveName = expectString(
    value.expectedPayloadArchiveName,
    "expectedPayloadArchiveName",
  );

  return {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    candidateId,
    provenance,
    runtime,
    originalNativeArchive: {
      name: originalNativeArchive.name,
      bytes: originalNativeArchiveBytes,
      sha256: originalNativeArchiveSha256,
    },
    assets,
    controlFiles,
    expectedPayloadArchiveName,
  };
}

// ---------------------------------------------------------------------------
// Candidate manifest
// ---------------------------------------------------------------------------

export function validateCandidateManifest(value) {
  if (
    value?.kind !== CANDIDATE_IDENTITY_KIND ||
    value.schemaVersion !== CANDIDATE_IDENTITY_SCHEMA_VERSION
  ) {
    throw new SchemaError(`candidate manifest kind/schema mismatch'`);
  }
  if (value.releaseQualified !== false) {
    throw new SchemaError("candidate manifest releaseQualified must be false");
  }
  if (
    "timestamp" in value ||
    (typeof value.sources === "object" && value.sources !== null)
  ) {
    throw new SchemaError(
      "candidate manifest must not carry timestamps or developer source paths",
    );
  }
  if (value.integrity?.qualification === true) {
    throw new SchemaError("candidate manifest must not claim qualification");
  }
  const candidateId = expectSha256(value.candidateId, "candidate manifest id");
  const provenance = normalizeProvenance(value.provenance);
  const runtime = normalizeRuntime(value.runtime);
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    throw new SchemaError("candidate manifest must list its assets");
  }
  const assets = value.assets.map((asset) =>
    expectAsset(asset, { requireSource: false }),
  );
  if (assets.some((asset) => isForbiddenWorkerPath(asset.path))) {
    throw new SchemaError(
      "candidate manifest must not contain soffice.worker.js",
    );
  }
  return { candidateId, provenance, runtime, assets };
}

// ---------------------------------------------------------------------------
// Control records
// ---------------------------------------------------------------------------

function expectControlRecordHead(value, expectedKind, label) {
  if (value?.kind !== expectedKind) {
    throw new SchemaError(`${label} kind must be ${expectedKind}`);
  }
  if (value.schemaVersion !== CONTROL_SCHEMA_VERSION) {
    throw new SchemaError(
      `${label} schemaVersion must be ${CONTROL_SCHEMA_VERSION}`,
    );
  }
}

export function validateStagingReport(value) {
  expectControlRecordHead(value, STAGING_REPORT_KIND, "staging report");
  for (const field of ["tagName", "targetCommit", "releaseId", "releaseUrl"]) {
    expectString(value[field], `staging report ${field}`);
  }
  expectCommit(value.targetCommit, "staging report targetCommit");
  expectSha256(value.candidateId, "staging report candidateId");
  expectSha256(value.payloadArchiveSha256, "staging report archive sha256");
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    throw new SchemaError("staging report must list release assets");
  }
  for (const asset of value.assets) {
    expectString(asset?.name, "staging report asset name");
    expectString(asset?.uploadUrl, "staging report asset uploadUrl");
    expectSha256(asset?.sha256, `staging report sha256 for ${asset?.name}`);
  }
  if (
    value.releaseQualified !== undefined &&
    value.releaseQualified !== false
  ) {
    throw new SchemaError("staging report must not claim qualification");
  }
  return value;
}

export function validateAcceptanceReceipt(value) {
  expectControlRecordHead(value, ACCEPTANCE_RECEIPT_KIND, "acceptance receipt");
  if (value.decision !== "accepted" && value.decision !== "rejected") {
    throw new SchemaError(
      "acceptance receipt decision must be accepted/rejected",
    );
  }
  expectSha256(value.candidateId, "receipt candidateId");
  expectSha256(value.payloadArchiveSha256, "receipt payload archive sha256");
  expectString(value.releaseId, "receipt releaseId");
  expectString(value.releaseUrl, "receipt releaseUrl");
  expectString(value.tagName, "receipt tagName");
  expectCommit(value.targetCommit, "receipt targetCommit");
  expectString(value.verifierVersion, "receipt verifierVersion");
  expectString(value.acceptanceOwner, "receipt acceptanceOwner");
  expectString(value.generatedAt, "receipt generatedAt");
  if (!Array.isArray(value.gateResults) || value.gateResults.length === 0) {
    throw new SchemaError("receipt gateResults must be a non-empty list");
  }
  const gateNames = new Set();
  for (const [index, gate] of value.gateResults.entries()) {
    const name = expectString(gate?.name, `receipt gateResults[${index}].name`);
    if (gateNames.has(name)) {
      throw new SchemaError(
        `receipt gateResults contains duplicate gate ${name}`,
      );
    }
    gateNames.add(name);
    if (gate?.status !== "passed" && gate?.status !== "failed") {
      throw new SchemaError(
        `receipt gateResults[${index}].status must be passed/failed`,
      );
    }
  }
  if (value.decision === "accepted") {
    const missingGates = REQUIRED_ACCEPTANCE_GATES.filter(
      (gateName) => !gateNames.has(gateName),
    );
    if (missingGates.length > 0) {
      throw new SchemaError(
        `accepted receipt is missing required gates: ${missingGates.join(", ")}`,
      );
    }
    const failedGates = value.gateResults
      .filter((gate) => gate.status !== "passed")
      .map((gate) => gate.name);
    if (failedGates.length > 0) {
      throw new SchemaError(
        `accepted receipt contains non-passing gates: ${failedGates.join(", ")}`,
      );
    }
  }
  return value;
}

// A release manifest is the ONLY record where releaseQualified: true is valid.
export function validateReleaseManifest(value) {
  expectControlRecordHead(value, RELEASE_MANIFEST_KIND, "release manifest");
  if (value.releaseQualified !== true) {
    throw new SchemaError("release manifest requires releaseQualified: true");
  }
  expectSha256(value.candidateId, "release manifest candidateId");
  expectSha256(value.payloadArchiveSha256, "release manifest archive sha256");
  expectSha256(
    value.candidateManifestSha256,
    "release manifest candidate hash",
  );
  expectSha256(value.acceptanceReceiptSha256, "release manifest receipt hash");
  expectString(value.releaseId, "release manifest releaseId");
  expectCommit(value.targetCommit, "release manifest targetCommit");
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    throw new SchemaError("release manifest must list final assets");
  }
  for (const asset of value.assets) {
    expectString(asset?.name, "release manifest asset name");
    expectSha256(asset?.sha256, `release manifest sha256 for ${asset?.name}`);
  }
  return value;
}

export function assertNotQualified(record, label) {
  if (record?.releaseQualified === true) {
    throw new SchemaError(`${label} must not claim releaseQualified: true`);
  }
}
