import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { normalizeAnnouncementContentHtml } from "./announcement-prose.ts";

test("公文排版：粘连标题拆分居中 + 「一、」节标题加粗标记 + 正文段落保留", () => {
  const html = "<p><strong>电梯维保服务项目</strong><strong>询比采购公告</strong>四川水发兴川置业管理有限公司拟采用询比方式采购，现公示如下：</p>"
    + "<p>一、项目信息</p>"
    + "<p>采 购 人：四川水发兴川置业管理有限公司</p>";
  const out = normalizeAnnouncementContentHtml(html, "电梯维保服务项目询比采购公告");
  assert.ok(out.includes('<p class="ann-prose-title">电梯维保服务项目询比采购公告</p>'), out);
  assert.ok(out.includes("<p>四川水发兴川置业管理有限公司拟采用询比方式采购，现公示如下：</p>"), out);
  assert.ok(out.includes('<p class="ann-prose-h">一、项目信息</p>'), out);
  assert.ok(out.includes("<p>采 购 人：四川水发兴川置业管理有限公司</p>"), out);
});

test("既有归一不回归：监督块粘连断行 + 空白段剔除照常生效", () => {
  const html = "<p>监督部门：兴川置业党支部联系人：邓云玲</p><p>　</p><p>正文</p>";
  const out = normalizeAnnouncementContentHtml(html);
  assert.ok(out.includes("监督部门：兴川置业党支部<br/>联系人：邓云玲"), out);
  assert.ok(!out.includes("　</p>"), out);
});

test("首段与标题非前缀关系（异构存量）→ 不猜测、原样返回；无 <p> 纯文本直通", () => {
  const html = "<p>正文与标题无关</p><p>一、项目信息</p>";
  const out = normalizeAnnouncementContentHtml(html, "某公告标题");
  assert.ok(!out.includes("ann-prose-title"), out);
  const plain = normalizeAnnouncementContentHtml("纯文本无段落", "标题");
  assert.equal(plain, "纯文本无段落");
});
