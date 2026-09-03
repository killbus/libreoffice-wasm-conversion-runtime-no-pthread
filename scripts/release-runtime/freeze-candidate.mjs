#!/usr/bin/env node
// Derive a successor frozen spec from an exact downloaded native artifact and
// wrapper build. This hashes files as streams and never instantiates WASM.

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOptions, CliUsageError } from "./lib/cli.mjs";
import {
  deriveCandidateIdentity,
  serializePrettyJson,
} from "./lib/canonical.mjs";
import { validateFrozenSpec } from "./lib/schemata.mjs";

const NATIVE_FILES = new Map([
  ["soffice.cjs", 10_000],
  ["soffice.data", 1_000_000],
  ["soffice.js", 10_000],
  ["soffice.wasm", 1_000_000],
]);
const FONT_PROFILE_QUALIFICATION_FILE = "font-profile-qualification.json";
const FONT_PROFILE_FAULT_QUALIFICATION_FILE =
  "font-profile-fault-qualification.json";
const ALLOWED_NATIVE_FILES = new Set([
  ...NATIVE_FILES.keys(),
  "soffice.data.js.metadata",
  FONT_PROFILE_QUALIFICATION_FILE,
  FONT_PROFILE_FAULT_QUALIFICATION_FILE,
]);

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const QUALIFICATION_RUNTIME_ASSET_NAMES = [
  "browser.js",
  "browser.worker.global.js",
  "soffice.js",
  "soffice.wasm",
  "soffice.data",
];
const QUALIFICATION_SOURCE_FILES = new Map([
  [".github/workflows/build-wasm.yml", ".github/workflows/build-wasm.yml"],
  [
    "tests/browser/font-profile-lifecycle.spec.ts",
    "tests/browser/font-profile-lifecycle.spec.ts",
  ],
  [
    "tests/release-runtime/helpers/font-profile-evidence.ts",
    "tests/release-runtime/helpers/font-profile-evidence.ts",
  ],
  ["src/browser.ts", "src/browser.ts"],
  ["src/browser.worker.ts", "src/browser.worker.ts"],
  ["src/lok-bindings.ts", "src/lok-bindings.ts"],
  [
    "build/patches/wasm-font-removal-primitives.patch",
    "build/patches/wasm-font-removal-primitives.patch",
  ],
  [
    "build/patches/wasm-font-profile-abi.patch",
    "build/patches/wasm-font-profile-abi.patch",
  ],
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const ASSET_LAYOUT = [
  {
    path: "dist/browser.d.ts",
    role: "browserTypes",
    mimeType: "text/plain",
    sourceRoot: "wrapper",
    sourcePath: "dist/browser.d.ts",
  },
  {
    path: "dist/browser.js",
    role: "browserModule",
    mimeType: "text/javascript",
    sourceRoot: "wrapper",
    sourcePath: "dist/browser.js",
  },
  {
    path: "dist/browser.worker.global.js",
    role: "browserWorker",
    mimeType: "text/javascript",
    sourceRoot: "wrapper",
    sourcePath: "dist/browser.worker.global.js",
  },
  {
    path: "wasm/loader.cjs",
    role: "nodeLoader",
    mimeType: "text/javascript",
    sourceRoot: "wrapper",
    sourcePath: "wasm/loader.cjs",
  },
  {
    path: "wasm/soffice.cjs",
    role: "nodeGlue",
    mimeType: "text/javascript",
    sourceRoot: "native",
    sourcePath: "soffice.cjs",
  },
  {
    path: "wasm/soffice.data",
    role: "filesystemData",
    mimeType: "application/octet-stream",
    sourceRoot: "native",
    sourcePath: "soffice.data",
  },
  {
    path: "wasm/soffice.js",
    role: "browserGlue",
    mimeType: "text/javascript",
    sourceRoot: "native",
    sourcePath: "soffice.js",
  },
  {
    path: "wasm/soffice.wasm",
    role: "wasmBinary",
    mimeType: "application/wasm",
    sourceRoot: "native",
    sourcePath: "soffice.wasm",
  },
];

export class FreezeCandidateError extends Error {}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function inspectRegularFile(filePath, label) {
  const fileStat = await lstat(filePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.isSymbolicLink()) {
    throw new FreezeCandidateError(
      `${label} must be a regular file: ${filePath}`,
    );
  }
  return {
    bytes: fileStat.size,
    sha256: await sha256File(filePath),
  };
}

async function readPrefix(filePath, length = 160) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function validateHashBindingMap(actual, expected, label) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new FreezeCandidateError(`${label} must be an object`);
  }
  const actualNames = Object.keys(actual).sort();
  const expectedNames = Object.keys(expected).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new FreezeCandidateError(`${label} file set does not match`);
  }
  for (const name of expectedNames) {
    if (!SHA256_PATTERN.test(actual[name]) || actual[name] !== expected[name]) {
      throw new FreezeCandidateError(`${label} hash mismatch for ${name}`);
    }
  }
}

