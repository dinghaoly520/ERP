import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const uploadSource = readFileSync(resolve("src/lib/api/upload.ts"), "utf8");
const registrationSource = readFileSync(resolve("src/app/register/page.tsx"), "utf8");

test("formal registration uses the SMS-gated registration upload endpoint", () => {
  // 2026-09-10 起端点走 UPLOAD_BASE（dev=apiOrigin()/api 直连、prod=/api 同源代理），字面量断言改为路径段
  assert.match(uploadSource, /\/upload\/registration/);
  assert.doesNotMatch(uploadSource, /UPLOAD_BASE\/upload\?/);
  assert.match(registrationSource, /uploadRegistrationFile/);
  assert.doesNotMatch(registrationSource, /await uploadFile\(file/);
});
