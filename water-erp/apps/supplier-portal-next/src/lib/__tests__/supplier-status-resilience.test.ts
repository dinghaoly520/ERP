import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as statusModule from "../supplier-status-context";

type StatusLoader = <T>(
  request: () => Promise<T>,
  onStatus: (status: T | null) => void,
  onErrorChange: (hasError: boolean) => void,
) => Promise<void>;

const loadSupplierStatus = (
  statusModule as typeof statusModule & { loadSupplierStatus?: StatusLoader }
).loadSupplierStatus;

const statusContextSource = readFileSync(
  new URL("../supplier-status-context.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../components/shell/app-shell.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../../app/(main)/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);

test("a failed supplier status request clears stale permissions, exposes an error, and still rejects", async () => {
  assert.equal(typeof loadSupplierStatus, "function");
  if (!loadSupplierStatus) return;

  const statusChanges: unknown[] = [];
  const errorChanges: boolean[] = [];
  const failure = new Error("status unavailable");

  await assert.rejects(
    loadSupplierStatus(
      async () => { throw failure; },
      (status) => statusChanges.push(status),
      (hasError) => errorChanges.push(hasError),
    ),
    failure,
  );

  assert.deepEqual(statusChanges, [null]);
  assert.deepEqual(errorChanges, [true]);
});

test("a successful supplier status retry updates status and clears the previous error", async () => {
  assert.equal(typeof loadSupplierStatus, "function");
  if (!loadSupplierStatus) return;

  const nextStatus = { name: "测试供应商", isTemporary: false };
  const statusChanges: unknown[] = [];
  const errorChanges: boolean[] = [];

  await loadSupplierStatus(
    async () => nextStatus,
    (status) => statusChanges.push(status),
    (hasError) => errorChanges.push(hasError),
  );

  assert.deepEqual(statusChanges, [nextStatus]);
  assert.deepEqual(errorChanges, [false]);
});

test("the provider handles its mount rejection while exposing status errors to consumers", () => {
  assert.match(statusContextSource, /statusError:\s*boolean/);
  assert.match(statusContextSource, /value=\{\{\s*status,\s*statusError,\s*fetchStatus\s*\}\}/);
  assert.match(statusContextSource, /void fetchStatus\(\)\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(statusContextSource, /catch\s*\{\s*\/\*\s*静默/);
});

test("the shell renders a compact actionable status alert without opening permissions", () => {
  assert.match(shellSource, /const \{ status, statusError, fetchStatus \} = useSupplierStatus\(\)/);
  assert.match(
    shellSource,
    /role="alert"[\s\S]{0,300}?供应商身份信息加载失败，部分入口暂时隐藏。[\s\S]{0,300}?重新加载/,
  );
  assert.match(shellSource, /void fetchStatus\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(shellSource, /statusError && pathname !== "\/dashboard"/);
  assert.match(shellSource, /buildMenuItems\(status\?\.isTemporary\)/);

  assert.match(globalStyles, /\.sp-shell-status-alert\s*\{[\s\S]{0,500}?box-shadow:\s*none/);
  assert.match(globalStyles, /\.sp-shell-status-retry\s*\{[\s\S]{0,500}?min-height:\s*44px/);
});

test("dashboard Promise.all can catch a rejected status refresh and show its existing error block", () => {
  assert.match(
    dashboardSource,
    /await Promise\.all\(\[[\s\S]{0,500}?fetchStatus\(\)[\s\S]{0,800}?\]\);[\s\S]{0,400}?catch\s*\{[\s\S]{0,120}?setError\(true\)/,
  );
  assert.match(
    dashboardSource,
    /\{error && !loading \? \([\s\S]{0,300}?data loading failed|\{error && !loading \? \([\s\S]{0,300}?数据加载失败/,
  );
});
