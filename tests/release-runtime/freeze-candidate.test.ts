import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FreezeCandidateError,
  freezeCandidate,
} from "../../scripts/release-runtime/freeze-candidate.mjs";
import { deriveCandidateIdentity } from "../../scripts/release-runtime/lib/canonical.mjs";
import { createDeterministicZip } from "../../scripts/release-runtime/lib/zip-writer.mjs";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const RUN_ID = "32146386224";
const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const qualificationSourcePaths = [
  ".github/workflows/build-wasm.yml",
  "build/autogen.input",
  "build/build-wasm.sh",
  "build/patch-stack.sh",
  "dev-server.mjs",
  "package-lock.json",
  "playwright.config.ts",
  "scripts/inspect-no-pthread-runtime.mjs",
  "tests/browser/font-profile-lifecycle.spec.ts",
  "tests/release-runtime/helpers/font-profile-evidence.ts",
  "src/browser.ts",
  "src/browser.worker.ts",
  "src/lok-bindings.ts",
  "src/types.ts",
  "build/patches/wasm-font-removal-primitives.patch",
  "build/patches/wasm-font-profile-abi.patch",
  "build/patches/wasm-font-profile-diagnostics.patch",
];

async function sha256File(filePath: string) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function hashFileMap(files: Record<string, string>) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, filePath]) => [
        name,
        await sha256File(filePath),
      ]),
    ),
  );
}

async function sparseFile(path: string, bytes: number) {
  await writeFile(path, Buffer.from([1]));
  await truncate(path, bytes);
}

