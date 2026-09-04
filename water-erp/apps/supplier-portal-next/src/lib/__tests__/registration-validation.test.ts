import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstInvalidTemporaryRegistrationStep,
  getRegistrationDraftKey,
  validateLoginCredentials,
  type TemporaryRegistrationForm,
} from "../registration-validation";

const validTemporaryForm: TemporaryRegistrationForm = {
  invitationCode: "ABCDEFGH",
  password: "supplier2026",
  confirmPassword: "supplier2026",
  name: "四川示例水利设备有限公司",
  creditCode: "91510100MA6ABCDEFG",
  legalPerson: "张三",
  legalPersonIdCard: "51010419900101123X",
  registeredAddress: "成都市高新区",
  region: "四川省 / 成都市",
  displayName: "李四",
  phone: "13800138000",
  email: "supplier@example.com",
};

test("login validation forwards an existing 6-character password to the API", () => {
  assert.equal(validateLoginCredentials("91510100MA6ABCDEFG", "abc123"), null);
});

test("anonymous formal registration does not receive a recoverable draft key", () => {
  assert.equal(getRegistrationDraftKey(null), null);
  assert.equal(getRegistrationDraftKey(undefined), null);
  assert.equal(getRegistrationDraftKey("user-1"), "register:user-1");
});

test("temporary final submission revalidates earlier business-tag fields", () => {
  const result = firstInvalidTemporaryRegistrationStep(
    validTemporaryForm,
    ["水利工程"],
    {
      verifying: false,
      inviteVerified: true,
      inviteError: "",
      agreeAgreement: true,
    },
  );

  assert.equal(result?.step, 1);
  assert.equal(result?.errors.tags, "请至少选择 2 个业务标签");
});

test("temporary final submission accepts a complete four-stage registration", () => {
  const result = firstInvalidTemporaryRegistrationStep(
    validTemporaryForm,
    ["水利工程", "泵站设备"],
    {
      verifying: false,
      inviteVerified: true,
      inviteError: "",
      agreeAgreement: true,
    },
  );

  assert.equal(result, null);
});
