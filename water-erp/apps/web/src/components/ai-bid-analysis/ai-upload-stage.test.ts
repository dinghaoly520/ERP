import test from 'node:test';
import assert from 'node:assert/strict';

import { getUploadMetrics } from './ai-upload-stage';
import type { AiBidAnalysisTask } from '@/lib/types/ai-bid-analysis';

const baseTask = {
  id: 'task-1',
  name: '测试任务',
  projectName: null,
  status: 'TENDER_PROCESSING',
  tenderFileId: null,
  tenderFileName: null,
  requirements: null,
  bidders: [],
  report: null,
  createdAt: '2026-05-28T00:00:00.000Z',
  completedAt: null,
} satisfies AiBidAnalysisTask;

test('getUploadMetrics keeps readiness at 0 before any upload or bidder setup', () => {
  const metrics = getUploadMetrics(
    {
      ...baseTask,
      status: 'CREATED',
      tenderFiles: [],
      bidders: [],
    },
  );

  assert.equal(metrics.readinessChecks.length, 4);
  assert.equal(metrics.readinessPercent, 0);
  assert.equal(metrics.readinessChecks.filter((item) => item.passed).length, 0);
  assert.equal(metrics.pendingIssueCount, 4);
});

test('getUploadMetrics reaches 100% when main file, bidders and bidder files are all uploaded with a startable status', () => {
  const task = {
    ...baseTask,
    status: 'CREATED',
    tenderFiles: [
      { id: 'main', taskId: 'task-1', fileId: 'file-1', fileName: '主文件.pdf', text: null, pages: null, isMain: true, order: 0, createdAt: '2026-05-28T00:00:00.000Z' },
    ],
    bidders: [
      { id: 'b1', taskId: 'task-1', name: '甲公司', fileId: 'bid-1', fileName: '甲公司.pdf', status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
    ],
  } satisfies AiBidAnalysisTask;

  const metrics = getUploadMetrics(task);

  assert.equal(metrics.readinessChecks.length, 4);
  assert.equal(metrics.readinessPercent, 100);
  assert.equal(metrics.pendingIssueCount, 0);
  assert.equal(metrics.readinessChecks[3].passed, true);
  assert.equal(metrics.readinessChecks[3].label, '可以启动分析');
});

test('getUploadMetrics stays at 100% after analysis starts (ANALYZING status)', () => {
  const task = {
    ...baseTask,
    status: 'ANALYZING',
    tenderFiles: [
      { id: 'main', taskId: 'task-1', fileId: 'file-1', fileName: '主文件.pdf', text: null, pages: null, isMain: true, order: 0, createdAt: '2026-05-28T00:00:00.000Z' },
    ],
    bidders: [
      { id: 'b1', taskId: 'task-1', name: '甲公司', fileId: 'bid-1', fileName: '甲公司.pdf', status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
    ],
  } satisfies AiBidAnalysisTask;

  const metrics = getUploadMetrics(task);

  assert.equal(metrics.readinessChecks.length, 4);
  assert.equal(metrics.readinessPercent, 100);
  assert.equal(metrics.pendingIssueCount, 0);
  assert.equal(metrics.readinessChecks[3].passed, true);
  assert.equal(metrics.readinessChecks[3].label, '可以启动分析');
  assert.equal(metrics.recommendation, '分析进行中或已完成。');
});

test('getUploadMetrics stays at 100% during tender processing', () => {
  const task = {
    ...baseTask,
    status: 'TENDER_PROCESSING',
    tenderFiles: [
      { id: 'main', taskId: 'task-1', fileId: 'file-1', fileName: '主文件.pdf', text: null, pages: null, isMain: true, order: 0, createdAt: '2026-05-28T00:00:00.000Z' },
    ],
    bidders: [
      { id: 'b1', taskId: 'task-1', name: '甲公司', fileId: 'bid-1', fileName: '甲公司.pdf', status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
    ],
  } satisfies AiBidAnalysisTask;

  const metrics = getUploadMetrics(task);

  assert.equal(metrics.readinessChecks.length, 4);
  assert.equal(metrics.readinessPercent, 100);
  assert.equal(metrics.pendingIssueCount, 0);
  assert.equal(metrics.readinessChecks[3].passed, true);
});

test('getUploadMetrics reaches 100% when all pre-start conditions are met', () => {
  const task = {
    ...baseTask,
    status: 'BIDDERS_UPLOADING',
    tenderFiles: [
      { id: 'main', taskId: 'task-1', fileId: 'file-1', fileName: '主文件.pdf', text: null, pages: null, isMain: true, order: 0, createdAt: '2026-05-28T00:00:00.000Z' },
    ],
    bidders: [
      { id: 'b1', taskId: 'task-1', name: '甲公司', fileId: 'bid-1', fileName: '甲公司.pdf', status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
      { id: 'b2', taskId: 'task-1', name: '乙公司', fileId: 'bid-2', fileName: '乙公司.pdf', status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
    ],
  } satisfies AiBidAnalysisTask;

  const metrics = getUploadMetrics(task);

  assert.equal(metrics.readinessChecks.length, 4);
  assert.equal(metrics.readinessPercent, 100);
  assert.equal(metrics.pendingIssueCount, 0);
});

test('getUploadMetrics shows partial readiness when bidder files are missing', () => {
  const task = {
    ...baseTask,
    status: 'CREATED',
    tenderFiles: [
      { id: 'main', taskId: 'task-1', fileId: 'file-1', fileName: '主文件.pdf', text: null, pages: null, isMain: true, order: 0, createdAt: '2026-05-28T00:00:00.000Z' },
    ],
    bidders: [
      { id: 'b1', taskId: 'task-1', name: '甲公司', fileId: 'bid-1', fileName: '甲公司.pdf', status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
      { id: 'b2', taskId: 'task-1', name: '乙公司', fileId: null, fileName: null, status: 'PENDING', keyInfo: null, extractedInfo: null, scores: null, totalScore: null, qualificationStatus: null, riskLevel: null, riskAnalysis: null, strengths: null, weaknesses: null, overallComment: null, deviationAnalysis: null, competitiveAnalysis: null, createdAt: '2026-05-28T00:00:00.000Z', processedAt: null },
    ],
  } satisfies AiBidAnalysisTask;

  const metrics = getUploadMetrics(task);

  assert.equal(metrics.readinessChecks.length, 4);
  assert.equal(metrics.readinessPercent, 50);
  assert.equal(metrics.pendingIssueCount, 2);
  assert.match(metrics.recommendation, /先补齐/);
});