function nativeRegistrySnapshot(
  active: boolean,
  freetypeFontFileRecords: number,
) {
  return {
    activeFontCount: active ? 1 : 0,
    activeFontBytes: active ? 1024 : 0,
    registryCountsAvailable: true,
    printFontManagerRecords: active ? 1 : 0,
    fontconfigApplicationPatterns: active ? 1 : 0,
    freetypeFontInfoRecords: active ? 1 : 0,
    freetypeFontFileRecords,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "freeze-candidate-"));
  const nativeRoot = join(root, "native");
  const wrapperRoot = join(root, "wrapper");
  await mkdir(nativeRoot);
  await mkdir(join(wrapperRoot, "dist"), { recursive: true });
  await mkdir(join(wrapperRoot, "wasm"), { recursive: true });
  await sparseFile(join(nativeRoot, "soffice.cjs"), 10_001);
  await sparseFile(join(nativeRoot, "soffice.data"), 1_000_001);
  await sparseFile(join(nativeRoot, "soffice.js"), 10_001);
  await sparseFile(join(nativeRoot, "soffice.wasm"), 1_000_001);
  await writeFile(join(nativeRoot, "soffice.data.js.metadata"), "{}");
  await writeFile(join(wrapperRoot, "dist/browser.d.ts"), "export {}\n");
  await writeFile(join(wrapperRoot, "dist/browser.js"), "export {}\n");
  await writeFile(
    join(wrapperRoot, "dist/browser.worker.global.js"),
    "self.x=1\n",
  );
  await writeFile(join(wrapperRoot, "wasm/loader.cjs"), "module.exports={}\n");

  const environment = {
    browser: { name: "chromium", version: "123.0.0.0" },
    runtimeAssetSha256: await hashFileMap({
      "browser.js": join(wrapperRoot, "dist/browser.js"),
      "browser.worker.global.js": join(
        wrapperRoot,
        "dist/browser.worker.global.js",
      ),
      "soffice.js": join(nativeRoot, "soffice.js"),
      "soffice.wasm": join(nativeRoot, "soffice.wasm"),
      "soffice.data": join(nativeRoot, "soffice.data"),
    }),
    qualificationSourceSha256: await hashFileMap(
      Object.fromEntries(
        qualificationSourcePaths.map((sourcePath) => [
          sourcePath,
          join(repositoryRoot, sourcePath),
        ]),
      ),
    ),
  };

  await writeFile(
    join(nativeRoot, "font-profile-qualification.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "libreoffice-wasm-font-profile-qualification",
      githubActionsRunId: RUN_ID,
      qualificationRunId: RUN_ID,
      nativeBuildRunId: RUN_ID,
      nativeCommit: COMMIT_A,
      wrapperCommit: COMMIT_B,
      ...environment,
      dynamicFontProfiles: 1,
      buildMode: "fresh-clean",
      cacheDisabled: true,
      coreAssetsServedWithNoStore: true,
      serviceWorkersBypassed: true,
      profileCycles: 10,
      browserCoreRequestCounts: {
        "browser.worker.global.js": 1,
        "soffice.js": 1,
        "soffice.wasm": 1,
        "soffice.data": 1,
      },
      serverCoreRequestCounts: {
        "browser.worker.global.js": 1,
        "soffice.js": 1,
        "soffice.wasm": 1,
        "soffice.data": 1,
      },
      workerLifecycle: { created: 1, closedAfterDestroy: 1 },
      runtimeIdentity: {
        worker: "worker:1",
        module: "worker:1:module:1",
        lok: "worker:1:module:1:lok:1:ptr:4096",
      },
      runtimeIdentities: Array.from({ length: 24 }, () => ({
        worker: "worker:1",
        module: "worker:1:module:1",
        lok: "worker:1:module:1:lok:1:ptr:4096",
      })),
      stableRuntimeIdentity: true,
      cleanupDebtFree: true,
      profileFileCounts: Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0 ? 1 : 0,
      ),
      nativeRegistryDiagnostics: {
        maxRetainedFontFiles: 3,
        transitions: [
          ...Array.from({ length: 20 }, (_, index) =>
            nativeRegistrySnapshot(index % 2 === 0, 1),
          ),
          nativeRegistrySnapshot(true, 2),
          nativeRegistrySnapshot(true, 3),
          nativeRegistrySnapshot(true, 3),
          nativeRegistrySnapshot(false, 3),
        ],
      },
      retainedFontBudget: {
        maxPaths: 128,
        maxSourceBytes: 512 * 1024 * 1024,
        pathCounts: [...Array.from({ length: 20 }, () => 1), 2, 3, 3, 3],
        sourceByteCounts: [
          ...Array.from({ length: 20 }, () => 1024),
          2048,
          3072,
          3072,
          3072,
        ],
      },
      wasmHeapBytes: {
        min: 128 * 1024 * 1024,
        max: 160 * 1024 * 1024,
        range: 32 * 1024 * 1024,
        limit: 64 * 1024 * 1024,
      },
      conversionBytes: {
        defaultBefore: 1024,
        cjkFirst: 2048,
        cjkLast: 2048,
        defaultAfter: 1024,
      },
      sameFamilyReplacement: {
        familyStyle: "Noto Sans CJK SC|Regular",
        filename: "NotoSansCJK-Regular.otf",
        fontSha256: ["1".repeat(64), "2".repeat(64)],
        rasterSha256: ["3".repeat(64), "4".repeat(64), "3".repeat(64)],
        verified: true,
      },
    }),
  );
  await writeFile(
    join(nativeRoot, "font-profile-fault-qualification.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "libreoffice-wasm-font-profile-fault-qualification",
      githubActionsRunId: RUN_ID,
      qualificationRunId: RUN_ID,
      nativeBuildRunId: RUN_ID,
      nativeCommit: COMMIT_A,
      wrapperCommit: COMMIT_B,
      ...environment,
      buildMode: "fresh-clean",
      fault: "malformed-sfnt-after-valid-profile",
      mutationAttempted: true,
      mutationCommitted: false,
      stateKnown: false,
      runtimeReusable: false,
      quarantine: true,
      workerLifecycle: { created: 2, closedAfterDestroy: 2 },
      quarantinedRuntimeIdentity: {
        worker: "worker:1",
        module: "worker:1:module:1",
        lok: "worker:1:module:1:lok:1:ptr:4096",
      },
      recovery: {
        conversionBytes: 1024,
        freshRuntimeIdentity: {
          worker: "worker:2",
          module: "worker:2:module:1",
          lok: "worker:2:module:1:lok:1:ptr:4096",
        },
        differsFromQuarantinedRuntime: true,
        stateKnown: true,
        runtimeReusable: true,
        quarantine: false,
        nativeDiagnostics: nativeRegistrySnapshot(false, 0),
      },
      serverCoreRequestCounts: {
        "browser.worker.global.js": 2,
        "soffice.js": 2,
        "soffice.wasm": 2,
        "soffice.data": 2,
      },
    }),
  );
  const nativeArchive = join(root, `soffice-wasm-no-pthread-${RUN_ID}.zip`);
  const nativeEntries = await Promise.all(
    (await readdir(nativeRoot)).sort().map(async (name) => ({
      path: name,
      bytes: await readFile(join(nativeRoot, name)),
    })),
  );
  await writeFile(nativeArchive, createDeterministicZip(nativeEntries));
  return { root, nativeRoot, wrapperRoot, nativeArchive };
}

