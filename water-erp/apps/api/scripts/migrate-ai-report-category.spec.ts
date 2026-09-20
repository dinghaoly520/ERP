// apps/api/scripts/migrate-ai-report-category.spec.ts
import { planAiReportCategoryMigrations, TARGET_CATEGORY, AiReportRow } from './migrate-ai-report-category';

describe('planAiReportCategoryMigrations（AI 报告类目迁移计划）', () => {
  const mk = (id: string, key: string, category: string) => ({ id, key, category });

  it('待迁移：general → ai_bid_report', () => {
    const reports: AiReportRow[] = [{ id: 'r1', taskId: 't1', docxFileId: 'fa1', pdfFileId: null }];
    const assets = new Map([['fa1', mk('fa1', 'reports/t1/ai-bid-analysis-report.docx', 'general')]]);
    expect(planAiReportCategoryMigrations(reports, assets).migrations).toEqual([
      { fileAssetId: 'fa1', key: 'reports/t1/ai-bid-analysis-report.docx', from: 'general' },
    ]);
  });

  it('已合规跳过；孤儿资产（FileAsset 缺行）列入 missing 不动', () => {
    const reports: AiReportRow[] = [
      { id: 'r1', taskId: 't1', docxFileId: 'fa1', pdfFileId: null },
      { id: 'r2', taskId: 't2', docxFileId: 'fa2', pdfFileId: 'fa3' },
    ];
    const assets = new Map([['fa1', mk('fa1', 'k1', 'ai_bid_report')]]); // fa2/fa3 缺行
    const plan = planAiReportCategoryMigrations(reports, assets);
    expect(plan.migrations).toEqual([]);
    expect(plan.missing).toEqual(['fa2', 'fa3']);
  });

  it('目标类目常量为 ai_bid_report', () => {
    expect(TARGET_CATEGORY).toBe('ai_bid_report');
  });
});
