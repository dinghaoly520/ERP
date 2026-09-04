import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RegistrationField } from "../registration/registration-shell";

test("registration fields associate visible labels and persistent errors with their controls", () => {
  const markup = renderToStaticMarkup(
    <RegistrationField id="register-company-name" label="公司名称" required error="请输入企业名称">
      <input type="text" />
    </RegistrationField>,
  );

  assert.match(markup, /<label[^>]*for="register-company-name"/);
  assert.match(markup, /<input[^>]*id="register-company-name"/);
  assert.match(markup, /<input[^>]*aria-invalid="true"/);
  assert.match(markup, /<input[^>]*aria-describedby="register-company-name-error"/);
  assert.match(markup, /id="register-company-name-error"[^>]*role="alert"/);
});