describe("successor candidate freezing", () => {
  it("derives a valid eight-asset no-pthread candidate without loading WASM", async () => {
    const paths = await fixture();
    const spec = await freezeCandidate({
      ...paths,
      nativeCommit: COMMIT_A,
      wrapperCommit: COMMIT_B,
      runId: RUN_ID,
    });

    expect(spec.provenance.native.abi).toBe(
      "lok-convert-document-font-profile-v1",
    );
    expect(spec.assets).toHaveLength(8);
    expect(spec.assets.map((asset) => asset.path)).not.toContain(
      "wasm/soffice.data.js.metadata",
    );
    expect(spec.runtime).toEqual({
      threading: "none",
      capabilities: { dynamicFontProfiles: 1 },
    });
    expect(deriveCandidateIdentity(spec)).toBe(spec.candidateId);
    expect(spec.expectedPayloadArchiveName).toBe(
      `libreoffice-wasm-runtime-${spec.candidateId}.zip`,
    );
  });

  it("rejects unknown native files before candidate derivation", async () => {
    const paths = await fixture();
    await writeFile(join(paths.nativeRoot, "soffice.worker.js"), "unexpected");

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(FreezeCandidateError);
  });

  it("rejects an extracted native root that differs from the downloaded archive", async () => {
    const paths = await fixture();
    await writeFile(
      join(paths.nativeRoot, "soffice.data.js.metadata"),
      "{\n}\n",
    );

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/native archive entry does not match extracted file/);
  });

  it("rejects artifacts without matching font-profile qualification evidence", async () => {
    const paths = await fixture();
    await writeFile(
      join(paths.nativeRoot, "font-profile-qualification.json"),
      JSON.stringify({ schemaVersion: 1, kind: "unqualified" }),
    );

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/qualification evidence/);
  });

  it("rejects qualification-only evidence that reuses a different native run", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.nativeBuildRunId = "99999999999";
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/qualification evidence/);
  });

  it("rejects self-asserted stable identity when raw identities differ", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.runtimeIdentities[7].module = "module:other";
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/qualification evidence/);
  });

  it("rejects qualification evidence with repeated core requests", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.serverCoreRequestCounts["soffice.wasm"] = 2;
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/qualification evidence/);
  });

  it("rejects qualification evidence with residual active native registries", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.nativeRegistryDiagnostics.transitions[1].freetypeFontInfoRecords = 1;
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/active registries/);
  });

  it("rejects qualification evidence that exceeds the retained-font budget", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.retainedFontBudget.pathCounts[22] = 129;
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/retained-font budget/);
  });

  it("rejects qualification evidence with an unbounded FreeType file cache", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.nativeRegistryDiagnostics.transitions[22].freetypeFontFileRecords = 4;
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/registry diagnostics/);
  });

  it("rejects fault recovery that reuses the quarantined runtime identity", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-fault-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.recovery.freshRuntimeIdentity =
      evidence.quarantinedRuntimeIdentity;
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/fault evidence/);
  });

  it("rejects fault evidence without a clean fresh-runtime recovery", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-fault-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.recovery.nativeDiagnostics.printFontManagerRecords = 1;
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/fault evidence/);
  });

  it("rejects qualification evidence with unstable heap growth", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.wasmHeapBytes.range = evidence.wasmHeapBytes.limit + 1;
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/qualification evidence/);
  });

  it("rejects missing native mutation fault evidence", async () => {
    const paths = await fixture();
    await writeFile(
      join(paths.nativeRoot, "font-profile-fault-qualification.json"),
      JSON.stringify({ schemaVersion: 1, kind: "unqualified" }),
    );

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/fault evidence/);
  });

  it("rejects qualification evidence bound to different runtime bytes", async () => {
    const paths = await fixture();
    await writeFile(join(paths.wrapperRoot, "dist/browser.js"), "changed\n");

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/runtime assets hash mismatch/);
  });

  it("rejects qualification evidence from different source files", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.qualificationSourceSha256["src/browser.worker.ts"] = "0".repeat(
      64,
    );
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/source files hash mismatch/);
  });

  it("rejects qualification evidence without a Chromium version", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-fault-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.browser.version = "";
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/browser version is missing/);
  });

  it("rejects qualification evidence bound to different runtime bytes", async () => {
    const paths = await fixture();
    await writeFile(join(paths.wrapperRoot, "dist/browser.js"), "changed\n");

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/runtime assets hash mismatch/);
  });

  it("rejects qualification evidence from different source files", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.qualificationSourceSha256["src/browser.worker.ts"] = "0".repeat(
      64,
    );
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/source files hash mismatch/);
  });

  it("rejects qualification evidence without a Chromium version", async () => {
    const paths = await fixture();
    const evidencePath = join(
      paths.nativeRoot,
      "font-profile-fault-qualification.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.browser.version = "";
    await writeFile(evidencePath, JSON.stringify(evidence));

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/browser version is missing/);
  });

  it("rejects pointer-sized native artifacts", async () => {
    const paths = await fixture();
    await writeFile(
      join(paths.nativeRoot, "soffice.wasm"),
      "version https://git-lfs.github.com/spec/v1\n" +
        "oid sha256:" +
        "0".repeat(64) +
        "\nsize 1000000\n",
    );

    await expect(
      freezeCandidate({
        ...paths,
        nativeCommit: COMMIT_A,
        wrapperCommit: COMMIT_B,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(/too small|Git LFS pointer/);
  });
});
