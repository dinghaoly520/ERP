import assert from "node:assert/strict";
import { test } from "node:test";
import * as supplierMenuModule from "../../components/shell/supplier-menu";
import {
  buildMenuItems,
  findLongestPathMatch,
  findWorkspaceForPath,
  findWorkspaceTabForPath,
  type MenuEntry,
  type MenuItem,
} from "../../components/shell/supplier-menu";

const canAccessRegularSupplierWorkspaces = (
  supplierMenuModule as typeof supplierMenuModule & {
    canAccessRegularSupplierWorkspaces?: (
      isTemporary: boolean | null | undefined,
    ) => boolean;
  }
).canAccessRegularSupplierWorkspaces;

function workspaces(items: readonly MenuItem[]): MenuEntry[] {
  return items.filter((item): item is MenuEntry => "path" in item);
}

const LEGACY_ROUTE_CASES = [
  { path: "/dashboard", workspaceTitle: "工作台" },
  { path: "/bids", workspaceTitle: "项目机会" },
  { path: "/prequal", workspaceTitle: "项目机会" },
  { path: "/my-bids", workspaceTitle: "我的投标" },
  { path: "/completed-projects", workspaceTitle: "我的投标" },
  { path: "/award-letters", workspaceTitle: "成交履约" },
  { path: "/contracts", workspaceTitle: "成交履约" },
  { path: "/frameworks", workspaceTitle: "成交履约" },
  { path: "/catalog", workspaceTitle: "供货管理" },
  { path: "/catalog-applications", workspaceTitle: "供货管理" },
  { path: "/supply", workspaceTitle: "供货管理" },
  { path: "/profile", workspaceTitle: "企业资料" },
  { path: "/profile/ukey", workspaceTitle: "企业资料" },
  { path: "/change-records", workspaceTitle: "企业资料" },
  { path: "/announcements", workspaceTitle: "公告中心" },
  { path: "/objections", workspaceTitle: "异议投诉" },
] as const;

const REGULAR_ONLY_ROUTES = [
  "/catalog",
  "/catalog-applications",
  "/supply",
  "/profile",
  "/profile/ukey",
  "/change-records",
] as const;

test("regular-only workspaces require a confirmed non-temporary status", () => {
  assert.equal(typeof canAccessRegularSupplierWorkspaces, "function");
  if (!canAccessRegularSupplierWorkspaces) return;

  assert.equal(canAccessRegularSupplierWorkspaces(null), false);
  assert.equal(canAccessRegularSupplierWorkspaces(undefined), false);
  assert.equal(canAccessRegularSupplierWorkspaces(true), false);
  assert.equal(canAccessRegularSupplierWorkspaces(false), true);
});

test("menu construction stays fail-closed while supplier status is unknown", () => {
  const buildForStatus = buildMenuItems as (
    isTemporary: boolean | null | undefined,
  ) => MenuItem[];

  assert.equal(workspaces(buildForStatus(null)).length, 6);
  assert.equal(workspaces(buildForStatus(undefined)).length, 6);
  assert.equal(workspaces(buildForStatus(true)).length, 6);
  assert.equal(workspaces(buildForStatus(false)).length, 8);
});

test("regular suppliers see the eight task-oriented workspaces in order", () => {
  assert.deepEqual(
    workspaces(buildMenuItems(false)).map((item) => item.title),
    ["工作台", "项目机会", "我的投标", "成交履约", "供货管理", "企业资料", "公告中心", "异议投诉"],
  );
});

test("temporary suppliers omit supply and company workspaces", () => {
  assert.deepEqual(
    workspaces(buildMenuItems(true)).map((item) => item.title),
    ["工作台", "项目机会", "我的投标", "成交履约", "公告中心", "异议投诉"],
  );
});

test("workspace menus retain section dividers", () => {
  const dividerLabels = (items: readonly MenuItem[]) =>
    items.filter((item) => "divider" in item).map((item) => item.label);

  assert.deepEqual(dividerLabels(buildMenuItems(false)), ["招采业务", "供应商管理", "信息服务"]);
  assert.deepEqual(dividerLabels(buildMenuItems(true)), ["招采业务", "信息服务"]);
});

