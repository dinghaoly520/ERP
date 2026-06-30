import test from "node:test";
import assert from "node:assert/strict";

import { aiBidAnalysisApi } from "./ai-bid-analysis";

test("uploadTenderFile uses configured API base URL for multipart upload", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const file = new File(["demo"], "tender.pdf", { type: "application/pdf" });

  process.env.NEXT_PUBLIC_API_BASE_URL = "http://192.168.1.111:4000/api";

  let capturedInput: RequestInfo | URL | undefined;
  let capturedMethod: string | undefined;
  let capturedCredentials: RequestCredentials | undefined;
  let capturedBody: BodyInit | null | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedInput = input;
    capturedMethod = init?.method;
    capturedCredentials = init?.credentials;
    capturedBody = init?.body;

    return new Response(JSON.stringify({ success: true, fileName: "tender.pdf" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await aiBidAnalysisApi.uploadTenderFile("task-123", file);

    assert.deepEqual(result, { success: true, fileName: "tender.pdf" });
    assert.equal(
      capturedInput,
      "http://192.168.1.111:4000/api/ai-bid-analysis/tasks/task-123/tender",
    );
    assert.equal(capturedMethod, "POST");
    assert.equal(capturedCredentials, "include");
    assert.ok(capturedBody instanceof FormData);
    assert.equal((capturedBody as FormData).get("file"), file);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalBase === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalBase;
    }
  }
});

test("uploadBidderFile uses configured API base URL for multipart upload", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const file = new File(["demo"], "bid.pdf", { type: "application/pdf" });

  process.env.NEXT_PUBLIC_API_BASE_URL = "http://192.168.1.111:4000/api";

  let capturedInput: RequestInfo | URL | undefined;
  let capturedBody: BodyInit | null | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedInput = input;
    capturedBody = init?.body;

    return new Response(JSON.stringify({ success: true, fileName: "bid.pdf" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await aiBidAnalysisApi.uploadBidderFile("task-123", "bidder-456", file);

    assert.deepEqual(result, { success: true, fileName: "bid.pdf" });
    assert.equal(
      capturedInput,
      "http://192.168.1.111:4000/api/ai-bid-analysis/tasks/task-123/bidders/bidder-456/file",
    );
    assert.ok(capturedBody instanceof FormData);
    assert.equal((capturedBody as FormData).get("file"), file);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalBase === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalBase;
    }
  }
});
