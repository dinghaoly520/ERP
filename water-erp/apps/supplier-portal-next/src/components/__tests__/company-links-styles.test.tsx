import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * 组件源码守卫（2026-10-19）：公司归属页/弹窗使用的 clq-* 类必须在 globals.css 有定义。
 * 背景：Turbopack 陈旧 CSS chunk 事故（页面类名在、样式全丢，正文卡片裸奔）——
 * tsc/单测都不覆盖「markup 类名 ↔ CSS 定义」漂移，本守卫在源码层锁住。
 */
const ROOT = process.cwd();
const consumers = [
  "src/app/(main)/profile/company-links/page.tsx",
  "src/components/shell/company-links-dialog.tsx",
];
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

const used = new Set<string>();
for (const rel of consumers) {
  const src = readFileSync(join(ROOT, rel), "utf8");
  for (const m of src.matchAll(/clq-[a-z0-9-]+/g)) used.add(m[0]);
}
assert.ok(used.size > 0, "未提取到任何 clq-* 类——消费文件路径可能变了，请同步本测试");

const missing = [...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(css));

test("公司归属 clq-* 类名在 globals.css 全部有定义", () => {
  assert.deepEqual(
    missing,
    [],
    `以下类名在 markup 中使用但 globals.css 未定义（Turbopack 缓存事故的源码面防线）：${missing.join(", ")}`,
  );
});
