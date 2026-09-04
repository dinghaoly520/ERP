import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import dayjs from "dayjs";
import {
  getOwnArchiveStats,
  loadOwnArchiveRecords,
  OwnArchivesPanel,
} from "../../components/own-archives-panel";

const contractsSource = readFileSync(
  new URL("../../app/(main)/contracts/page.tsx", import.meta.url),
  "utf8",
);
const frameworksSource = readFileSync(
  new URL("../../app/(main)/frameworks/page.tsx", import.meta.url),
  "utf8",
);
const archivesSource = readFileSync(
  new URL("../../components/own-archives-panel.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);
const workspaceStyles = readFileSync(
  new URL("../../styles/pages/objections.css", import.meta.url),
  "utf8",
);

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

test("contract and framework workspaces use line tabs with linked exclusive panels", () => {
  for (const [source, contract] of [
    [contractsSource, {
      title: "合同履约",
      platformLabel: "平台合同",
      prefix: "contracts",
      ariaLabel: "合同数据来源",
      archiveNoun: "合同",
    }],
    [frameworksSource, {
      title: "框架协议",
      platformLabel: "入围协议",
      prefix: "frameworks",
      ariaLabel: "框架协议数据来源",
      archiveNoun: "框架协议",
    }],
  ] as const) {
    assert.match(source, new RegExp(`title="${contract.title}"`));
    assert.match(source, /useState<LocalRecordsView>\("platform"\)/);
    assert.match(source, /variant="line"/);
    assert.match(source, new RegExp(`ariaLabel="${contract.ariaLabel}"`));
    assert.match(source, new RegExp(`label: "${contract.platformLabel}"`));
    assert.match(source, /label: "企业自存档案"/);

    for (const view of ["platform", "archive"] as const) {
      assert.match(source, new RegExp(`tabId: "${contract.prefix}-${view}-tab"`));
      assert.match(source, new RegExp(`panelId: "${contract.prefix}-${view}-panel"`));
      assert.match(source, new RegExp(`<SpTabPanel[\\s\\S]{0,180}?id="${contract.prefix}-${view}-panel"`));
      assert.match(source, new RegExp(`labelledBy="${contract.prefix}-${view}-tab"`));
      assert.match(source, new RegExp(`active=\\{panels\\.${view}\\}`));
    }

    assert.doesNotMatch(source, /if \(error && !loading\)\s*\{?\s*return/);
    assert.doesNotMatch(source, /panels\.(?:platform|archive) && \(/);
    assert.match(source, /error && !loading/);
    assert.match(
      source,
      new RegExp(`<OwnArchivesPanel category="(?:contract|framework)" noun="${contract.archiveNoun}" embedded \\/>`),
    );
    assert.equal((source.match(/<EmptyState\b/g) ?? []).length, 1);
  }
});

test("contract dialogs remain mounted outside the selected data panel", () => {
  const archivePanel = contractsSource.indexOf('id="contracts-archive-panel"');
  const proofDialog = contractsSource.indexOf("<ProofUploadDialog");
  const satisfactionDialog = contractsSource.indexOf("<SatisfactionDialog");

  assert.ok(archivePanel >= 0);
  assert.ok(proofDialog > archivePanel);
  assert.ok(satisfactionDialog > proofDialog);
});

test("embedded own archives remove the outer module card and keep all archive actions", () => {
  const embeddedMarkup = renderToStaticMarkup(createElement(OwnArchivesPanel, {
    category: "contract",
    noun: "合同",
    embedded: true,
  }));
  const standaloneMarkup = renderToStaticMarkup(createElement(OwnArchivesPanel, {
    category: "contract",
    noun: "合同",
  }));

  assert.match(embeddedMarkup, /^<div class="oa-panel oa-panel-embedded">/);
  assert.doesNotMatch(embeddedMarkup.match(/^<div[^>]*>/)?.[0] ?? "", /\bsp-module\b/);
  assert.doesNotMatch(embeddedMarkup, /共 0 条 · 有效 0/);
  assert.match(embeddedMarkup, /数据加载中/);
  assert.match(standaloneMarkup, /^<div class="sp-module oa-panel">/);
  assert.match(archivesSource, /<EmptyState\b/);
  assert.doesNotMatch(archivesSource, /<div className="sp-empty-panel">/);
  for (const preservedAction of ["openCreate", "openEdit", "remove", "FilesInput"]) {
    assert.match(archivesSource, new RegExp(preservedAction));
  }
  assert.doesNotMatch(archivesSource, /className="reg-(?:files|file-chip|file-x|add-file)"/);
});

test("own archive load failures stay distinct from a genuine empty archive and can recover", async () => {
  const records = [{ id: "archive-1" }];
  const failedItems: unknown[] = [];
  const failedErrors: boolean[] = [];

  await loadOwnArchiveRecords(
    async () => { throw new Error("archive unavailable"); },
    (items) => failedItems.push(items),
    (hasError) => failedErrors.push(hasError),
  );

  assert.deepEqual(failedItems, [null]);
  assert.deepEqual(failedErrors, [false, true]);

  const recoveredItems: unknown[] = [];
  const recoveredErrors: boolean[] = [];
  await loadOwnArchiveRecords(
    async () => records,
    (items) => recoveredItems.push(items),
    (hasError) => recoveredErrors.push(hasError),
  );

  assert.deepEqual(recoveredItems, [null, records]);
  assert.deepEqual(recoveredErrors, [false]);
  assert.doesNotMatch(archivesSource, /catch\s*\{\s*setItems\(\[\]\)/);
  const errorBranch = archivesSource.match(
    /\{loadError\s*\?\s*\(([\s\S]*?)\)\s*:\s*items === null/,
  )?.[1] ?? "";
  assert.match(errorBranch, /role="alert"/);
  assert.match(errorBranch, /档案加载失败/);
  assert.match(errorBranch, /重新加载/);
});

test("own archive statistics treat records ending today as active and expiring", () => {
  assert.deepEqual(
    getOwnArchiveStats(
      [
        { endDate: "2026-09-02" },
        { endDate: "2026-09-03" },
        { endDate: "2026-12-03" },
        { endDate: null },
      ],
      dayjs("2026-09-03T20:00:00"),
    ),
    { total: 4, active: 3, expiring: 1 },
  );
});

test("own archive form uses explicit label relationships without nested labels", () => {
  assert.doesNotMatch(archivesSource, /<label className="reg-item">/);
  for (const field of ["title", "refCode", "counterparty", "amount", "signDate", "startDate", "endDate", "scope", "note"]) {
    assert.match(archivesSource, new RegExp(`htmlFor=\\{fieldIds\\.${field}\\}`));
    assert.match(archivesSource, new RegExp(`id=\\{fieldIds\\.${field}\\}`));
  }
  assert.match(archivesSource, /htmlFor=\{fieldIds\.files\}/);
  assert.match(archivesSource, /inputId=\{fieldIds\.files\}/);
  assert.match(archivesSource, /id=\{inputId\}/);
});

test("line tabs are flat, scrollable, focusable, and touch friendly", () => {
  const barRule = cssRule(globalStyles, ".neu-tab-bar.sp-tabs-line");
  const tabRule = cssRule(globalStyles, ".neu-tab.sp-tab-line");

  for (const rule of [barRule, tabRule]) {
    assert.match(rule, /background:\s*transparent/);
    assert.match(rule, /box-shadow:\s*none/);
    assert.match(rule, /border-radius:\s*0/);
    assert.doesNotMatch(rule, /gradient\(/);
  }
  assert.match(barRule, /border-bottom:\s*1px solid/);
  assert.match(barRule, /overflow-x:\s*auto/);
  assert.match(tabRule, /min-height:\s*44px/);
  assert.match(globalStyles, /\.neu-tab\.sp-tab-line\.is-active::after\s*\{/);
  assert.match(
    globalStyles,
    /\.neu-tab\.sp-tab-line:focus-visible\s*\{[\s\S]{0,160}?outline:\s*3px solid var\(--brand\)/,
  );
});

test("embedded archive layout stays flat and reflows without losing controls", () => {
  const panelRule = cssRule(workspaceStyles, ".oa-panel-embedded");
  const cardRule = cssRule(workspaceStyles, ".oa-panel-embedded .oa-card");

  for (const rule of [panelRule, cardRule]) {
    assert.match(rule, /background:\s*transparent/);
    assert.match(rule, /box-shadow:\s*none/);
    assert.match(rule, /border-radius:\s*0/);
    assert.doesNotMatch(rule, /gradient\(/);
  }
  assert.match(panelRule, /margin:\s*0/);
  assert.match(workspaceStyles, /\.dense-workspace-panel\s*\{[^}]*min-width:\s*0/);
  assert.match(workspaceStyles, /@media \(max-width:\s*680px\)[\s\S]*?\.oa-panel-embedded \.oa-card\s*\{[^}]*flex-direction:\s*column/);
  assert.match(workspaceStyles, /@media \(max-width:\s*680px\)[\s\S]*?\.oa-card-acts\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(workspaceStyles, /\.oa-card-title,[\s\S]{0,100}?\.oa-card-note\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(cssRule(workspaceStyles, ".oa-files"), /flex-wrap:\s*wrap/);
  assert.match(cssRule(workspaceStyles, ".oa-file-chip"), /max-width:\s*min\(100%,\s*260px\)/);
  assert.match(cssRule(workspaceStyles, ".oa-file-remove"), /background:\s*transparent/);
  assert.match(cssRule(workspaceStyles, ".oa-add-file"), /box-shadow:\s*none/);
  assert.match(workspaceStyles, /\.oa-file-(?:remove|chip):focus-visible,[\s\S]{0,100}?\.oa-add-file:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--brand\)/);
  assert.match(workspaceStyles, /@media \(max-width:\s*680px\)[\s\S]*?\.oa-add-file\s*\{[^}]*min-height:\s*44px/);
  assert.match(workspaceStyles, /@media \(max-width:\s*680px\)[\s\S]*?\.oa-file-chip\s*\{[^}]*min-height:\s*44px/);
  assert.match(workspaceStyles, /@media \(max-width:\s*680px\)[\s\S]*?\.oa-file-link\s*\{[^}]*min-height:\s*44px/);
  assert.match(globalStyles, /@media \(max-width:\s*768px\)[\s\S]*?\.gdlg-x\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(globalStyles, /@media \(max-width:\s*768px\)[\s\S]*?\.gdlg-ft \.neu-btn-primary,[\s\S]{0,120}?\.gdlg-ft \.neu-btn-soft\s*\{[^}]*min-height:\s*44px/);
});