async function validateQualificationBindings(
  qualification,
  faultQualification,
  assets,
) {
  const runtimeAssetSha256 = Object.fromEntries(
    assets
      .filter((asset) =>
        QUALIFICATION_RUNTIME_ASSET_NAMES.includes(basename(asset.path)),
      )
      .map((asset) => [basename(asset.path), asset.sha256]),
  );
  const qualificationSourceSha256 = Object.fromEntries(
    await Promise.all(
      [...QUALIFICATION_SOURCE_FILES].map(async ([name, sourcePath]) => [
        name,
        await sha256File(join(REPOSITORY_ROOT, sourcePath)),
      ]),
    ),
  );

  for (const [label, evidence] of [
    ["font-profile qualification", qualification],
    ["font-profile fault qualification", faultQualification],
  ]) {
    if (evidence?.browser?.name !== "chromium") {
      throw new FreezeCandidateError(`${label} browser must be chromium`);
    }
    if (
      typeof evidence?.browser?.version !== "string" ||
      evidence.browser.version.length === 0
    ) {
      throw new FreezeCandidateError(`${label} browser version is missing`);
    }
    validateHashBindingMap(
      evidence.runtimeAssetSha256,
      runtimeAssetSha256,
      `${label} runtime assets`,
    );
    validateHashBindingMap(
      evidence.qualificationSourceSha256,
      qualificationSourceSha256,
      `${label} source files`,
    );
  }
}

