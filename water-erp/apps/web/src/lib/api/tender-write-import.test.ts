import test from "node:test";
import assert from "node:assert/strict";

import { importAutofill } from "./tender-write-import";

test("importAutofill bypasses /api proxy for LAN multipart uploads", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const file = new File(["demo"], "资料.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  process.env.NEXT_PUBLIC_API_BASE_URL = "/api";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "192.168.1.111",
      },
    },
  });

  let capturedInput: RequestInfo | URL | undefined;
  let capturedBody: BodyInit | null | undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedInput = input;
    capturedBody = init?.body;

    return new Response(
      JSON.stringify({ documentType: "INTERNAL_BIDDING", files: [], fields: [] }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    await importAutofill("INTERNAL_BIDDING", [file]);

    assert.equal(
      capturedInput,
      "http://192.168.1.111:4000/api/tender-write/import-autofill",
    );
    assert.ok(capturedBody instanceof FormData);
    assert.equal((capturedBody as FormData).get("files"), file);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalBase === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalBase;
    }

    if (originalWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});
