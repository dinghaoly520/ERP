import test from "node:test";
import assert from "node:assert/strict";

import { fetchProjectManagementList } from "./project-management";

test("project management API uses the Next.js /api proxy by default", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await fetchProjectManagementList();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestedUrl, "/api/project-management");
});
