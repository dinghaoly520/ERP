import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const registerSource = readFileSync(
  new URL("../../app/register/page.tsx", import.meta.url),
  "utf8",
);

test("MultiFiles 预览 objectURL 不因后续上传被过早回收（2026-10-09 回归锁定）", () => {
  // 卸载统一回收（ref 快照）必须存在；依赖数组挂整个 map 的写法会把仍在引用的旧 URL revoke
  assert.match(registerSource, /const previewsRef = useRef\(localPreviews\);/);
  assert.match(
    registerSource,
    /useEffect\(\(\) => \(\) => \{ Object\.values\(previewsRef\.current\)\.forEach\(\(u\) => URL\.revokeObjectURL\(u\)\); \}, \[\]\);/,
  );
  assert.ok(!registerSource.includes("}, [localPreviews]);"));
});

test("MultiFiles 移除附件时即时回收对应预览 URL", () => {
  assert.match(registerSource, /delete next\[removedUrl\]/);
});

test("SingleFile 预览按钮在无本地副本时禁用并给出提示", () => {
  assert.match(registerSource, /disabled=\{busy \|\| !localPreview\}/);
  assert.ok(registerSource.includes("重新上传后可预览"));
});

test("注册资金输入：数字清洗含前导零剥离 + 正数字校验", () => {
  assert.ok(registerSource.includes('replace(/^0+(?=\\d)/, "")'));
  assert.ok(registerSource.includes("注册资金须为正数字（最多两位小数）"));
});

test("身份证正反面：fileUrl=人像面 + attachments=国徽面 双必传", () => {
  assert.ok(registerSource.includes("attachments: legalIdBack ? [{ name: `${basic.legalPerson.trim()}·身份证国徽面（反面）`, url: legalIdBack }] : undefined"));
  assert.ok(registerSource.includes("请上传法定代表人身份证正面（人像面）"));
  assert.ok(registerSource.includes("请上传法定代表人身份证反面（国徽面）"));
});
