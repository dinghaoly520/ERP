import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const registerSource = readFileSync(
  new URL("../../app/register/page.tsx", import.meta.url),
  "utf8",
);

test("registration logo preview stays local instead of loading the protected asset URL", () => {
  assert.match(registerSource, /const \[logoPreviewUrl, setLogoPreviewUrl\] = useState\(""\)/);
  assert.match(registerSource, /<img src=\{logoPreviewUrl\}/);
  assert.doesNotMatch(registerSource, /<img src=\{basic\.logoUrl\}/);
  assert.match(registerSource, /revokeObjectUrlPreview\(logoPreviewUrlRef\.current\)/);
});

test("logo upload trigger uses a native keyboard-operable button", () => {
  assert.match(
    registerSource,
    /<button type="button" className="reg-logo-drop"[\s\S]{0,100}?onClick=\{\(\) => logoInputRef\.current\?\.click\(\)\}/,
  );
  assert.match(registerSource, /aria-label=\{basic\.logoUrl \? "更换公司 logo" : "上传公司 logo"\}/);
});
