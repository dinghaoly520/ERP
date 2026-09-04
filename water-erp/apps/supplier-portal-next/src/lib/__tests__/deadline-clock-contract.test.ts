import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const submissionSource = readFileSync(
  resolve("src/app/(main)/bids/[id]/submit/page.tsx"),
  "utf8",
);
const quoteSource = readFileSync(
  resolve("src/app/(main)/bids/[id]/round-quote/page.tsx"),
  "utf8",
);

test("submission and round-quote deadlines use the synchronized server clock", () => {
  assert.match(submissionSource, /serverNowMs\(\)/);
  assert.doesNotMatch(submissionSource, /new Date\(project\.deadline\) > new Date\(\)/);
  assert.doesNotMatch(submissionSource, /d > new Date\(\)/);
  assert.match(quoteSource, /serverNowMs\(\)/);
  assert.doesNotMatch(quoteSource, /new Date\(\) > new Date\(r\.deadline\)/);
});
