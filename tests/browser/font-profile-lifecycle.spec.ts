import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type {
  FontProfileResult,
  NativeFontProfileDiagnostics,
} from "../../src/types.js";
import {
  writeFontProfileFaultQualificationEvidence,
  writeFontProfileQualificationEvidence,
} from "../release-runtime/helpers/font-profile-evidence.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.join(testDirectory, "..", "fixtures-ci");
const cjkFixture = path.join(fixtureDirectory, "NotoSansCJK-Regular.ttc");
const replacementFixtureA = path.join(
  fixtureDirectory,
  "NotoSansCJK-Profile-A.otf",
);
const replacementFixtureB = path.join(
  fixtureDirectory,
  "NotoSansCJK-Profile-B.otf",
);
const execFileAsync = promisify(execFile);
const coreAssetNames = new Set([
  "browser.worker.global.js",
  "soffice.js",
  "soffice.wasm",
  "soffice.data",
]);

const activeRegistryKeys = [
  "printFontManagerRecords",
  "fontconfigApplicationPatterns",
  "freetypeFontInfoRecords",
] as const;

function requireNativeDiagnostics(
  transition: FontProfileResult,
): NativeFontProfileDiagnostics {
  const diagnostics = transition.diagnostics.native;
  if (!diagnostics || diagnostics.registryCountsAvailable !== true) {
    throw new Error(
      `Native registry diagnostics unavailable: ${JSON.stringify(transition)}`,
    );
  }
  return diagnostics;
}

async function rasterSha256(
  base64: string | undefined,
  name: string,
  outputPath: (name: string) => string,
): Promise<string> {
  expect(base64).toBeTruthy();
  const pdfPath = outputPath(`${name}.pdf`);
  const imagePrefix = outputPath(name);
  writeFileSync(pdfPath, Buffer.from(base64!, "base64"));
  await execFileAsync("pdftoppm", [
    "-f",
    "1",
    "-singlefile",
    "-png",
    "-r",
    "96",
    pdfPath,
    imagePrefix,
  ]);
  return createHash("sha256")
    .update(readFileSync(`${imagePrefix}.png`))
    .digest("hex");
}

test.use({ serviceWorkers: "block" });

