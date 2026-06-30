import test from "node:test";
import assert from "node:assert/strict";

import { fetchProgressStats } from "./progress";

test("progress API uses the Next.js /api proxy by default", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        totalActive: 0,
        stageDistribution: [],
        projects: [],
        monthlyAdded: 0,
        monthlyCompleted: 0,
        recentlyActive: 0,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    await fetchProgressStats();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestedUrl, "/api/progress/stats");
});
