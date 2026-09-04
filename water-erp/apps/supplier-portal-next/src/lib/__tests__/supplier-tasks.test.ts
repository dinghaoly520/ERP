import test from "node:test";
import assert from "node:assert/strict";
import { buildSupplierTasks } from "../supplier-tasks";

const NOW = Date.parse("2026-09-03T08:00:00Z");

test("supplier tasks cover corrections, drafts, clarifications, awards, fulfillment and qualifications", () => {
  const tasks = buildSupplierTasks({
    nowMs: NOW,
    stats: { pendingChanges: 1, expiringQualifications: 2 },
    projects: [
      { id: "p-draft", name: "泵站设备", stage: "SUBMIT", deadline: "2026-09-04T08:00:00Z", mySubmissionStatus: "draft" },
    ],
    notifications: [
      { id: "n-clar", type: "BID_CLARIFICATION_CREATED", title: "收到澄清", isRead: true, resolvedAt: null, link: "/bids/p-draft/clarifications", createdAt: "2026-09-03T07:00:00Z" },
      { id: "n-round", type: "BID_ROUND_OPEN", title: "新一轮报价已开放", isRead: false, resolvedAt: null, link: "/bids/p-draft/round-quote", createdAt: "2026-09-03T07:10:00Z" },
      { id: "n-done", type: "BID_CLARIFICATION_CREATED", title: "已完成澄清", isRead: false, resolvedAt: "2026-09-03T07:30:00Z", link: "/bids/p-draft/clarifications", createdAt: "2026-09-03T07:00:00Z" },
    ],
    awards: [{ id: "a1", projectId: "p-award", supplierName: "甲", signedAt: null, letterAssetId: "file-1" }],
    contracts: [{ id: "c1", contractCode: "HT-1", status: "performing", fulfillments: [{ id: "f1", title: "交货证明", status: "pending", dueDate: "2026-09-05T08:00:00Z" }] }],
  });

  assert.deepEqual(new Set(tasks.map((task) => task.kind)), new Set([
    "profile-correction", "bid-draft", "clarification", "round-quote", "award-letter", "fulfillment", "qualification",
  ]));
  assert.equal(tasks.find((task) => task.kind === "bid-draft")?.href, "/bids/p-draft/submit");
  assert.equal(tasks.find((task) => task.kind === "award-letter")?.href, "/award-letters");
  assert.equal(tasks.find((task) => task.kind === "round-quote")?.href, "/bids/p-draft/round-quote");
  assert.equal(tasks.some((task) => task.id === "notification:n-done"), false);
});

test("supplier tasks sort overdue and near deadlines before undated work", () => {
  const tasks = buildSupplierTasks({
    nowMs: NOW,
    projects: [
      { id: "late", name: "已过期", stage: "SUBMIT", deadline: "2026-09-03T07:00:00Z" },
      { id: "soon", name: "即将截止", stage: "SUBMIT", deadline: "2026-09-03T10:00:00Z" },
    ],
    stats: { pendingChanges: 1 },
  });

  assert.equal(tasks[0]?.urgency, "overdue");
  assert.equal(tasks[1]?.urgency, "critical");
  assert.equal(tasks.at(-1)?.dueAt, null);
});