test.describe("dynamic font profile qualification", () => {
  test.skip(
    ![cjkFixture, replacementFixtureA, replacementFixtureB].every(existsSync),
    "CI-provisioned Noto CJK fixtures are required",
  );

  test("reuses one Worker, Module, and LOK across repeated profile transitions", async ({
    browser,
    context,
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "CDP cache controls require Chromium",
    );

    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await context.route("**/*", (route) => route.continue());

    const browserCoreRequests: string[] = [];
    context.on("request", (request) => {
      const name = new URL(request.url()).pathname.split("/").at(-1);
      if (name && coreAssetNames.has(name)) browserCoreRequests.push(name);
    });
    let workerCreateCount = 0;
    let workerCloseCount = 0;
    page.on("worker", (worker) => {
      workerCreateCount += 1;
      worker.on("close", () => {
        workerCloseCount += 1;
      });
    });

    await context.request.post("http://localhost:3000/__test__/requests/reset");
    await page.goto("/tests/browser/font-profile.html");
    const result = await page.evaluate(async () => {
      const runtime = await import("/dist/browser.js");
      const converter = runtime.createWorkerBrowserConverter({
        ...runtime.createWasmPaths("/wasm/"),
        browserWorkerJs: "/dist/browser.worker.global.js",
        fonts: [],
      });
      await converter.initialize();

      const digestHex = async (bytes: Uint8Array) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      const fingerprint = async (filename: string, sha256: string) =>
        `sha256:${await digestHex(
          new TextEncoder().encode(JSON.stringify([{ filename, sha256 }])),
        )}`;
      const fetchBytes = async (url: string) =>
        new Uint8Array(await (await fetch(url)).arrayBuffer());
      const convertPdf = async (
        text: string,
        filename: string,
        capture = false,
      ) => {
        const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Noto Sans CJK SC;}}\\f0\\fs24 ${text}}`;
        const conversion = await converter.convert(
          new TextEncoder().encode(rtf),
          { outputFormat: "pdf" },
          filename,
        );
        if (conversion.data[0] !== 0x25 || conversion.data[1] !== 0x50) {
          throw new Error(`Conversion did not return a PDF for ${filename}`);
        }
        let base64: string | undefined;
        if (capture) {
          let binary = "";
          const chunkSize = 0x8000;
          for (
            let offset = 0;
            offset < conversion.data.length;
            offset += chunkSize
          ) {
            binary += String.fromCharCode(
              ...conversion.data.subarray(offset, offset + chunkSize),
            );
          }
          base64 = btoa(binary);
        }
        return { byteLength: conversion.data.byteLength, base64 };
      };

      const fontBytes = await fetchBytes(
        "/tests/fixtures-ci/NotoSansCJK-Regular.ttc",
      );
      const replacementBytesA = await fetchBytes(
        "/tests/fixtures-ci/NotoSansCJK-Profile-A.otf",
      );
      const replacementBytesB = await fetchBytes(
        "/tests/fixtures-ci/NotoSansCJK-Profile-B.otf",
      );
      const sha256 = await digestHex(fontBytes);
      const filename = "NotoSansCJK-Regular.ttc";
      const cjkFingerprint = await fingerprint(filename, sha256);
      let activeFingerprint = runtime.EMPTY_FONT_PROFILE_FINGERPRINT;
      const transitions: FontProfileResult[] = [];

      const conversionBytes = {
        defaultBefore: (
          await convertPdf("Default profile", "default-before.rtf")
        ).byteLength,
        cjkFirst: 0,
        cjkLast: 0,
        defaultAfter: 0,
      };
      for (let cycle = 0; cycle < 10; cycle += 1) {
        const enable = await converter.setFontProfile({
          schemaVersion: runtime.FONT_PROFILE_SCHEMA_VERSION,
          transitionId: `enable-${cycle}`,
          expectedActiveFingerprint: activeFingerprint,
          targetFingerprint: cjkFingerprint,
          fonts: [{ filename, sha256, data: fontBytes }],
        });
        if (!enable.ok)
          throw new Error(`Enable failed: ${JSON.stringify(enable)}`);
        transitions.push(enable);
        activeFingerprint = enable.appliedFingerprint;

        if (cycle === 0 || cycle === 9) {
          const { byteLength } = await convertPdf(
            "\\u20013?\\u25991? CJK profile",
            `cjk-${cycle}.rtf`,
          );
          if (cycle === 0) conversionBytes.cjkFirst = byteLength;
          else conversionBytes.cjkLast = byteLength;
        }

        const disable = await converter.setFontProfile({
          schemaVersion: runtime.FONT_PROFILE_SCHEMA_VERSION,
          transitionId: `disable-${cycle}`,
          expectedActiveFingerprint: activeFingerprint,
          targetFingerprint: runtime.EMPTY_FONT_PROFILE_FINGERPRINT,
          fonts: [],
        });
        if (!disable.ok)
          throw new Error(`Disable failed: ${JSON.stringify(disable)}`);
        transitions.push(disable);
        activeFingerprint = disable.appliedFingerprint;
      }
      conversionBytes.defaultAfter = (
        await convertPdf("Default profile restored", "default-after.rtf")
      ).byteLength;

      const replacementFilename = "NotoSansCJK-Regular.otf";
      const replacementShaA = await digestHex(replacementBytesA);
      const replacementShaB = await digestHex(replacementBytesB);
      const replacementFingerprintA = await fingerprint(
        replacementFilename,
        replacementShaA,
      );
      const replacementFingerprintB = await fingerprint(
        replacementFilename,
        replacementShaB,
      );
      const replacementTransitions: FontProfileResult[] = [];
      const applyReplacement = async (
        transitionId: string,
        targetFingerprint: string,
        sha: string,
        data: Uint8Array,
      ) => {
        const transition = await converter.setFontProfile({
          schemaVersion: runtime.FONT_PROFILE_SCHEMA_VERSION,
          transitionId,
          expectedActiveFingerprint: activeFingerprint,
          targetFingerprint,
          fonts: [{ filename: replacementFilename, sha256: sha, data }],
        });
        if (!transition.ok)
          throw new Error(`Replacement failed: ${JSON.stringify(transition)}`);
        replacementTransitions.push(transition);
        activeFingerprint = transition.appliedFingerprint;
      };

      await applyReplacement(
        "replacement-a-1",
        replacementFingerprintA,
        replacementShaA,
        replacementBytesA,
      );
      const replacementAFirst = await convertPdf(
        "\\u25991? same-family replacement",
        "replacement-a-first.rtf",
        true,
      );
      await applyReplacement(
        "replacement-b",
        replacementFingerprintB,
        replacementShaB,
        replacementBytesB,
      );
      const replacementB = await convertPdf(
        "\\u25991? same-family replacement",
        "replacement-b.rtf",
        true,
      );
      await applyReplacement(
        "replacement-a-2",
        replacementFingerprintA,
        replacementShaA,
        replacementBytesA,
      );
      const replacementASecond = await convertPdf(
        "\\u25991? same-family replacement",
        "replacement-a-second.rtf",
        true,
      );
      const cleanup = await converter.setFontProfile({
        schemaVersion: runtime.FONT_PROFILE_SCHEMA_VERSION,
        transitionId: "replacement-cleanup",
        expectedActiveFingerprint: activeFingerprint,
        targetFingerprint: runtime.EMPTY_FONT_PROFILE_FINGERPRINT,
        fonts: [],
      });
      if (!cleanup.ok)
        throw new Error(`Cleanup failed: ${JSON.stringify(cleanup)}`);
      replacementTransitions.push(cleanup);

      await converter.destroy();
      return {
        transitions,
        replacementTransitions,
        conversionBytes,
        replacement: {
          filename: replacementFilename,
          shaA: replacementShaA,
          shaB: replacementShaB,
          pdfAFirst: replacementAFirst.base64,
          pdfB: replacementB.base64,
          pdfASecond: replacementASecond.base64,
        },
      };
    });

    expect(result.transitions).toHaveLength(20);
    expect(result.replacementTransitions).toHaveLength(4);
    const allTransitions = [
      ...result.transitions,
      ...result.replacementTransitions,
    ];
    const identities = allTransitions.map((entry) =>
      JSON.stringify(entry.identity),
    );
    expect(new Set(identities).size).toBe(1);
    const nativeRegistryDiagnostics = allTransitions.map(
      requireNativeDiagnostics,
    );
    for (const [index, transition] of result.transitions.entries()) {
      expect(transition.runtimeReusable).toBe(true);
      expect(transition.quarantine).toBe(false);
      expect(transition.diagnostics.cleanupDebtPaths).toEqual([]);
      expect(transition.diagnostics.profileFileCount).toBe(
        index % 2 === 0 ? 1 : 0,
      );
      const native = requireNativeDiagnostics(transition);
      expect(native.activeFontCount).toBe(index % 2 === 0 ? 1 : 0);
      for (const key of activeRegistryKeys) {
        if (index % 2 === 0) expect(native[key], key).toBeGreaterThan(0);
        else expect(native[key], key).toBe(0);
      }
      expect(native.freetypeFontFileRecords).toBe(1);
      expect(transition.diagnostics.retainedFontPathCount).toBe(1);
    }
    const cjkRegistrySignatures = result.transitions
      .filter((_, index) => index % 2 === 0)
      .map((transition) => {
        const native = requireNativeDiagnostics(transition);
        return activeRegistryKeys.map((key) => native[key]).join(":");
      });
    expect(new Set(cjkRegistrySignatures).size).toBe(1);

    for (const [index, transition] of result.replacementTransitions.entries()) {
      expect(transition.runtimeReusable).toBe(true);
      expect(transition.quarantine).toBe(false);
      expect(transition.diagnostics.cleanupDebtPaths).toEqual([]);
      expect(transition.diagnostics.profileFileCount).toBe(index === 3 ? 0 : 1);
      const native = requireNativeDiagnostics(transition);
      expect(native.activeFontCount).toBe(index === 3 ? 0 : 1);
      for (const key of activeRegistryKeys) {
        if (index === 3) expect(native[key], key).toBe(0);
        else expect(native[key], key).toBeGreaterThan(0);
      }
    }
    expect(
      result.replacementTransitions.map(
        (transition) =>
          requireNativeDiagnostics(transition).freetypeFontFileRecords,
      ),
    ).toEqual([2, 3, 3, 3]);
    expect(
      result.replacementTransitions.map(
        (transition) => transition.diagnostics.retainedFontPathCount,
      ),
    ).toEqual([2, 3, 3, 3]);
    expect(result.replacementTransitions[1]?.addedCount).toBe(1);
    expect(result.replacementTransitions[1]?.removedCount).toBe(1);
    expect(result.replacementTransitions[2]?.addedCount).toBe(1);
    expect(result.replacementTransitions[2]?.removedCount).toBe(1);

    const warmedHeapSizes = allTransitions
      .slice(2)
      .map((entry) => entry.diagnostics.wasmHeapBytes)
      .filter((value): value is number => typeof value === "number");
    expect(warmedHeapSizes.length).toBeGreaterThan(0);
    expect(
      Math.max(...warmedHeapSizes) - Math.min(...warmedHeapSizes),
    ).toBeLessThanOrEqual(64 * 1024 * 1024);

    const [
      replacementAFirstRaster,
      replacementBRaster,
      replacementASecondRaster,
    ] = await Promise.all([
      rasterSha256(
        result.replacement.pdfAFirst,
        "replacement-a-first",
        testInfo.outputPath.bind(testInfo),
      ),
      rasterSha256(
        result.replacement.pdfB,
        "replacement-b",
        testInfo.outputPath.bind(testInfo),
      ),
      rasterSha256(
        result.replacement.pdfASecond,
        "replacement-a-second",
        testInfo.outputPath.bind(testInfo),
      ),
    ]);
    expect(result.replacement.shaA).not.toBe(result.replacement.shaB);
    expect(replacementAFirstRaster).toBe(replacementASecondRaster);
    expect(replacementBRaster).not.toBe(replacementAFirstRaster);

    const [{ stdout: familyStyleA }, { stdout: familyStyleB }] =
      await Promise.all([
        execFileAsync("fc-scan", [
          "--format=%{family[0]}|%{style[0]}",
          replacementFixtureA,
        ]),
        execFileAsync("fc-scan", [
          "--format=%{family[0]}|%{style[0]}",
          replacementFixtureB,
        ]),
      ]);
    expect(familyStyleA).toBeTruthy();
    expect(familyStyleB).toBe(familyStyleA);

    const browserCoreRequestCounts = Object.fromEntries(
      [...coreAssetNames].map((assetName) => [
        assetName,
        browserCoreRequests.filter((name) => name === assetName).length,
      ]),
    );
    const serverRequestResponse = await context.request.get(
      "http://localhost:3000/__test__/requests",
    );
    expect(serverRequestResponse.ok()).toBe(true);
    const serverRequests = (await serverRequestResponse.json()) as Array<{
      method: string;
      pathname: string;
    }>;
    const serverCoreRequestCounts = Object.fromEntries(
      [...coreAssetNames].map((assetName) => [
        assetName,
        serverRequests.filter(
          ({ pathname }) => pathname.split("/").at(-1) === assetName,
        ).length,
      ]),
    );
    for (const assetName of coreAssetNames)
      expect(serverCoreRequestCounts[assetName], assetName).toBe(1);
    expect(workerCreateCount).toBe(1);
    await expect.poll(() => workerCloseCount).toBe(1);
    for (const byteLength of Object.values(result.conversionBytes))
      expect(byteLength).toBeGreaterThan(0);

    const identity = result.transitions[0]?.identity;
    expect(identity).toBeDefined();
    await writeFontProfileQualificationEvidence(
      { name: browser.browserType().name(), version: browser.version() },
      {
        dynamicFontProfiles: 1,
        cacheDisabled: true,
        coreAssetsServedWithNoStore: true,
        serviceWorkersBypassed: true,
        profileCycles: 10,
        browserCoreRequestCounts,
        serverCoreRequestCounts,
        serverRequests,
        workerLifecycle: {
          created: workerCreateCount,
          closedAfterDestroy: workerCloseCount,
        },
        runtimeIdentity: identity,
        runtimeIdentities: allTransitions.map(
          (transition) => transition.identity,
        ),
        stableRuntimeIdentity: true,
        cleanupDebtFree: true,
        profileFileCounts: result.transitions.map(
          (transition) => transition.diagnostics.profileFileCount,
        ),
        nativeRegistryDiagnostics: {
          maxRetainedFontFiles: 3,
          transitions: nativeRegistryDiagnostics,
        },
        retainedFontBudget: {
          maxPaths: 128,
          maxSourceBytes: 512 * 1024 * 1024,
          pathCounts: allTransitions.map(
            (transition) => transition.diagnostics.retainedFontPathCount,
          ),
          sourceByteCounts: allTransitions.map(
            (transition) => transition.diagnostics.retainedFontBytes,
          ),
        },
        wasmHeapBytes: {
          min: Math.min(...warmedHeapSizes),
          max: Math.max(...warmedHeapSizes),
          range: Math.max(...warmedHeapSizes) - Math.min(...warmedHeapSizes),
          limit: 64 * 1024 * 1024,
        },
        conversionBytes: result.conversionBytes,
        sameFamilyReplacement: {
          familyStyle: familyStyleA,
          filename: result.replacement.filename,
          fontSha256: [result.replacement.shaA, result.replacement.shaB],
          rasterSha256: [
            replacementAFirstRaster,
            replacementBRaster,
            replacementASecondRaster,
          ],
          verified: true,
        },
      },
    );
  });
  test("quarantines the Worker after a native mutation failure", async ({
    browser,
    context,
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "CDP cache controls require Chromium",
    );

    await context.route("**/*", (route) => route.continue());
    await context.request.post("http://localhost:3000/__test__/requests/reset");
    let workerCreateCount = 0;
    let workerCloseCount = 0;
    page.on("worker", (worker) => {
      workerCreateCount += 1;
      worker.on("close", () => {
        workerCloseCount += 1;
      });
    });

    await page.goto("/tests/browser/font-profile.html");
    const result = await page.evaluate(async () => {
      const runtime = await import("/dist/browser.js");
      const converter = runtime.createWorkerBrowserConverter({
        ...runtime.createWasmPaths("/wasm/"),
        browserWorkerJs: "/dist/browser.worker.global.js",
        fonts: [],
      });
      await converter.initialize();

      const digestHex = async (bytes: Uint8Array) =>
        [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      const fingerprint = async (filename: string, sha256: string) =>
        `sha256:${await digestHex(
          new TextEncoder().encode(JSON.stringify([{ filename, sha256 }])),
        )}`;

      const validBytes = new Uint8Array(
        await (
          await fetch("/tests/fixtures-ci/NotoSansCJK-Profile-A.otf")
        ).arrayBuffer(),
      );
      const filename = "NotoSansCJK-Regular.otf";
      const validSha256 = await digestHex(validBytes);
      const validFingerprint = await fingerprint(filename, validSha256);
      const valid = await converter.setFontProfile({
        schemaVersion: runtime.FONT_PROFILE_SCHEMA_VERSION,
        transitionId: "fault-baseline",
        expectedActiveFingerprint: runtime.EMPTY_FONT_PROFILE_FINGERPRINT,
        targetFingerprint: validFingerprint,
        fonts: [{ filename, sha256: validSha256, data: validBytes }],
      });
      if (!valid.ok)
        throw new Error(`Valid baseline failed: ${JSON.stringify(valid)}`);

      const invalidBytes = new Uint8Array([
        0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const invalidSha256 = await digestHex(invalidBytes);
      const invalidFingerprint = await fingerprint(filename, invalidSha256);
      const failed = await converter.setFontProfile({
        schemaVersion: runtime.FONT_PROFILE_SCHEMA_VERSION,
        transitionId: "fault-invalid-sfnt",
        expectedActiveFingerprint: valid.appliedFingerprint,
        targetFingerprint: invalidFingerprint,
        fonts: [{ filename, sha256: invalidSha256, data: invalidBytes }],
      });
      const recoveredConversion = await converter.convert(
        new TextEncoder().encode(
          "{\\rtf1\\ansi\\deff0 Recovered after quarantine}",
        ),
        { outputFormat: "pdf" },
        "recovered-after-quarantine.rtf",
      );
      const recoveredProfile = await converter.setFontProfile({
        schemaVersion: runtime.FONT_PROFILE_SCHEMA_VERSION,
        transitionId: "fault-recovery-default",
        expectedActiveFingerprint: runtime.EMPTY_FONT_PROFILE_FINGERPRINT,
        targetFingerprint: runtime.EMPTY_FONT_PROFILE_FINGERPRINT,
        fonts: [],
      });
      await converter.destroy();
      return {
        valid,
        failed,
        recoveredBytes: recoveredConversion.data.byteLength,
        recoveredProfile,
      };
    });

    expect(result.valid.ok).toBe(true);
    expect(result.failed.ok).toBe(false);
    expect(result.failed.mutation.attempted).toBe(true);
    expect(result.failed.mutation.committed).toBe(false);
    expect(result.failed.stateKnown).toBe(false);
    expect(result.failed.runtimeReusable).toBe(false);
    expect(result.failed.quarantine).toBe(true);
    expect(result.failed.identity).toEqual(result.valid.identity);
    expect(result.recoveredBytes).toBeGreaterThan(0);
    expect(result.recoveredProfile.ok).toBe(true);
    expect(result.recoveredProfile.runtimeReusable).toBe(true);
    expect(result.recoveredProfile.quarantine).toBe(false);
    expect(result.recoveredProfile.identity.worker).not.toBe(
      result.valid.identity.worker,
    );
    expect(result.recoveredProfile.identity.module).not.toBe(
      result.valid.identity.module,
    );
    expect(result.recoveredProfile.identity.lok).not.toBe(
      result.valid.identity.lok,
    );
    const recoveryNative = requireNativeDiagnostics(result.recoveredProfile);
    expect(recoveryNative.activeFontCount).toBe(0);
    for (const key of activeRegistryKeys)
      expect(recoveryNative[key], key).toBe(0);
    expect(recoveryNative.freetypeFontFileRecords).toBe(0);
    expect(result.recoveredProfile.diagnostics.retainedFontPathCount).toBe(0);
    expect(result.recoveredProfile.diagnostics.retainedFontBytes).toBe(0);
    expect(workerCreateCount).toBe(2);
    await expect.poll(() => workerCloseCount).toBe(2);

    const serverRequestResponse = await context.request.get(
      "http://localhost:3000/__test__/requests",
    );
    expect(serverRequestResponse.ok()).toBe(true);
    const serverRequests = (await serverRequestResponse.json()) as Array<{
      method: string;
      pathname: string;
    }>;
    const serverCoreRequestCounts = Object.fromEntries(
      [...coreAssetNames].map((assetName) => [
        assetName,
        serverRequests.filter(
          ({ pathname }) => pathname.split("/").at(-1) === assetName,
        ).length,
      ]),
    );
    for (const assetName of coreAssetNames)
      expect(serverCoreRequestCounts[assetName], assetName).toBe(2);

    await writeFontProfileFaultQualificationEvidence(
      { name: browser.browserType().name(), version: browser.version() },
      {
        fault: "malformed-sfnt-after-valid-profile",
        mutationAttempted: result.failed.mutation.attempted,
        mutationCommitted: result.failed.mutation.committed,
        stateKnown: result.failed.stateKnown,
        runtimeReusable: result.failed.runtimeReusable,
        quarantine: result.failed.quarantine,
        workerLifecycle: {
          created: workerCreateCount,
          closedAfterDestroy: workerCloseCount,
        },
        quarantinedRuntimeIdentity: result.failed.identity,
        recovery: {
          conversionBytes: result.recoveredBytes,
          freshRuntimeIdentity: result.recoveredProfile.identity,
          differsFromQuarantinedRuntime:
            JSON.stringify(result.recoveredProfile.identity) !==
            JSON.stringify(result.failed.identity),
          stateKnown: result.recoveredProfile.stateKnown,
          runtimeReusable: result.recoveredProfile.runtimeReusable,
          quarantine: result.recoveredProfile.quarantine,
          nativeDiagnostics: recoveryNative,
        },
        serverCoreRequestCounts,
      },
    );
  });
});
