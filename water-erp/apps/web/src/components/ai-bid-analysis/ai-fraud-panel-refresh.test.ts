import test from "node:test";
import assert from "node:assert/strict";

import { loadFraudDetectionPanelData } from "./ai-fraud-panel-refresh";
import type { FraudIndicators } from "@/lib/types/ai-bid-analysis";

const fraudData = {
  riskLevel: "low",
  indicators: [],
  overallAssessment: "低风险",
  summary: { highCount: 0, mediumCount: 0, lowCount: 0, totalCount: 0 },
} satisfies FraudIndicators;

test("refreshing fraud detection reloads task detail for price chart data", async () => {
  let taskReloads = 0;

  await loadFraudDetectionPanelData({
    taskId: "task-1",
    loadFraudDetection: async () => fraudData,
    setLoading: () => {},
    setError: () => {},
    setFraudData: () => {},
    reloadTask: async () => {
      taskReloads += 1;
    },
  });

  assert.equal(taskReloads, 1);
});
