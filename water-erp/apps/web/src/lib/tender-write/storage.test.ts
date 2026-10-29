import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyTenderDrafts,
} from "./templates";
import {
  beginTenderWriteSession,
  createTenderWriteSessionId,
  readTenderWriteState,
  tenderDraftStorageKey,
  writeTenderWriteState,
} from "./storage";

class LocalStorageMock {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

test("initial null state write does not erase a saved tender-write draft", () => {
  const localStorage = new LocalStorageMock();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  const sessionId = createTenderWriteSessionId();
  beginTenderWriteSession(sessionId);

  const savedDrafts = createEmptyTenderDrafts();
  savedDrafts.COMPETITIVE_NEGOTIATION.projectName = "正在填写的项目";
  writeTenderWriteState({
    selectedType: "COMPETITIVE_NEGOTIATION",
    drafts: savedDrafts,
  });

  writeTenderWriteState({
    selectedType: null,
    drafts: createEmptyTenderDrafts(),
  });

  const restored = readTenderWriteState();
  assert.equal(restored.selectedType, "COMPETITIVE_NEGOTIATION");
  assert.equal(
    restored.drafts.COMPETITIVE_NEGOTIATION.projectName,
    "正在填写的项目",
  );

  delete (globalThis as { window?: unknown }).window;
});

test("new tender-write login session starts from type selection", () => {
  const localStorage = new LocalStorageMock();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });

  const firstSessionId = createTenderWriteSessionId();
  beginTenderWriteSession(firstSessionId);

  const savedDrafts = createEmptyTenderDrafts();
  savedDrafts.COMPETITIVE_NEGOTIATION.projectName = "上次登录的项目";
  writeTenderWriteState({
    selectedType: "COMPETITIVE_NEGOTIATION",
    drafts: savedDrafts,
  });

  const nextSessionId = createTenderWriteSessionId();
  beginTenderWriteSession(nextSessionId);

  const restored = readTenderWriteState();
  assert.equal(restored.selectedType, null);
  assert.equal(restored.drafts.COMPETITIVE_NEGOTIATION.projectName, "");

  delete (globalThis as { window?: unknown }).window;
});

// 2026-10-28 二轮隔离：项目草稿缓存键按轮后缀（R1 沿用旧键=存量不迁移不丢）
test("tenderDraftStorageKey: round 1 keeps legacy key, round>1 gets :R{n} suffix", () => {
  assert.equal(tenderDraftStorageKey("pm-1", 1), "tender-write:project-drafts:v1:pm-1");
  assert.equal(tenderDraftStorageKey("pm-1", 2), "tender-write:project-drafts:v1:pm-1:R2");
  assert.equal(tenderDraftStorageKey("pm-1", 3), "tender-write:project-drafts:v1:pm-1:R3");
  // 轮键互不串读：R2 键不覆盖 R1 旧键
  assert.notEqual(tenderDraftStorageKey("pm-1", 2), tenderDraftStorageKey("pm-1", 1));
});
