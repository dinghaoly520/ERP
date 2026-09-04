import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as shellModule from "../shell/app-shell";
import { HeroWorkspaceTabs } from "../sp-page-hero";
import {
  buildMenuItems,
  findWorkspaceForPath,
  type MenuEntry,
} from "../shell/supplier-menu";

interface SidebarNavItemProps {
  item: MenuEntry;
  pathname: string;
  active: boolean;
  collapsed: boolean;
  mobile?: boolean;
  unreadCount: number;
  onNavigate: (path: string) => void;
}

const SidebarNavItem = (
  shellModule as typeof shellModule & {
    SupplierSidebarNavItem?: ComponentType<SidebarNavItemProps>;
  }
).SupplierSidebarNavItem;

const getTooltipPosition = (
  shellModule as typeof shellModule & {
    getSupplierNavTooltipPosition?: (
      rect: { top: number; right: number; height: number },
      viewportHeight: number,
    ) => { top: number; left: number };
  }
).getSupplierNavTooltipPosition;

const shellSource = readFileSync(
  new URL("../shell/app-shell.tsx", import.meta.url),
  "utf8",
);
const pageHeroSource = readFileSync(
  new URL("../sp-page-hero.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

test("shell navigation exposes current-page state and labelled toggle controls", () => {
  assert.match(shellSource, /aria-label=\{collapsed \? "展开侧栏" : "收起侧栏"\}/);
  assert.match(shellSource, /aria-controls="supplier-desktop-navigation"/);
  assert.match(shellSource, /aria-label="打开主导航"/);
  assert.match(shellSource, /aria-controls="supplier-mobile-navigation"/);
});

test("multi-route workspaces delegate current-page state to the concrete context link", () => {
  assert.equal(typeof SidebarNavItem, "function");
  if (!SidebarNavItem) return;

  const menuItems = buildMenuItems(false);

  for (const {
    pathname,
    sidebarCurrentPages,
    contextCurrent,
  } of [
    { pathname: "/bids", sidebarCurrentPages: 0, contextCurrent: "page" },
    { pathname: "/prequal", sidebarCurrentPages: 0, contextCurrent: "page" },
  ] as const) {
    const workspace = findWorkspaceForPath(pathname, menuItems);
    assert.ok(workspace);

    const sidebarMarkup = renderToStaticMarkup(createElement(SidebarNavItem, {
      item: workspace,
      pathname,
      active: true,
      collapsed: false,
      unreadCount: 0,
      onNavigate: () => undefined,
    }));
    const contextMarkup = renderToStaticMarkup(
      <HeroWorkspaceTabs tabs={workspace.tabs} currentPath={pathname} />,
    );

    assert.match(sidebarMarkup, /class="[^"]*sp-nav-item[^"]*active[^"]*"/);
    assert.equal(
      (sidebarMarkup.match(/aria-current="page"/g) ?? []).length,
      sidebarCurrentPages,
    );
    assert.equal(
      (contextMarkup.match(new RegExp(`aria-current="${contextCurrent}"`, "g")) ?? []).length,
      1,
    );
    assert.equal(
      ((sidebarMarkup + contextMarkup).match(/aria-current="page"/g) ?? []).length,
      1,
    );
    assert.doesNotMatch(sidebarMarkup + contextMarkup, /aria-current="location"/);
  }
});

test("a single-route sidebar workspace owns the current-page state", () => {
  assert.equal(typeof SidebarNavItem, "function");
  if (!SidebarNavItem) return;

  const menuItems = buildMenuItems(false);
  const workspace = findWorkspaceForPath("/dashboard", menuItems);
  assert.ok(workspace);

  const sidebarMarkup = renderToStaticMarkup(createElement(SidebarNavItem, {
    item: workspace,
    pathname: "/dashboard",
    active: true,
    collapsed: false,
    unreadCount: 0,
    onNavigate: () => undefined,
  }));

  assert.equal((sidebarMarkup.match(/aria-current="page"/g) ?? []).length, 1);
  assert.equal(
    renderToStaticMarkup(
      <HeroWorkspaceTabs tabs={workspace.tabs ?? null} currentPath="/dashboard" />,
    ),
    "",
  );
});

test("sidebar workspaces use native links so browser navigation affordances remain available", () => {
  assert.equal(typeof SidebarNavItem, "function");
  if (!SidebarNavItem) return;

  const workspace = findWorkspaceForPath("/dashboard", buildMenuItems(false));
  assert.ok(workspace);
  const markup = renderToStaticMarkup(createElement(SidebarNavItem, {
    item: workspace,
    pathname: "/dashboard",
    active: true,
    collapsed: false,
    unreadCount: 0,
    onNavigate: () => undefined,
  }));

  assert.match(
    markup,
    /<a\b(?=[^>]*href="\/dashboard")(?=[^>]*class="[^"]*sp-nav-item)[^>]*>/,
  );
  assert.doesNotMatch(markup, /<button\b/);
  assert.match(shellSource, /import Link from "next\/link"/);
});

test("shell no longer renders the context navigation; SpPageHero renders it inside the hero card", () => {
  assert.doesNotMatch(shellSource, /SupplierContextNav/);
  assert.match(shellSource, /findWorkspaceForPath\(pathname, menuItems\)/);
  assert.match(shellSource, /path === activeWorkspace\?\.path/);
  assert.doesNotMatch(shellSource, /const activePath\b/);
  assert.match(pageHeroSource, /findWorkspaceForPath\(pathname, buildMenuItems/);
  assert.match(pageHeroSource, /<HeroWorkspaceTabs/);
});

test("shell passes unresolved supplier status to the fail-closed menu builder", () => {
  assert.match(shellSource, /buildMenuItems\(status\?\.isTemporary\)/);
  assert.doesNotMatch(shellSource, /buildMenuItems\(!!status\?\.isTemporary\)/);
});

test("account actions live in one menu without duplicate profile or logout shortcuts", () => {
  assert.doesNotMatch(shellSource, /className="sp-logout-btn"/);
  assert.doesNotMatch(shellSource, /router\.push\(["']\/profile["']\)/);
  assert.doesNotMatch(shellSource, />企业信息</);
  assert.equal(
    (shellSource.match(/className="sp-user-menu-item"/g) ?? []).length,
    2,
  );
  assert.match(
    shellSource,
    /id="supplier-user-menu"[\s\S]{0,900}?修改密码[\s\S]{0,500}?onClick=\{handleLogout\}[\s\S]{0,180}?退出登录/,
  );
});

test("sidebar uses one-line labels", () => {
  assert.doesNotMatch(shellSource, /item\.desc/);
});

test("collapsed desktop sidebar items keep an accessible tooltip relationship during SSR", () => {
  assert.equal(typeof SidebarNavItem, "function");
  if (!SidebarNavItem) return;

  const workspace = findWorkspaceForPath("/dashboard", buildMenuItems(false));
  assert.ok(workspace);

  const collapsedMarkup = renderToStaticMarkup(createElement(SidebarNavItem, {
    item: workspace,
    pathname: "/dashboard",
    active: true,
    collapsed: true,
    unreadCount: 0,
    onNavigate: () => undefined,
  }));
  const tooltipId = collapsedMarkup.match(/aria-describedby="([^"]+)"/)?.[1];

  assert.ok(tooltipId);
  assert.doesNotMatch(collapsedMarkup, /role="tooltip"/);
  assert.doesNotMatch(collapsedMarkup, /\stitle=/);

  const expandedMarkup = renderToStaticMarkup(createElement(SidebarNavItem, {
    item: workspace,
    pathname: "/dashboard",
    active: true,
    collapsed: false,
    unreadCount: 0,
    onNavigate: () => undefined,
  }));
  assert.doesNotMatch(expandedMarkup, /role="tooltip"/);
});

test("collapsed desktop tooltips use a body portal with mouse, focus, and Escape lifecycle", () => {
  const sidebarItemSource = shellSource.split("export function AppShell")[0];

  assert.match(shellSource, /import \{ createPortal \} from "react-dom"/);
  assert.match(sidebarItemSource, /getBoundingClientRect\(\)/);
  assert.match(sidebarItemSource, /onMouseEnter=\{openTooltip\}/);
  assert.match(sidebarItemSource, /onMouseLeave=\{closeTooltip\}/);
  assert.match(sidebarItemSource, /onFocus=\{openTooltip\}/);
  assert.match(sidebarItemSource, /onBlur=\{closeTooltip\}/);
  assert.match(sidebarItemSource, /event\.key === "Escape"/);
  assert.match(sidebarItemSource, /createPortal\([\s\S]{0,500}?document\.body/);
});

test("tooltip geometry follows its trigger and remains inside a short viewport", () => {
  assert.equal(typeof getTooltipPosition, "function");
  if (!getTooltipPosition) return;

  assert.deepEqual(
    getTooltipPosition({ top: 20, right: 68, height: 44 }, 420),
    { top: 42, left: 78 },
  );
  assert.deepEqual(
    getTooltipPosition({ top: -20, right: 68, height: 10 }, 420),
    { top: 16, left: 78 },
  );
  assert.deepEqual(
    getTooltipPosition({ top: 410, right: 68, height: 44 }, 420),
    { top: 404, left: 78 },
  );
});

test("hero workspace tabs render native links and mark the most specific current route", () => {
  const workspace = findWorkspaceForPath("/profile", buildMenuItems(false));
  assert.ok(workspace?.tabs);
  const markup = renderToStaticMarkup(
    <HeroWorkspaceTabs tabs={workspace.tabs} currentPath="/profile/ukey/detail" ariaLabel="企业资料子导航" />,
  );

  assert.match(markup, /^<nav[^>]*aria-label="企业资料子导航"/);
  assert.match(pageHeroSource, /import Link from "next\/link"/);
  assert.equal((markup.match(/<a\b/g) ?? []).length, 3);
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /<button\b/);

  for (const [path, title] of [
    ["/profile", "基本资料"],
    ["/profile/ukey", "证书与U盾"],
    ["/change-records", "变更记录"],
  ] as const) {
    assert.match(markup, new RegExp(`<a\\b[^>]*href="${path}"[^>]*>[\\s\\S]*?${title}<\\/a>`));
  }

  const activeLink = markup.match(/<a\b[^>]*href="\/profile\/ukey"[^>]*>/)?.[0];
  assert.ok(activeLink);
  assert.match(activeLink, /aria-current="page"/);
});

test("the default route of a multi-route workspace marks its concrete context link as the page", () => {
  const workspace = findWorkspaceForPath("/bids", buildMenuItems(false));
  const markup = renderToStaticMarkup(
    <HeroWorkspaceTabs tabs={workspace?.tabs} currentPath="/bids" />,
  );

  const activeLink = markup.match(/<a\b[^>]*href="\/bids"[^>]*>/)?.[0];
  assert.ok(activeLink);
  assert.match(activeLink, /aria-current="page"/);
  assert.doesNotMatch(markup, /aria-current="location"/);
});

test("hero workspace tabs do not render for a single-route workspace", () => {
  const markup = renderToStaticMarkup(
    <HeroWorkspaceTabs tabs={null} currentPath="/dashboard" />,
  );

  assert.equal(markup, "");
});

test("notification rows and the mobile backdrop use native buttons", () => {
  assert.match(
    shellSource,
    /<button[\s\S]*?key=\{n\.id\}[\s\S]*?className=\{cn\("sp-notif-item"/,
  );
  assert.match(
    shellSource,
    /<button[\s\S]*?className="sp-mobile-drawer-ov"[\s\S]*?aria-label="关闭移动导航"/,
  );
  assert.doesNotMatch(
    shellSource,
    /<div[\s\S]{0,100}?key=\{n\.id\}[\s\S]{0,180}?onClick=\{\(\) => goToNotif/,
  );
  assert.match(shellSource, /summarizeNotification\(n\.content, 72\)/);
});

test("the recent notifications popover is a labelled region", () => {
  assert.match(
    shellSource,
    /<div\b(?=[^>]*id="supplier-notification-popover")(?=[^>]*role="region")(?=[^>]*aria-label="最近消息")[^>]*>/,
  );
});

test("mobile navigation behaves as a labelled modal with keyboard and focus lifecycle", () => {
  assert.match(shellSource, /window\.innerWidth <= 768/);
  assert.match(shellSource, /role="dialog"/);
  assert.match(shellSource, /aria-modal="true"/);
  assert.match(shellSource, /aria-label="供应商主导航"/);
  assert.match(shellSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(shellSource, /event\.key === "Escape"/);
  assert.match(shellSource, /event\.key !== "Tab"/);
  assert.match(shellSource, /drawerRef\.current\?\.focus\(\)/);
  assert.match(shellSource, /const drawerTrigger = mobileDrawerTriggerRef\.current/);
  assert.match(shellSource, /drawerTrigger\?\.focus\(\)/);
  assert.match(shellSource, /ref=\{mobileDrawerTriggerRef\}/);
  assert.match(shellSource, /hidden=\{mobileDrawer\}/);
  assert.match(shellSource, /if \(!m\) setMobileDrawer\(false\)/);
});

test("shell controls keep 44px touch targets and the mobile popover stays in the viewport", () => {
  assert.match(globalStyles, /\.sp-brand\s*\{[\s\S]{0,240}?min-height:\s*44px/);
  assert.match(globalStyles, /\.sp-brand:focus-visible,/);
  assert.match(globalStyles, /\.sp-header-icon[\s\S]{0,220}?min-width:\s*44px[\s\S]{0,120}?height:\s*44px/);
  assert.match(globalStyles, /\.sp-nav-item[\s\S]{0,260}?min-height:\s*44px/);
  assert.match(globalStyles, /\.sp-user-menu-item[\s\S]{0,260}?min-height:\s*44px/);
  assert.match(globalStyles, /\.sp-mobile-drawer-close[\s\S]{0,260}?width:\s*44px[\s\S]{0,80}?height:\s*44px/);
  assert.match(globalStyles, /\.mobile-fab\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(
    globalStyles,
    /@media \(max-width:\s*768px\)[\s\S]*?\.sp-notif-popover\s*\{[\s\S]*?position:\s*fixed[\s\S]*?left:\s*12px[\s\S]*?right:\s*12px/,
  );
});

test("hero workspace tabs stay scrollable, focusable, and neumorphic", () => {
  assert.match(
    globalStyles,
    /\.sp-hero-tabs\s*\{[\s\S]{0,600}?box-shadow:\s*inset 2px 2px 5px[\s\S]{0,300}?overflow-x:\s*auto/,
  );
  assert.match(
    globalStyles,
    /\.sp-hero-tab\s*\{[\s\S]{0,500}?min-height:\s*40px[\s\S]{0,400}?background:\s*linear-gradient/,
  );
  assert.match(globalStyles, /\.sp-hero-tab\.is-active\s*\{[\s\S]{0,300}?inset 2px 2px 5px/);
  assert.match(
    globalStyles,
    /\.sp-hero-tab:focus-visible\s*\{\s*outline:\s*3px solid var\(--brand\);\s*outline-offset:\s*2px;/,
  );
});

test("collapsed sidebar keeps navigation scrollable while portal tooltips escape clipping", () => {
  assert.match(
    globalStyles,
    /\.sp-nav\s*\{\s*flex:\s*1;\s*min-height:\s*0;\s*overflow-y:\s*auto;/,
  );
  assert.doesNotMatch(globalStyles, /\.sp-sidebar\.collapsed\s*\{[^}]*overflow:\s*visible/);
  assert.doesNotMatch(globalStyles, /\.sp-sidebar\.collapsed \.sp-nav\s*\{[^}]*overflow:\s*visible/);
  assert.match(
    globalStyles,
    /\.sp-nav-tooltip\s*\{[\s\S]{0,180}?position:\s*fixed/,
  );
  assert.match(
    globalStyles,
    /\.sp-collapse-toggle\s*\{[\s\S]{0,220}?flex-shrink:\s*0/,
  );
});

test("all shell controls use the high-contrast brand focus outline", () => {
  assert.match(
    globalStyles,
    /\.sp-brand:focus-visible,[\s\S]{0,500}?\{\s*outline:\s*3px solid var\(--brand\);/,
  );
});