test("only multi-route workspaces define tabs", () => {
  const routesByWorkspace = Object.fromEntries(
    workspaces(buildMenuItems(false)).map((workspace) => [
      workspace.title,
      workspace.tabs?.map((tab) => tab.path) ?? [],
    ]),
  );

  assert.deepEqual(routesByWorkspace, {
    工作台: [],
    项目机会: ["/bids", "/prequal"],
    我的投标: ["/my-bids", "/completed-projects"],
    成交履约: ["/award-letters", "/contracts", "/frameworks"],
    供货管理: ["/catalog", "/catalog-applications", "/supply"],
    企业资料: ["/profile", "/profile/ukey", "/change-records"],
    公告中心: [],
    异议投诉: [],
  });
});

test("multi-route workspaces use concise task-oriented tab labels", () => {
  const labelsByWorkspace = Object.fromEntries(
    workspaces(buildMenuItems(false))
      .filter((workspace) => workspace.tabs)
      .map((workspace) => [
        workspace.title,
        workspace.tabs?.map((tab) => tab.title),
      ]),
  );

  assert.deepEqual(labelsByWorkspace, {
    项目机会: ["可参与项目", "资格预审"],
    我的投标: ["进行中", "已完成"],
    成交履约: ["成交通知", "合同履约", "框架协议"],
    供货管理: ["品类目录", "申请进度", "供货关系"],
    企业资料: ["基本资料", "证书与U盾", "变更记录"],
  });
});

test("notifications remain outside the supplier sidebar", () => {
  const sidebarPaths = workspaces(buildMenuItems(false)).flatMap((workspace) => [
    workspace.path,
    ...(workspace.tabs?.map((tab) => tab.path) ?? []),
  ]);

  assert.equal(sidebarPaths.includes("/notifications"), false);
  assert.equal(findWorkspaceForPath("/notifications", buildMenuItems(false)), null);
});

test("longest path matching respects route boundaries", () => {
  const candidates = [{ path: "/profile" }, { path: "/profile/ukey" }];

  assert.equal(
    findLongestPathMatch("/profile/ukey/detail", candidates)?.path,
    "/profile/ukey",
  );
  assert.equal(findLongestPathMatch("/profiles", candidates), null);
});

test("a detail route resolves both its owning workspace and current tab", () => {
  const items = buildMenuItems(false);
  const workspace = findWorkspaceForPath("/profile/ukey/detail", items);

  assert.equal(workspace?.title, "企业资料");
  assert.equal(
    findWorkspaceTabForPath("/profile/ukey/detail", workspace)?.path,
    "/profile/ukey",
  );
});

test("a workspace without tabs resolves its own route and descendants", () => {
  const source = workspaces(buildMenuItems(false))[0];
  const workspaceWithoutTabs: MenuEntry = {
    path: source.path,
    title: source.title,
    icon: source.icon,
    desc: source.desc,
  };

  for (const pathname of ["/dashboard", "/dashboard/detail"]) {
    assert.equal(findWorkspaceForPath(pathname, [workspaceWithoutTabs]), workspaceWithoutTabs);
    assert.deepEqual(findWorkspaceTabForPath(pathname, workspaceWithoutTabs), {
      path: "/dashboard",
      title: "工作台",
    });
  }
});

for (const { path, workspaceTitle } of LEGACY_ROUTE_CASES) {
  test(`${path} resolves through its owning workspace and current tab`, () => {
    const workspace = findWorkspaceForPath(path, buildMenuItems(false));

    assert.equal(workspace?.title, workspaceTitle);
    assert.equal(findWorkspaceTabForPath(path, workspace)?.path, path);
  });
}

for (const path of REGULAR_ONLY_ROUTES) {
  test(`temporary suppliers cannot resolve ${path}`, () => {
    const workspace = findWorkspaceForPath(path, buildMenuItems(true));

    assert.equal(workspace, null);
    assert.equal(findWorkspaceTabForPath(path, workspace), null);
  });
}
