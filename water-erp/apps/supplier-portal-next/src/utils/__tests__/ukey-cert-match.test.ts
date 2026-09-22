import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCn, formatCertDn, isOwnCert } from "../ukey-cert-match";

test("formatCertDn：CN+O 完整 DN → 主体/签发机构术语（C=CN 噪声省略）", () => {
  assert.equal(
    formatCertDn("CN=四川省第十二地质大队,O=蜀水云采模拟CA,C=CN"),
    "证书主体：四川省第十二地质大队 · 签发机构：蜀水云采模拟CA",
  );
});

test("formatCertDn：仅 CN（旧绑定脚本口径）不拼空的签发机构", () => {
  assert.equal(formatCertDn("CN=重庆蜀通岩土工程有限公司"), "证书主体：重庆蜀通岩土工程有限公司");
});

test("formatCertDn：无 CN（解析不出）回退原串", () => {
  assert.equal(formatCertDn("some-legacy-name"), "some-legacy-name");
  assert.equal(formatCertDn(""), "");
});

test("formatCertDn：键值大小写与逗号后空格宽容", () => {
  assert.equal(
    formatCertDn("cn= 四川水发建设有限公司 , o= 蜀水云采模拟CA , C=CN"),
    "证书主体：四川水发建设有限公司 · 签发机构：蜀水云采模拟CA",
  );
});

test("extractCn / isOwnCert 既有口径不回归", () => {
  assert.equal(extractCn("CN=四川水发建设有限公司,O=蜀水云采模拟CA,C=CN"), "四川水发建设有限公司");
  assert.equal(isOwnCert("CN=四川水发建设有限公司,O=蜀水云采模拟CA,C=CN", "四川水发建设有限公司"), true);
  assert.equal(isOwnCert("CN=四川省第十二地质大队,O=蜀水云采模拟CA,C=CN", "四川水发建设有限公司"), false);
});
