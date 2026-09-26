import test from "node:test";
import assert from "node:assert/strict";
import {
  TREND_LABEL_MIN_SLOT_PX,
  trendLabelStep,
  isTrendLabelShown,
} from "./trend-axis";

test("trendLabelStep keeps every label when buckets have enough horizontal room", () => {
  assert.equal(trendLabelStep(4, 1200), 1);
  assert.equal(trendLabelStep(12, 1296), 1);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(isTrendLabelShown(i, 4, 1), true);
  }
});

test("trendLabelStep thins labels when buckets get denser than the minimum slot", () => {
  // 30 桶挤在 1200px：slot=40px < 46px → 每隔 2 桶显示一个
  assert.equal(trendLabelStep(30, 1200), 2);
  const shown = Array.from({ length: 30 }, (_, i) => i).filter((i) =>
    isTrendLabelShown(i, 30, 2),
  );
  assert.deepEqual(shown.slice(0, 4), [0, 2, 4, 6]);
  assert.equal(shown[shown.length - 1], 29, "最后一个桶必须始终显示");
});

test("isTrendLabelShown forces the last bucket even off the step grid", () => {
  // step=2、4 桶：0/2 在格点上，3 是末桶也要显示
  assert.equal(isTrendLabelShown(3, 4, 2), true);
  assert.equal(isTrendLabelShown(1, 4, 2), false);
});

test("degenerate inputs never divide by zero and never show labels for an empty axis", () => {
  assert.equal(trendLabelStep(0, 1200), 1);
  assert.equal(trendLabelStep(5, 0), 1);
  assert.equal(isTrendLabelShown(0, 0, 1), false);
});

test("minimum slot constant is a deliberate design value (label ~28px + 间隙)", () => {
  assert.equal(TREND_LABEL_MIN_SLOT_PX, 46);
});
