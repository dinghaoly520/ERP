import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const uploadSource = readFileSync(resolve("src/lib/api/upload.ts"), "utf8");
const registrationSource = readFileSync(resolve("src/app/register/page.tsx"), "utf8");

test("formal registration uses the SMS-gated registration upload endpoint", () => {
  // 端点 = UPLOAD_BASE（dev 直连 apiOrigin()/api，生产同源 /api）+ /upload/registration 模板字符串
  assert.match(uploadSource, /`\$\{UPLOAD_BASE\}\/upload\/registration`/);
  assert.doesNotMatch(uploadSource, /UPLOAD_BASE\/upload\?/);
  assert.match(registrationSource, /uploadRegistrationFile/);
  assert.doesNotMatch(registrationSource, /await uploadFile\(file/);
});
