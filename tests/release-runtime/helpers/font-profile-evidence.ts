import { createHash } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const runtimeEvidenceFiles = {
  "browser.js": path.join(repositoryRoot, "dist", "browser.js"),
  "browser.worker.global.js": path.join(
    repositoryRoot,
    "dist",
    "browser.worker.global.js",
  ),
  "soffice.js": path.join(repositoryRoot, "wasm", "soffice.js"),
  "soffice.wasm": path.join(repositoryRoot, "wasm", "soffice.wasm"),
  "soffice.data": path.join(repositoryRoot, "wasm", "soffice.data"),
} as const;

const qualificationSourceFiles = {
  ".github/workflows/build-wasm.yml": path.join(
    repositoryRoot,
    ".github",
    "workflows",
    "build-wasm.yml",
  ),
  "tests/browser/font-profile-lifecycle.spec.ts": path.join(
    repositoryRoot,
    "tests",
    "browser",
    "font-profile-lifecycle.spec.ts",
  ),
  "tests/release-runtime/helpers/font-profile-evidence.ts": fileURLToPath(
    import.meta.url,
  ),
  "src/browser.ts": path.join(repositoryRoot, "src", "browser.ts"),
  "src/browser.worker.ts": path.join(
    repositoryRoot,
    "src",
    "browser.worker.ts",
  ),
  "src/lok-bindings.ts": path.join(repositoryRoot, "src", "lok-bindings.ts"),
  "build/patches/wasm-font-removal-primitives.patch": path.join(
    repositoryRoot,
    "build",
    "patches",
    "wasm-font-removal-primitives.patch",
  ),
  "build/patches/wasm-font-profile-abi.patch": path.join(
    repositoryRoot,
    "build",
    "patches",
    "wasm-font-profile-abi.patch",
  ),
} as const;

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function hashEvidenceFiles(
  files: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, filePath]) => [
        name,
        await sha256File(filePath),
      ]),
    ),
  );
}

async function writeEvidence(
  filename: string,
  kind: string,
  browser: { name: string; version: string },
  observations: Record<string, unknown>,
): Promise<void> {
  const qualificationRunId = process.env.GITHUB_RUN_ID ?? "local";
  const qualificationCommit = process.env.GITHUB_SHA ?? "local";
  const nativeBuildRunId =
    process.env.NATIVE_BUILD_RUN_ID ?? qualificationRunId;
  const nativeCommit = process.env.NATIVE_BUILD_HEAD_SHA ?? qualificationCommit;
  const [runtimeAssetSha256, qualificationSourceSha256] = await Promise.all([
    hashEvidenceFiles(runtimeEvidenceFiles),
    hashEvidenceFiles(qualificationSourceFiles),
  ]);

  writeFileSync(
    path.join(repositoryRoot, "wasm", filename),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind,
        githubActionsRunId: qualificationRunId,
        qualificationRunId,
        nativeBuildRunId,
        nativeCommit,
        wrapperCommit: qualificationCommit,
        browser,
        runtimeAssetSha256,
        qualificationSourceSha256,
        ...observations,
      },
      null,
      2,
    )}\n`,
  );
}

export async function writeFontProfileQualificationEvidence(
  browser: { name: string; version: string },
  observations: Record<string, unknown>,
): Promise<void> {
  await writeEvidence(
    "font-profile-qualification.json",
    "libreoffice-wasm-font-profile-qualification",
    browser,
    observations,
  );
}

export async function writeFontProfileFaultQualificationEvidence(
  browser: { name: string; version: string },
  observations: Record<string, unknown>,
): Promise<void> {
  await writeEvidence(
    "font-profile-fault-qualification.json",
    "libreoffice-wasm-font-profile-fault-qualification",
    browser,
    observations,
  );
}
