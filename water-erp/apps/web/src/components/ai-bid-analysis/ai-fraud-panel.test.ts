import test from "node:test";
import assert from "node:assert/strict";

import { buildPriceComparisonData } from "./ai-fraud-panel-price-data";
import type { AiBidder } from "./ai-fraud-panel-price-data";

const baseBidder = {
  id: "bidder-1",
  taskId: "task-1",
  fileId: null,
  fileName: null,
  status: "COMPLETED",
  extractedInfo: null,
  scores: null,
  totalScore: null,
  qualificationStatus: null,
  riskLevel: null,
  riskAnalysis: null,
  strengths: null,
  weaknesses: null,
  overallComment: null,
  deviationAnalysis: null,
  competitiveAnalysis: null,
  createdAt: "2026-05-28T00:00:00.000Z",
  processedAt: null,
} satisfies Omit<AiBidder, "name" | "keyInfo">;

function bidder(name: string, quotePrice: unknown): AiBidder {
  return {
    ...baseBidder,
    id: name,
    name,
    keyInfo: {
      bidderName: name,
      legalPerson: "",
      registeredCapital: "",
      establishedDate: "",
      quotePrice: quotePrice as number,
      quotePriceYuan: "",
      priceValidity: 0,
      qualificationLevel: "",
      qualificationName: "",
      qualificationStatus: "待审查",
      performanceCount: 0,
      keyPerformances: [],
      projectManager: "",
      projectManagerTitle: "",
      constructionPeriod: "",
      warrantyPeriod: "",
      contactInfo: { phone: "", email: "", address: "" },
      missingItems: [],
    },
  };
}

test("builds price chart data from formatted quote prices", () => {
  const data = buildPriceComparisonData([
    bidder("甲公司", "1,539,500.00元"),
    bidder("乙公司", "102.4万元"),
  ]);

  assert.deepEqual(data, [
    { name: "乙公司", price: 102.4 },
    { name: "甲公司", price: 153.95 },
  ]);
});
