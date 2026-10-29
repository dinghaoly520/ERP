import { ReviewReportDocxService, flattenIssuesForReport } from './review-report-docx.service';

const REPORT = {
  summary: { totalChecks: 3, passed: 1, failed: 1, warnings: 1 },
  criticalIssues: [
    { ruleId: 'r1', ruleName: '资质要求', severity: 'critical', details: '缺少资质条款', suggestion: '补充条款', status: 'accepted', resolvedAt: '2026-10-28T10:00:00Z' },
  ],
  warnings: [
    { ruleId: 'r2', ruleName: '时限', severity: 'warning', details: '时限表述不清', suggestion: '明确天数', status: 'rejected', resolvedAt: '2026-10-28T10:01:00Z' },
  ],
  passedChecks: [{ ruleId: 'r3', ruleName: '签章', severity: 'info', details: '已含签章要求', passed: true }],
  llmFreeIssues: [
    { severity: 'info', description: '建议补充违约责任章节。', evidence: '', suggestion: '增加', status: 'pending', source: 'llm-free', sectionName: '合同条款' },
  ],
};

const TASK: any = {
  id: 't-1',
  documentName: '采购文件-测试.docx',
  reviewMode: 'general',
  status: 'completed',
  results: REPORT,
  createdAt: new Date('2026-10-28T09:00:00Z'),
  completedAt: new Date('2026-10-28T09:05:00Z'),
  knowledgeBaseId: 'kb-1',
  projectId: 'p-1',
};

describe('flattenIssuesForReport', () => {
  it('三类来源全展开并统一字段', () => {
    const rows = flattenIssuesForReport(REPORT);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ title: '资质要求', status: '已接受' });
    expect(rows[3]).toMatchObject({ sectionName: '合同条款', status: '未处置' });
  });
});

describe('ReviewReportDocxService', () => {
  const svc = new ReviewReportDocxService();

  it('generate 产出 docx buffer（zip 魔数 PK）与文件名', async () => {
    const { buffer, fileName } = await svc.generate(TASK, { kbName: '水利制度库', projectTitle: '测试项目' });
    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // docx = zip
    expect(fileName).toBe('采购文件-测试-审查报告.docx');
  });

  it('报告 HTML 含项目名/模式/统计/处置留痕', async () => {
    const html = svc.buildReportHtml(TASK, { kbName: '水利制度库', projectTitle: '测试项目' });
    expect(html).toContain('测试项目');
    expect(html).toContain('智能审查');
    expect(html).toContain('通过 1');
    expect(html).toContain('已接受');
    expect(html).toContain('已拒绝');
    expect(html).toContain('未处置');
  });
});
