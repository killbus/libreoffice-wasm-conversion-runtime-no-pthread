import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
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

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const RUN_ID = "32146386224";
const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const qualificationSourcePaths = [
  "tests/browser/font-profile-lifecycle.spec.ts",
  "src/browser.ts",
  "src/browser.worker.ts",
  "src/lok-bindings.ts",
  "build/patches/wasm-font-removal-primitives.patch",
  "build/patches/wasm-font-profile-abi.patch",
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
      nativeCommit: COMMIT_A,
      ...environment,
      dynamicFontProfiles: 1,
      cacheDisabled: true,
      coreAssetsServedWithNoStore: true,
      serviceWorkersBypassed: true,
      profileCycles: 10,
      serverCoreRequestCounts: {
        "browser.worker.global.js": 1,
        "soffice.js": 1,
        "soffice.wasm": 1,
        "soffice.data": 1,
      },
      workerLifecycle: { created: 1, closedAfterDestroy: 1 },
      runtimeIdentity: { worker: "worker:1", module: "module:1", lok: "lok:1" },
      stableRuntimeIdentity: true,
      cleanupDebtFree: true,
      profileFileCounts: Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0 ? 1 : 0,
      ),
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
      nativeCommit: COMMIT_A,
      ...environment,
      fault: "malformed-sfnt-after-valid-profile",
      mutationAttempted: true,
      mutationCommitted: false,
      stateKnown: false,
      runtimeReusable: false,
      quarantine: true,
      workerLifecycle: { created: 1, closedAfterQuarantine: 1 },
      serverCoreRequestCounts: {
        "browser.worker.global.js": 1,
        "soffice.js": 1,
        "soffice.wasm": 1,
        "soffice.data": 1,
      },
    }),
  );
  const nativeArchive = join(root, `soffice-wasm-no-pthread-${RUN_ID}.zip`);
  await writeFile(nativeArchive, "archive bytes");
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
