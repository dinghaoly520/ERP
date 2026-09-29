import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/components/app-shell.tsx"), "utf8");

test("app shell renders AppUserActions instead of navigating to a missing /user-center route", () => {
  assert.doesNotMatch(
    source,
    /router\.push\(["']\/user-center["']\)/,
    "account button must not navigate to missing /user-center route",
  );
  assert.match(
    source,
    /import \{ AppUserActions \}/,
    "AppShell should import the shared user actions component",
  );
  assert.match(
    source,
    /<AppUserActions \/>/,
    "AppShell should render AppUserActions (header default / mobile header fallback)",
  );
});
