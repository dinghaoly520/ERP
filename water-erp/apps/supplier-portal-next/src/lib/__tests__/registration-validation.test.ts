import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getRegistrationDraftKey,
  validateLoginCredentials,
} from "../registration-validation";

test("login validation forwards an existing 6-character password to the API", () => {
  assert.equal(validateLoginCredentials("91510100MA6ABCDEFG", "abc123"), null);
});

test("anonymous formal registration does not receive a recoverable draft key", () => {
  assert.equal(getRegistrationDraftKey(null), null);
  assert.equal(getRegistrationDraftKey(undefined), null);
  assert.equal(getRegistrationDraftKey("user-1"), "register:user-1");
});
