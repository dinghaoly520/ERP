import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const registerSource = readFileSync(
  new URL("../../app/register/page.tsx", import.meta.url),
  "utf8",
);

test("registration validates one primary contact bound to the SMS phone", () => {
  assert.match(registerSource, /const primaryContacts = contacts\.filter\(\(contact\) => contact\.isPrimary\)/);
  assert.match(registerSource, /primaryContacts\.length !== 1/);
  assert.match(registerSource, /primaryContacts\[0\]\.phone\.trim\(\) !== registrationPhone\.trim\(\)/);
  assert.match(registerSource, /主要联系人手机号须与注册验证手机号一致/);
});

test("choosing a primary contact clears the primary flag from other rows", () => {
  assert.match(
    registerSource,
    /isPrimary: j === i \? v : v \? false : x\.isPrimary/,
  );
});
