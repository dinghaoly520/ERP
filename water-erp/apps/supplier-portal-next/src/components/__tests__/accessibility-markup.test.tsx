import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SpPageHeroView, SpKpi } from "../sp-page-hero";
import { EmptyState, SpDialog, SpPagination, SpProgress, SpSwitch, SpTabPanel, SpTabs } from "../ui";

const uiSource = readFileSync(new URL("../ui.tsx", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
const announcementsSource = readFileSync(new URL("../../app/(main)/announcements/page.tsx", import.meta.url), "utf8");
const announcementDetailSource = readFileSync(new URL("../../app/(main)/announcements/[id]/page.tsx", import.meta.url), "utf8");
const openingHallSource = readFileSync(new URL("../../app/(main)/my-bids/[projectId]/opening-hall/page.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const bidStyles = readFileSync(new URL("../../styles/pages/bids.css", import.meta.url), "utf8");
const registrationStyles = readFileSync(new URL("../../styles/pages/register2.css", import.meta.url), "utf8");

function TestIcon() {
  return <svg aria-hidden="true" />;
}

function cssRule(source: string, selector: string) {
  const marker = `${selector} {`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing CSS rule: ${selector}`);

  const openingBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  assert.fail(`Unclosed CSS rule: ${selector}`);
}

test("SpPageHeroView renders the cgzxui page-hero card and keeps controls in one compact aside", () => {
  const defaultMarkup = renderToStaticMarkup(
    <SpPageHeroView
      icon={TestIcon}
      title="项目大厅"
      eyebrow="项目机会"
      sub="查看当前可参与项目"
      actions={<button type="button">刷新项目</button>}
    >
      <span>12 个项目</span>
    </SpPageHeroView>,
  );
  const nestedMarkup = renderToStaticMarkup(
    <SpPageHeroView icon={TestIcon} title="项目详情" headingLevel={3} />,
  );

  assert.match(defaultMarkup, /^<header class="page-hero sp-hero">/);
  assert.match(defaultMarkup, /class="page-hero__left"/);
  assert.match(defaultMarkup, /class="page-hero__icon" aria-hidden="true"/);
  assert.match(defaultMarkup, /<h1 class="page-hero__title">项目大厅<\/h1>/);
  assert.match(defaultMarkup, /<p class="page-hero__sub">查看当前可参与项目<\/p>/);
  assert.match(defaultMarkup, /<div class="page-hero__eyebrow">项目机会<\/div>/);
  assert.match(
    defaultMarkup,
    /<div class="page-hero__right sp-hero__aside">[\s\S]*12 个项目[\s\S]*刷新项目[\s\S]*<\/div><\/div><\/header>$/,
  );
  assert.match(nestedMarkup, /<h3 class="page-hero__title">项目详情<\/h3>/);
});

test("EmptyState groups copy and actions in a compact status region", () => {
  const markup = renderToStaticMarkup(
    <EmptyState icon={TestIcon} title="暂无合同" desc="成交后将在此显示合同">
      <button type="button">上传合同</button>
    </EmptyState>,
  );

  assert.match(markup, /^<div class="sp-empty-panel" role="status">/);
  assert.match(markup, /<div class="sp-empty-icon" aria-hidden="true">/);
  assert.match(
    markup,
    /<div class="sp-empty-copy"><div class="sp-empty-text">暂无合同<\/div><div class="sp-empty-desc">成交后将在此显示合同<\/div><\/div>/,
  );
  assert.match(markup, /<div class="sp-empty-actions"><button type="button">上传合同<\/button><\/div>/);
});

test("EmptyState can announce recoverable loading failures as alerts", () => {
  const markup = renderToStaticMarkup(
    <EmptyState role="alert" icon={TestIcon} title="开标大厅加载失败" />,
  );

  assert.match(markup, /^<div class="sp-empty-panel" role="alert">/);
  assert.equal((openingHallSource.match(/<EmptyState[^>]*role="alert"/g) ?? []).length, 2);
});

test("page hero card keeps cgzxui neumorphic treatment while empty state stays flat and dense", () => {
  const heroRule = cssRule(globalStyles, ".page-hero");
  const emptyRule = cssRule(globalStyles, ".sp-empty-panel");

  // hero 卡：渐变底 + 方向性双影 + 内高光，无外框线
  assert.match(heroRule, /linear-gradient\(/);
  assert.match(heroRule, /inset 0 1px 0 oklch\(1 0 0/);
  assert.match(heroRule, /2px 2px 8px oklch\(0\.55 0\.03 258 \/ 0\.1\)/);
  assert.match(heroRule, /border:\s*none/);

  // 空态保持平面紧凑
  assert.match(emptyRule, /background:\s*transparent/);
  assert.match(emptyRule, /box-shadow:\s*none/);
  assert.match(emptyRule, /border-radius:\s*0/);
  assert.match(emptyRule, /padding:\s*28px 20px/);
  assert.doesNotMatch(emptyRule, /48px|min-height:\s*(?:[2-9]\d{2,}|100vh|50vh)/);
  assert.match(globalStyles, /@media \(max-width:\s*768px\)/);
  assert.match(globalStyles, /\.sp-empty-actions\s+:is\(button,\s*a\)\s*\{/);
});

test("bid page styles do not override the shared compact empty-state copy spacing", () => {
  const emptyRule = cssRule(globalStyles, ".sp-empty-panel");

  assert.match(emptyRule, /min-height:\s*120px/);
  assert.doesNotMatch(bidStyles, /(?:^|\n)\.sp-empty-(?:text|desc)\s*\{/);
});

test("hero statistics render as cgzxui accent pills inside the hero card", () => {
  const statisticRule = cssRule(globalStyles, ".page-hero__stat");

  assert.match(statisticRule, /border-radius:\s*999px/);
  assert.match(statisticRule, /color-mix\(in oklch, var\(--accent\)/);
});

test("hero titles safely wrap long project and announcement titles", () => {
  const titleRule = cssRule(globalStyles, ".sp-hero .page-hero__title");

  assert.match(titleRule, /overflow-wrap:\s*anywhere/);
});

test("announcement detail reserves the single h1 for the announcement title", () => {
  assert.equal((announcementDetailSource.match(/<h1(?:\s|>)/g) ?? []).length, 1);
  assert.match(announcementDetailSource, /<SpPageHero[^>\n]*headingLevel=\{2\}[^>\n]*\/>/);
  assert.match(announcementDetailSource, /<h1 className="detail-title">\{announcement\.title\}<\/h1>/);
});

test("SpKpi uses a native button only when it is interactive", () => {
  const interactiveMarkup = renderToStaticMarkup(
    <SpKpi label="待办" value={3} onClick={() => undefined} />,
  );
  const staticMarkup = renderToStaticMarkup(<SpKpi label="总数" value={8} />);

  assert.match(interactiveMarkup, /^<button[^>]*type="button"/);
  assert.doesNotMatch(interactiveMarkup, /role="button"/);
  assert.match(staticMarkup, /^<div/);
});

test("SpSwitch exposes a meaningful accessible name", () => {
  const markup = renderToStaticMarkup(
    <SpSwitch checked onChange={() => undefined} ariaLabel="设为主要联系人" />,
  );

  assert.match(markup, /role="switch"/);
  assert.match(markup, /aria-checked="true"/);
  assert.match(markup, /aria-label="设为主要联系人"/);
});

test("SpDialog connects its title and description to the modal", () => {
  const markup = renderToStaticMarkup(
    <SpDialog open onClose={() => undefined} title="提交确认" subtitle="请核对信息">
      <button type="button">确认</button>
    </SpDialog>,
  );
  const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)?.[1];
  const describedBy = markup.match(/aria-describedby="([^"]+)"/)?.[1];

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.ok(labelledBy);
  assert.ok(describedBy);
  assert.match(markup, new RegExp(`<h2[^>]*id="${labelledBy}"`));
  assert.match(markup, new RegExp(`<p[^>]*id="${describedBy}"`));
  assert.match(markup, /tabindex="-1"/);
});

test("password reset dialog restores focus and public-page actions keep 44px targets", () => {
  assert.match(uiSource, /returnFocusRef\?\.current/);
  assert.match(uiSource, /previouslyFocused\.focus\(\{ preventScroll: true \}\)/);
  assert.match(loginSource, /ref=\{passwordResetTriggerRef\}/);
  assert.match(loginSource, /returnFocusRef=\{passwordResetTriggerRef\}/);
  assert.match(globalStyles, /\.lp-foot-pill\s*\{[\s\S]{0,160}?min-height:\s*44px/);
  assert.match(globalStyles, /\.reg-step\s*\{[\s\S]{0,260}?min-width:\s*44px/);
  assert.match(registrationStyles, /\.reg-page \.reg-foot-link\s*\{\s*min-height:\s*44px/);
  assert.match(registrationStyles, /\.reg-form \.pwd-eye\s*\{[\s\S]{0,240}?width:\s*44px;[\s\S]{0,40}?height:\s*44px/);
});

test("SpTabs exposes tablist and selected-tab semantics", () => {
  const softMarkup = renderToStaticMarkup(
    <SpTabs
      value="pending"
      onChange={() => undefined}
      ariaLabel="申请状态"
      tabs={[
        { value: "pending", label: "待审核" },
        { value: "approved", label: "已通过", count: 2 },
      ]}
    />,
  );
  const lineMarkup = renderToStaticMarkup(
    <SpTabs
      value="platform"
      onChange={() => undefined}
      ariaLabel="合同数据来源"
      variant="line"
      tabs={[
        {
          value: "platform",
          label: "平台合同",
          tabId: "contracts-platform-tab",
          panelId: "contracts-platform-panel",
        },
        {
          value: "archive",
          label: "企业自存档案",
          tabId: "contracts-archive-tab",
          panelId: "contracts-archive-panel",
        },
      ]}
    />,
  );

  assert.match(softMarkup, /role="tablist"/);
  assert.match(softMarkup, /aria-label="申请状态"/);
  assert.match(softMarkup, /aria-orientation="horizontal"/);
  assert.equal((softMarkup.match(/role="tab"/g) ?? []).length, 2);
  assert.match(softMarkup, /aria-selected="true"[^>]*tabindex="0"/);
  assert.match(softMarkup, /aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(softMarkup, /class="neu-tab-bar"/);
  assert.doesNotMatch(softMarkup, /sp-tabs-line|sp-tab-line/);

  assert.match(lineMarkup, /^<div class="neu-tab-bar sp-tabs-line"/);
  assert.match(
    lineMarkup,
    /id="contracts-platform-tab"[^>]*aria-controls="contracts-platform-panel"/,
  );
  assert.match(
    lineMarkup,
    /id="contracts-archive-tab"[^>]*aria-controls="contracts-archive-panel"/,
  );
  assert.equal((lineMarkup.match(/class="neu-tab sp-tab-line/g) ?? []).length, 2);

  const linkedPanelsMarkup = renderToStaticMarkup(
    <>
      <SpTabs
        value="platform"
        onChange={() => undefined}
        tabs={[
          { value: "platform", label: "平台合同", tabId: "linked-platform-tab", panelId: "linked-platform-panel" },
          { value: "archive", label: "企业自存档案", tabId: "linked-archive-tab", panelId: "linked-archive-panel" },
        ]}
      />
      <SpTabPanel id="linked-platform-panel" labelledBy="linked-platform-tab" active>
        <p>平台域内容</p>
      </SpTabPanel>
      <SpTabPanel id="linked-archive-panel" labelledBy="linked-archive-tab" active={false}>
        <p>档案域内容</p>
      </SpTabPanel>
    </>,
  );
  const switchedPanelsMarkup = renderToStaticMarkup(
    <>
      <SpTabPanel id="linked-platform-panel" labelledBy="linked-platform-tab" active={false}>
        <p>平台域内容</p>
      </SpTabPanel>
      <SpTabPanel id="linked-archive-panel" labelledBy="linked-archive-tab" active>
        <p>档案域内容</p>
      </SpTabPanel>
    </>,
  );

  for (const panelId of linkedPanelsMarkup.matchAll(/aria-controls="([^"]+)"/g)) {
    assert.match(linkedPanelsMarkup, new RegExp(`id="${panelId[1]}"`));
  }
  assert.match(linkedPanelsMarkup, /id="linked-archive-panel"[^>]*hidden=""/);
  assert.match(linkedPanelsMarkup, />平台域内容</);
  assert.doesNotMatch(linkedPanelsMarkup, />档案域内容</);
  assert.match(switchedPanelsMarkup, /id="linked-platform-panel"[^>]*hidden=""/);
  assert.doesNotMatch(switchedPanelsMarkup, />平台域内容</);
  assert.match(switchedPanelsMarkup, />档案域内容</);
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
    assert.match(uiSource, new RegExp(`case "${key}"`));
  }
});

test("SpTabs exposes filter groups without pretending they control tab panels", () => {
  const markup = renderToStaticMarkup(
    <SpTabs
      value="all"
      onChange={() => undefined}
      ariaLabel="公告类型"
      semantics="filter"
      tabs={[
        { value: "all", label: "全部" },
        { value: "procurement", label: "采购公告" },
      ]}
    />,
  );

  assert.match(markup, /^<div class="neu-tab-bar" role="group" aria-label="公告类型">/);
  assert.equal((markup.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((markup.match(/aria-pressed="false"/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /role="tab"|aria-selected|aria-controls|aria-orientation/);
  assert.match(announcementsSource, /<SpTabs[\s\S]{0,220}?semantics="filter"/);
});

test("SpPagination uses a labelled navigation region and labelled icon buttons", () => {
  const markup = renderToStaticMarkup(
    <SpPagination page={2} pageSize={10} total={30} onChange={() => undefined} />,
  );

  assert.match(markup, /^<nav[^>]*aria-label="分页导航"/);
  assert.match(markup, /aria-label="上一页"/);
  assert.match(markup, /aria-label="下一页"/);
});

test("SpProgress announces a clamped determinate value", () => {
  const markup = renderToStaticMarkup(<SpProgress value={125} label="响应文件上传进度" />);

  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-label="响应文件上传进度"/);
  assert.match(markup, /aria-valuemin="0"/);
  assert.match(markup, /aria-valuemax="100"/);
  assert.match(markup, /aria-valuenow="100"/);
  assert.match(markup, /width:100%/);
});
