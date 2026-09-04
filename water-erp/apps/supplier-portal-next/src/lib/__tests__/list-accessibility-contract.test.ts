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
  assert.match(announcements, /<SpTabs[\s\S]*?ariaLabel="公告类型"/);
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
