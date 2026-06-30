import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeApiBaseUrl,
  parseJsonResponse,
  normalizeRequestErrorMessage,
} from "./auth";

test("normalizeApiBaseUrl adds a protocol for localhost-style values", () => {
  assert.equal(
    normalizeApiBaseUrl("localhost:4000/api"),
    "http://localhost:4000/api",
  );
});

test("normalizeRequestErrorMessage translates browser URL pattern failures", () => {
  assert.equal(
    normalizeRequestErrorMessage(
      new Error("The string did not match the expected pattern."),
    ),
    "接口地址配置无效，请检查前端环境变量 NEXT_PUBLIC_API_BASE_URL。",
  );
});

test("parseJsonResponse converts plain-text 500 responses into a friendly message", async () => {
  await assert.rejects(
    () =>
      parseJsonResponse(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
      ),
    new Error("服务处理失败，请稍后重试。"),
  );
});
