import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  awardLetterFileUrl,
  awardLetterProjectLabel,
  awardLetterVersionBody,
  canSignAwardLetter,
  prioritizeAwardLetters,
} from "../api/award-letter";
import {
  buildMenuItems,
  findWorkspaceForPath,
  findWorkspaceTabForPath,
} from "../../components/shell/supplier-menu";

test("award letter file URL uses the authenticated file endpoint", () => {
  assert.equal(awardLetterFileUrl("asset-123"), "/api/upload/files/asset-123");
  assert.equal(awardLetterFileUrl(null), null);
});

test("an award letter cannot be signed before it is delivered with a document", () => {
  assert.equal(canSignAwardLetter({ deliveredAt: null, receivedAt: null, signedAt: null, letterAssetId: "asset-1" }), false);
  assert.equal(canSignAwardLetter({ deliveredAt: "2026-09-03", receivedAt: "2026-09-03", signedAt: null, letterAssetId: null }), false);
  assert.equal(canSignAwardLetter({ deliveredAt: "2026-09-03", receivedAt: null, signedAt: null, letterAssetId: "asset-1" }), false);
  assert.equal(canSignAwardLetter({ deliveredAt: "2026-09-03", receivedAt: "2026-09-03", signedAt: null, letterAssetId: "asset-1" }), true);
  assert.equal(canSignAwardLetter({ deliveredAt: "2026-09-03", receivedAt: "2026-09-03", signedAt: "2026-09-04", letterAssetId: "asset-1" }), false);
});

test("award letter project label identifies both project name and code", () => {
  assert.equal(
    awardLetterProjectLabel({ project: { id: "p1", name: "智慧水利项目", projectCode: "SW-2026-01" } }),
    "智慧水利项目（SW-2026-01）",
  );
});

test("award letter receipt requests pin the document version that was opened", () => {
  assert.deepEqual(awardLetterVersionBody("asset-1", "2026-09-03T07:00:00.000Z"), {
    letterAssetId: "asset-1",
    deliveredAt: "2026-09-03T07:00:00.000Z",
  });
});

test("a deliveryId deep link moves an owned award letter to the front", () => {
  const letters = [{ id: "delivery-1" }, { id: "delivery-2" }, { id: "delivery-3" }];

  assert.deepEqual(prioritizeAwardLetters(letters, "delivery-2").map((letter) => letter.id), [
    "delivery-2",
    "delivery-1",
    "delivery-3",
  ]);
});

test("an invalid or missing deliveryId preserves the ordinary award-letter list", () => {
  const letters = [{ id: "delivery-1" }, { id: "delivery-2" }];

  assert.deepEqual(prioritizeAwardLetters(letters, "not-owned"), letters);
  assert.deepEqual(prioritizeAwardLetters(letters, null), letters);
});

test("award-letter page wires the deliveryId hint to a focused card style", () => {
  const page = readFileSync(
    new URL("../../app/(main)/award-letters/page.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../../styles/pages/announcements.css", import.meta.url),
    "utf8",
  );

  assert.match(page, /useSearchParams/);
  assert.match(page, /prioritizeAwardLetters/);
  assert.match(page, /award-card--focused/);
  assert.match(styles, /\.award-card--focused/);
});

test("award letters and completed projects are discoverable through workspaces", () => {
  for (const items of [buildMenuItems(false), buildMenuItems(true)]) {
    const fulfillmentWorkspace = findWorkspaceForPath("/award-letters", items);
    const bidsWorkspace = findWorkspaceForPath("/completed-projects", items);

    assert.equal(fulfillmentWorkspace?.title, "成交履约");
    assert.equal(findWorkspaceTabForPath("/award-letters", fulfillmentWorkspace)?.path, "/award-letters");
    assert.equal(bidsWorkspace?.title, "我的投标");
    assert.equal(findWorkspaceTabForPath("/completed-projects", bidsWorkspace)?.path, "/completed-projects");
  }
});
