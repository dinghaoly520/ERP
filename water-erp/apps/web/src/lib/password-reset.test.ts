import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePasswordResetRequest,
  validatePasswordResetRequest,
} from "./password-reset";

test("forgot-password reset requires a matching strong password", () => {
  const base = {
    username: "caigou",
    applicantName: "采购员",
    applicantContact: "13800000000",
    verificationCode: "123456",
    newPassword: "Water2026",
    confirmPassword: "Water2026",
  };

  assert.equal(validatePasswordResetRequest(base), null);
  assert.equal(validatePasswordResetRequest({ ...base, applicantContact: "1380000000" }), "联系方式必须是11位手机号。");
  assert.equal(validatePasswordResetRequest({ ...base, verificationCode: "" }), "请输入短信验证码。");
  assert.equal(validatePasswordResetRequest({ ...base, verificationCode: "abc123" }), "验证码应为6位数字。");
  assert.match(validatePasswordResetRequest({ ...base, newPassword: "12345678" }) ?? "", /字母和数字/);
  assert.match(validatePasswordResetRequest({ ...base, confirmPassword: "Water2027" }) ?? "", /不一致/);
});

test("forgot-password reset trims identity fields without changing password text", () => {
  assert.deepEqual(normalizePasswordResetRequest({
    username: "  caigou ",
    applicantName: " 采购员 ",
    applicantContact: " 13800000000 ",
    verificationCode: "123456",
    newPassword: " Water2026 ",
    confirmPassword: " Water2026 ",
  }), {
    username: "caigou",
    applicantName: "采购员",
    applicantContact: "13800000000",
    verificationCode: "123456",
    newPassword: " Water2026 ",
  });
});