async function validateNativeRoot(nativeRoot, expected) {
  const entries = await readdir(nativeRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const invalidEntries = entries.filter(
    (entry) => !entry.isFile() || entry.isSymbolicLink(),
  );
  if (invalidEntries.length > 0) {
    throw new FreezeCandidateError(
      `native artifact contains non-regular entries: ${invalidEntries
        .map((entry) => entry.name)
        .sort()
        .join(", ")}`,
    );
  }
  const missing = [...NATIVE_FILES.keys()].filter(
    (name) => !names.includes(name),
  );
  const unexpected = names.filter((name) => !ALLOWED_NATIVE_FILES.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new FreezeCandidateError(
      `native artifact inventory mismatch (missing: ${missing.join(", ") || "none"}; ` +
        `unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }

  for (const [name, minimumBytes] of NATIVE_FILES) {
    const filePath = join(nativeRoot, name);
    const fileStat = await lstat(filePath);
    const prefix = await readPrefix(filePath);
    if (fileStat.size < minimumBytes) {
      throw new FreezeCandidateError(
        `${name} is too small (${fileStat.size} bytes; expected at least ${minimumBytes})`,
      );
    }
    if (prefix.startsWith("version https://git-lfs.github.com/spec/")) {
      throw new FreezeCandidateError(
        `${name} is a Git LFS pointer, not runtime bytes`,
      );
    }
  }

  let qualification;
  try {
    qualification = JSON.parse(
      await readFile(join(nativeRoot, FONT_PROFILE_QUALIFICATION_FILE), "utf8"),
    );
  } catch (cause) {
    throw new FreezeCandidateError(
      `native artifact is missing a valid ${FONT_PROFILE_QUALIFICATION_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (
    qualification?.schemaVersion !== 1 ||
    qualification?.kind !== "libreoffice-wasm-font-profile-qualification" ||
    qualification?.githubActionsRunId !== String(expected.runId) ||
    qualification?.qualificationRunId !== String(expected.runId) ||
    qualification?.nativeBuildRunId !== String(expected.runId) ||
    qualification?.nativeCommit !== expected.nativeCommit ||
    qualification?.wrapperCommit !== expected.wrapperCommit ||
    qualification?.dynamicFontProfiles !== 1 ||
    qualification?.cacheDisabled !== true ||
    qualification?.coreAssetsServedWithNoStore !== true ||
    qualification?.serviceWorkersBypassed !== true ||
    qualification?.profileCycles < 10 ||
    qualification?.stableRuntimeIdentity !== true ||
    qualification?.cleanupDebtFree !== true ||
    qualification?.workerLifecycle?.created !== 1 ||
    qualification?.workerLifecycle?.closedAfterDestroy !== 1 ||
    typeof qualification?.runtimeIdentity?.worker !== "string" ||
    typeof qualification?.runtimeIdentity?.module !== "string" ||
    typeof qualification?.runtimeIdentity?.lok !== "string" ||
    !Number.isFinite(qualification?.wasmHeapBytes?.min) ||
    !Number.isFinite(qualification?.wasmHeapBytes?.max) ||
    !Number.isFinite(qualification?.wasmHeapBytes?.range) ||
    !Number.isFinite(qualification?.wasmHeapBytes?.limit) ||
    qualification.wasmHeapBytes.range > qualification.wasmHeapBytes.limit ||
    !Array.isArray(qualification?.profileFileCounts) ||
    qualification.profileFileCounts.length < qualification.profileCycles * 2 ||
    !qualification.profileFileCounts.every(
      (count, index) => count === (index % 2 === 0 ? 1 : 0),
    ) ||
    ![
      "browser.worker.global.js",
      "soffice.js",
      "soffice.wasm",
      "soffice.data",
    ].every(
      (assetName) => qualification?.browserCoreRequestCounts?.[assetName] === 1,
    ) ||
    ![
      "browser.worker.global.js",
      "soffice.js",
      "soffice.wasm",
      "soffice.data",
    ].every(
      (assetName) => qualification?.serverCoreRequestCounts?.[assetName] === 1,
    ) ||
    !["defaultBefore", "cjkFirst", "cjkLast", "defaultAfter"].every(
      (key) => qualification?.conversionBytes?.[key] > 0,
    ) ||
    qualification?.sameFamilyReplacement?.verified !== true ||
    typeof qualification?.sameFamilyReplacement?.familyStyle !== "string" ||
    qualification.sameFamilyReplacement.familyStyle.length === 0 ||
    qualification?.sameFamilyReplacement?.fontSha256?.length !== 2 ||
    qualification.sameFamilyReplacement.fontSha256[0] ===
      qualification.sameFamilyReplacement.fontSha256[1] ||
    qualification?.sameFamilyReplacement?.rasterSha256?.length !== 3 ||
    qualification.sameFamilyReplacement.rasterSha256[0] !==
      qualification.sameFamilyReplacement.rasterSha256[2] ||
    qualification.sameFamilyReplacement.rasterSha256[0] ===
      qualification.sameFamilyReplacement.rasterSha256[1]
  ) {
    throw new FreezeCandidateError(
      "native font-profile qualification evidence is invalid",
    );
  }

  let faultQualification;
  try {
    faultQualification = JSON.parse(
      await readFile(
        join(nativeRoot, FONT_PROFILE_FAULT_QUALIFICATION_FILE),
        "utf8",
      ),
    );
  } catch (cause) {
    throw new FreezeCandidateError(
      `native artifact is missing a valid ${FONT_PROFILE_FAULT_QUALIFICATION_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (
    faultQualification?.schemaVersion !== 1 ||
    faultQualification?.kind !==
      "libreoffice-wasm-font-profile-fault-qualification" ||
    faultQualification?.githubActionsRunId !== String(expected.runId) ||
    faultQualification?.qualificationRunId !== String(expected.runId) ||
    faultQualification?.nativeBuildRunId !== String(expected.runId) ||
    faultQualification?.nativeCommit !== expected.nativeCommit ||
    faultQualification?.wrapperCommit !== expected.wrapperCommit ||
    faultQualification?.fault !== "malformed-sfnt-after-valid-profile" ||
    faultQualification?.mutationAttempted !== true ||
    faultQualification?.mutationCommitted !== false ||
    faultQualification?.stateKnown !== false ||
    faultQualification?.runtimeReusable !== false ||
    faultQualification?.quarantine !== true ||
    faultQualification?.workerLifecycle?.created !== 1 ||
    faultQualification?.workerLifecycle?.closedAfterQuarantine !== 1 ||
    ![
      "browser.worker.global.js",
      "soffice.js",
      "soffice.wasm",
      "soffice.data",
    ].every(
      (assetName) =>
        faultQualification?.serverCoreRequestCounts?.[assetName] === 1,
    )
  ) {
    throw new FreezeCandidateError(
      "native font-profile fault evidence is invalid",
    );
  }
  return { qualification, faultQualification };
}

export async function freezeCandidate(options) {
  const nativeRoot = resolve(options.nativeRoot);
  const wrapperRoot = resolve(options.wrapperRoot);
  const nativeArchive = resolve(options.nativeArchive);
  const expectedArchiveName = `soffice-wasm-no-pthread-${options.runId}.zip`;
  if (basename(nativeArchive) !== expectedArchiveName) {
    throw new FreezeCandidateError(
      `native archive must be named ${expectedArchiveName}`,
    );
  }

  const qualificationEvidence = await validateNativeRoot(nativeRoot, {
    runId: options.runId,
    nativeCommit: options.nativeCommit,
    wrapperCommit: options.wrapperCommit,
  });
  const archive = await inspectRegularFile(nativeArchive, "native archive");
  const assets = [];
  for (const layout of ASSET_LAYOUT) {
    const root = layout.sourceRoot === "native" ? nativeRoot : wrapperRoot;
    const inspected = await inspectRegularFile(
      join(root, layout.sourcePath),
      `${layout.role} (${layout.path})`,
    );
    assets.push({ ...layout, ...inspected });
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  await validateQualificationBindings(
    qualificationEvidence.qualification,
    qualificationEvidence.faultQualification,
    assets,
  );

  const provenance = {
    native: {
      commit: options.nativeCommit,
      githubActionsRunId: String(options.runId),
      abi: "lok-convert-document-font-profile-v1",
      schemaVersion: 1,
    },
    wrapper: { commit: options.wrapperCommit },
  };
  const runtime = {
    threading: "none",
    capabilities: { dynamicFontProfiles: 1 },
  };
  const candidateId = deriveCandidateIdentity({ provenance, runtime, assets });
  return validateFrozenSpec({
    schemaVersion: 1,
    kind: "libreoffice-wasm-runtime-frozen-spec",
    candidateId,
    provenance,
    runtime,
    originalNativeArchive: {
      name: expectedArchiveName,
      bytes: archive.bytes,
      sha256: archive.sha256,
    },
    assets,
    controlFiles: ["CANDIDATE-MANIFEST.json", "ASSET-SHA256SUMS"],
    expectedPayloadArchiveName: `libreoffice-wasm-runtime-${candidateId}.zip`,
  });
}

const USAGE = `Usage:
  node ${basename(fileURLToPath(import.meta.url))} \\
    --native-root <extracted-artifact-dir> \\
    --wrapper-root <wrapper-build-dir> \\
    --native-archive <downloaded-artifact.zip> \\
    --native-commit <40-char-sha> \\
    --wrapper-commit <40-char-sha> \\
    --run-id <github-actions-run-id> \\
    --out <candidate-spec.json>`;
const FLAGS = new Set([
  "native-root",
  "wrapper-root",
  "native-archive",
  "native-commit",
  "wrapper-commit",
  "run-id",
  "out",
]);

async function main(argv) {
  const args = parseOptions(argv, FLAGS, USAGE);
  const spec = await freezeCandidate({
    nativeRoot: args["native-root"],
    wrapperRoot: args["wrapper-root"],
    nativeArchive: args["native-archive"],
    nativeCommit: args["native-commit"],
    wrapperCommit: args["wrapper-commit"],
    runId: args["run-id"],
  });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(resolve(args.out), serializePrettyJson(spec), {
    encoding: "utf8",
    flag: "wx",
  });
  process.stdout.write(
    serializePrettyJson({
      candidateId: spec.candidateId,
      specPath: resolve(args.out),
      nativeArchiveSha256: spec.originalNativeArchive.sha256,
      assets: spec.assets.map(({ path, bytes, sha256 }) => ({
        path,
        bytes,
        sha256,
      })),
    }),
  );
}

const isCli =
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isCli) {
  if (process.argv.slice(2).includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof CliUsageError) {
      console.log(error.message);
    } else {
      console.error(
        `[freeze-candidate] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    process.exitCode = 1;
  });
}
