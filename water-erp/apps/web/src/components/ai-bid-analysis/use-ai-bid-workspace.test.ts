import test from "node:test";
import assert from "node:assert/strict";

import { buildViewModel } from "./ai-bid-workspace-view-model";
import type { AiBidAnalysisTask } from "@/lib/types/ai-bid-analysis";

const taskWithParsedTenderFile = {
  id: "task-1",
  name: "测试任务",
  projectName: null,
  status: "CREATED",
  tenderFileId: null,
  tenderFileName: null,
  tenderFiles: [
    {
      id: "tender-file-1",
      taskId: "task-1",
      fileId: "file-1",
      fileName: "招标文件.pdf",
      text: "parsed text",
      pages: [],
      isMain: true,
      order: 0,
      createdAt: "2026-05-28T00:00:00.000Z",
    },
  ],
  requirements: null,
  bidders: [],
  report: null,
  createdAt: "2026-05-28T00:00:00.000Z",
  completedAt: null,
} satisfies AiBidAnalysisTask;

test("treats parsed tenderFiles as an uploaded tender document", () => {
  const viewModel = buildViewModel(taskWithParsedTenderFile);

  assert.equal(viewModel.summary.missingTenderFile, false);
});

test('uses startable task statuses for uploaded bidder files', () => {
  const viewModel = buildViewModel({
    ...taskWithParsedTenderFile,
    status: 'BIDDERS_UPLOADING',
    bidders: [
      { id: 'b1', taskId: 'task-1', name: '甲公司', fileId: 'bid-1', fileName: '甲公司.pdf', status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
    ],
  });

  assert.equal(viewModel.summary.canStartAnalysis, true);
});
