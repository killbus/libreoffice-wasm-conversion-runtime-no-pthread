import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gateSource = readFileSync(
  new URL(
    "../../scripts/release-runtime/browser-worker-gate.mjs",
    import.meta.url,
  ),
  "utf8",
);

describe("browser Worker gate source contract", () => {
  it("requires exactly one request for every core browser asset", () => {
    expect(gateSource).toContain(
      "Object.values(coreRequestCounts).every((count) => count === 1)",
    );
    expect(gateSource).not.toContain(
      "serverRequests.includes('/wasm/soffice.wasm')",
    );
    expect(gateSource).not.toContain(
      "serverRequests.includes('/wasm/soffice.data')",
    );
  });

  it("requires one observed Worker and disables browser caches", () => {
    expect(gateSource).toContain("workerUrls.length === 1");
    expect(gateSource).toContain('serviceWorkers: "block"');
    expect(gateSource).toContain("Network.setCacheDisabled");
    expect(gateSource).toContain("Network.setBypassServiceWorker");
    expect(gateSource).toContain('"Cache-Control": "no-store"');
  });
});
