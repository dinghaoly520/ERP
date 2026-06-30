import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyTenderDrafts,
} from "./templates";
import {
  beginTenderWriteSession,
  createTenderWriteSessionId,
  readTenderWriteState,
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

  delete (globalThis as typeof globalThis & { window?: unknown }).window;
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

  delete (globalThis as typeof globalThis & { window?: unknown }).window;
});
