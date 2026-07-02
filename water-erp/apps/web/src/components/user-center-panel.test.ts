import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/components/user-center-panel.tsx"), "utf8");

test("user center panel renders only when opened", () => {
  assert.match(
    source,
    /isOpen,\s*\n\s*onClose,/,
    "UserCenterPanel should accept an isOpen prop",
  );
  assert.match(
    source,
    /if \(!isOpen\) \{\s*return null;\s*\}/,
    "UserCenterPanel should render nothing while closed",
  );
});
