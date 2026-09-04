import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const uploadSource = readFileSync(resolve("src/lib/api/upload.ts"), "utf8");
const registrationSource = readFileSync(resolve("src/app/register/page.tsx"), "utf8");

test("formal registration uses the SMS-gated registration upload endpoint", () => {
  assert.match(uploadSource, /\/api\/upload\/registration/);
  assert.match(registrationSource, /uploadRegistrationFile/);
  assert.doesNotMatch(registrationSource, /await uploadFile\(file/);
});
