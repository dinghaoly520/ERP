import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("project and announcement rows expose native navigation links", () => {
  const bids = source("../../app/(main)/bids/page.tsx");
  const announcements = source("../../app/(main)/announcements/page.tsx");

  assert.match(bids, /import Link from "next\/link"/);
  assert.doesNotMatch(bids, /onClick=\{\(\) => router\.push/);
  assert.match(bids, /className="[^"]*opportunity-detail-link[^"]*"/);
  assert.match(bids, /aria-label=\{`查看项目 \$\{p\.name\}详情`\}/);
  assert.match(bids, /aria-label="搜索项目名称或编号"/);

  assert.match(announcements, /import Link from "next\/link"/);
  assert.doesNotMatch(announcements, /className="announcement-row" onClick=/);
  assert.match(announcements, /<Link[\s\S]*?className="announcement-row"/);
  assert.match(announcements, /aria-label=\{`查看公告：\$\{a\.title\}`\}/);
  assert.match(announcements, /neu-segment[\s\S]*?aria-label="公告类型"/);
  assert.match(announcements, /aria-label="搜索公告标题"/);
  assert.match(announcements, /import \{ serverNowMs \} from "@water-erp\/shared"/);
  assert.doesNotMatch(announcements, /Date\.now\(\)/);
});

test("completed project history keeps table semantics while providing mobile field labels", () => {
  const completed = source("../../app/(main)/completed-projects/page.tsx");

  assert.doesNotMatch(completed, /className="row-clickable"/);
  assert.doesNotMatch(completed, /onClick=\{\(\) => router\.push/);
  assert.match(completed, /className="[^"]*completed-projects-table[^"]*"/);
  assert.match(completed, /<caption className="sr-only">已完成项目列表<\/caption>/);
  assert.match(completed, /data-label="项目编号"/);
  assert.match(completed, /data-label="我的结果"/);
  assert.match(completed, /className="completed-project-link"/);
  assert.match(completed, /aria-label=\{`查看项目 \$\{r\.name\}详情`\}/);
});

test("list styles provide visible focus and narrow-screen card adaptations", () => {
  const bidStyles = source("../../styles/pages/bids.css");
  const announcementStyles = source("../../styles/pages/announcements.css");

  assert.match(bidStyles, /\.opportunity-detail-link:focus-visible/);
  assert.match(bidStyles, /\.opportunity-detail-link\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(bidStyles, /@media \(max-width:\s*720px\)[\s\S]*?\.completed-projects-table tbody tr/);
  assert.match(bidStyles, /\.completed-projects-table td::before\s*\{[\s\S]*?content:\s*attr\(data-label\)/);

  assert.match(announcementStyles, /\.announcement-row:focus-visible/);
  assert.match(announcementStyles, /@media \(max-width:\s*720px\)[\s\S]*?\.announcement-row/);
});

test("announcement center: supplier-scoped list when logged in, restricted badge (2026-09-29 spec)", () => {
  const announcements = source("../../app/(main)/announcements/page.tsx");
  const api = source("../../lib/api/announcement.ts");
  const css = source("../../styles/pages/announcements.css");

  // 登录态（tab 级 token）→ 供应商视角端点（公开 ∪ 定向命中本供应商）；匿名回退公开列表
  assert.match(announcements, /import \{ getSupplierToken \} from "@\/lib\/session-store"/);
  assert.match(announcements, /getSupplierToken\(\)\s*\n?\s*\?\s*announcementApi\.supplierList\(params\)/);
  assert.match(announcements, /: announcementApi\.publicList\(params\)/);
  assert.match(api, /supplier-portal\/announcements\$\{qs\(params\)\}/);

  // 定向徽章：仅 RESTRICTED 渲染（可点行与已下线标题壳行都要有）
  assert.match(announcements, /restricted-badge/g);
  assert.match(css, /\.restricted-badge \{/);

  // 公开门户口径不受扰：publicList 仍指向 /announcements/public
  assert.match(api, /\/announcements\/public\$\{qs\(params\)\}/);
});
