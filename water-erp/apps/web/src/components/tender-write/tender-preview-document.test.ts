import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/components/tender-write/tender-preview-document.tsx"), "utf8");

test("preview filled values are styled blue instead of red", () => {
  assert.doesNotMatch(source, /text-red-600/);
  assert.match(source, /text-blue-600/);
});
