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

test("库内标题与正文粘连前缀不一致（列表标题带前缀）→ 形态启发式按首个「公告」边界拆分", () => {
  const html = "<p><strong>便携式全液压岩心钻机（800型）采购</strong><strong>谈判采购公告</strong>四川水发勘测设计研究有限公司采用竞争性谈判方式采购，现公示如下：</p>"
    + "<p>一、项目信息</p>";
  // 列表标题带「谈判文件公告 — 」前缀，与正文粘连串不相等 → 走启发式
  const out = normalizeAnnouncementContentHtml(html, "谈判文件公告 — 便携式全液压岩心钻机（800型）采购");
  assert.ok(out.includes('<p class="ann-prose-title">便携式全液压岩心钻机（800型）采购谈判采购公告</p>'), out);
  assert.ok(out.includes("<p>四川水发勘测设计研究有限公司采用竞争性谈判方式采购，现公示如下：</p>"), out);
  assert.ok(out.includes('<p class="ann-prose-h">一、项目信息</p>'), out);
});

test("启发式形态校验防误拆：候选过短/含标点/正文段先于标题 → 不拆", () => {
  // 候选标题（至首个「公告」）不足 8 字 → 不拆
  const short = normalizeAnnouncementContentHtml("<p>发公告了各位注意查收</p>", "别的标题");
  assert.ok(!short.includes("ann-prose-title"), short);
  // 候选内含逗号（正文形态）→ 不拆
  const comma = normalizeAnnouncementContentHtml("<p>按公告要求，请及时报名参加</p>", "别的标题");
  assert.ok(!comma.includes("ann-prose-title"), comma);
});

test("段内 br 编号项拆独立段落（首行缩进前提）；非编号续行保持 br", () => {
  const html = "<p>3、工期及进度要求：<br/>1）合同签订之日起供货。<br/>2）到货后安装。<br/>尾部说明无编号</p>";
  const out = normalizeAnnouncementContentHtml(html, null);
  // 编号行拆为独立 <p>（各获首行缩进）
  assert.ok(out.includes("<p>3、工期及进度要求：</p>"), out);
  assert.ok(out.includes("<p>1）合同签订之日起供货。</p>"), out);
  assert.ok(out.includes("<p>2）到货后安装。<br/>尾部说明无编号</p>"), out);
  // 无编号续行保持 br（不拆段）
  assert.ok(out.includes("<br/>尾部说明无编号"), out);
});

test("句内粘连拆段（存量兜底）：句末短标签与句点式编号项各自成段、序号归一 1）", () => {
  const html = "<p>报名方式：访问https://ssyc.scsfjt.com供应商门户进行注册、查询项目、确认投标意向和文件投递。资格条件：1.持有有效营业执照；2.未被列入名单。</p>";
  const out = normalizeAnnouncementContentHtml(html, null);
  assert.ok(out.includes("文件投递。</p><p>资格条件：</p>"), out);
  assert.ok(out.includes("<p>1）持有有效营业执照；</p>"), out);
  assert.ok(out.includes("<p>2）未被列入名单。</p>"), out);
  assert.ok(out.includes("https://ssyc.scsfjt.com"), out);
});

test("句内拆段防误伤：小数（873000.00）与「第3、4章」不拆", () => {
  const out = normalizeAnnouncementContentHtml("<p>采购预算873000.00元，评审按第3、4章执行。</p>", null);
  assert.ok(out.includes("873000.00元"), out);
  assert.ok(out.includes("第3、4章"), out);
  assert.ok(!out.includes("</p><p>"), out);
});

test("首段与标题非前缀关系（异构存量）→ 不猜测、原样返回；无 <p> 纯文本直通", () => {
  const html = "<p>正文与标题无关</p><p>一、项目信息</p>";
  const out = normalizeAnnouncementContentHtml(html, "某公告标题");
  assert.ok(!out.includes("ann-prose-title"), out);
  const plain = normalizeAnnouncementContentHtml("纯文本无段落", "标题");
  assert.equal(plain, "纯文本无段落");
});
