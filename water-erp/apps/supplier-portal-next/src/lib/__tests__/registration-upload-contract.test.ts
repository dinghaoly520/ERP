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

test("注册会话 token 主轨（2026-10-09）：步骤 0 验证换发 token，上传与提交凭 token 走完全程", () => {
  // upload.ts：凭证装配 token 优先，phone+code 兼容回落（验证前步骤 0 传 logo）
  assert.match(uploadSource, /fd\.append\("token", registration\.token\.trim\(\)\)/);
  assert.match(uploadSource, /fd\.append\("phone", \(registration\.phone \?\? ""\)\.trim\(\)\)/);
  // 注册页：步骤 0 「下一步」服务端验证换发会话；5 处上传凭证统一走 regUploadCredentials()
  assert.match(registrationSource, /authApi\.verifyRegistrationCode/);
  assert.match(registrationSource, /const regUploadCredentials = useCallback/);
  assert.doesNotMatch(registrationSource, /credentials=\{\{ phone: registrationPhone, code: registrationCode \}\}/);
  // 提交带 registrationToken（主轨）；验证失效错误引导回步骤 0
  assert.match(registrationSource, /registrationToken: regSession\?\.token/);
  assert.match(registrationSource, /REGISTRATION_SESSION_EXPIRED/);
});
