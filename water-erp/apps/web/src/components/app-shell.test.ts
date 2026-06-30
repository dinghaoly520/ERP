import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/components/app-shell.tsx"), "utf8");

test("sidebar account button opens the user center panel instead of navigating to a missing route", () => {
  assert.doesNotMatch(
    source,
    /router\.push\(["']\/user-center["']\)/,
    "account button must not navigate to missing /user-center route",
  );
  assert.match(
    source,
    /<UserCenterPanel[\s\S]*isOpen=/,
    "AppShell should render the existing user center panel",
  );
});
