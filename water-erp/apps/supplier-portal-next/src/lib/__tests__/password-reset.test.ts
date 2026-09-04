import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePasswordResetRequest } from "../password-reset";

test("password reset request requires all identity contact fields", () => {
  assert.equal(
    validatePasswordResetRequest({
      username: "",
      applicantName: "张三",
      applicantContact: "13800138000",
      verificationCode: "123456",
      newPassword: "Pass1234",
      confirmPassword: "Pass1234",
    }),
    "请输入需要重置的账号",
  );
  assert.equal(
    validatePasswordResetRequest({
      username: "supplier",
      applicantName: "",
      applicantContact: "13800138000",
      verificationCode: "123456",
      newPassword: "Pass1234",
      confirmPassword: "Pass1234",
    }),
    "请输入申请人姓名",
  );
  assert.equal(
    validatePasswordResetRequest({
      username: "supplier",
      applicantName: "张三",
      applicantContact: "",
      verificationCode: "123456",
      newPassword: "Pass1234",
      confirmPassword: "Pass1234",
    }),
    "请输入申请人手机号码",
  );
  assert.equal(
    validatePasswordResetRequest({
      username: "supplier",
      applicantName: "张三",
      applicantContact: "13800138000",
      verificationCode: "123456",
      newPassword: "short",
      confirmPassword: "short",
    }),
    "新密码须至少 8 位且包含字母与数字",
  );
  assert.equal(
    validatePasswordResetRequest({
      username: "supplier",
      applicantName: "张三",
      applicantContact: "13800138000",
      verificationCode: "",
      newPassword: "Pass1234",
      confirmPassword: "Pass1234",
    }),
    "请输入短信验证码",
  );
  assert.equal(
    validatePasswordResetRequest({
      username: "supplier",
      applicantName: "张三",
      applicantContact: "13800138000",
      verificationCode: "abc",
      newPassword: "Pass1234",
      confirmPassword: "Pass1234",
    }),
    "验证码应为6位数字",
  );
  assert.equal(
    validatePasswordResetRequest({
      username: "supplier",
      applicantName: "张三",
      applicantContact: "13800138000",
      verificationCode: "123456",
      newPassword: "Pass1234",
      confirmPassword: "pass1234",
    }),
    "两次输入的密码不一致",
  );
  assert.equal(
    validatePasswordResetRequest({
      username: " supplier ",
      applicantName: " 张三 ",
      applicantContact: " 13800138000 ",
      verificationCode: "123456",
      newPassword: "Pass1234",
      confirmPassword: "Pass1234",
    }),
    null,
  );
  assert.equal(
    validatePasswordResetRequest({
      username: "supplier",
      applicantName: "张三",
      applicantContact: "01234567890",
      verificationCode: "123456",
      newPassword: "Pass1234",
      confirmPassword: "Pass1234",
    }),
    "联系方式必须是11位大陆手机号",
  );
});
