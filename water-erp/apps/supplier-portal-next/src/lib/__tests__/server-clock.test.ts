import test from "node:test";
import assert from "node:assert/strict";
import { serverNow, serverNowMs, syncServerClock } from "@water-erp/shared";

test("server clock stays anchored to monotonic time after the local wall clock changes", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
  let wallNow = 5_000;
  let monotonicNow = 100;
  Date.now = () => wallNow;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => monotonicNow },
  });
  globalThis.fetch = (async () => {
    monotonicNow = 120;
    return new Response(JSON.stringify({ serverTime: 1_000_000 }), { status: 200 });
  }) as typeof fetch;

  try {
    await syncServerClock("/api-test");
    wallNow = 900_000_000;
    monotonicNow = 1_120;
    assert.equal(serverNowMs(), 1_001_010);
    assert.equal(serverNow().getTime(), 1_001_010);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    if (performanceDescriptor) Object.defineProperty(globalThis, "performance", performanceDescriptor);
  }
});
