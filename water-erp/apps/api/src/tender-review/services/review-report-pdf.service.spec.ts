jest.mock('../../common/office-to-pdf.util', () => ({
  convertOfficeToPdf: jest.fn(() => ({ buffer: Buffer.from('%PDF-mock'), fileName: 'x.pdf' })),
}));
import { convertOfficeToPdf } from '../../common/office-to-pdf.util';
import { ReviewReportPdfService, flattenIssuesForPdf } from './review-report-pdf.service';

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

describe('flattenIssuesForPdf', () => {
  it('三类来源全展开并统一字段', () => {
    const rows = flattenIssuesForPdf(REPORT);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ title: '资质要求', status: '已接受' });
    expect(rows[3]).toMatchObject({ sectionName: '合同条款', status: '未处置' });
  });
});

describe('ReviewReportPdfService', () => {
  const svc = new ReviewReportPdfService();

  it('generate 产出 PDF buffer 与文件名', async () => {
    const { buffer, fileName } = await svc.generate(TASK, { kbName: '水利制度库', projectTitle: '测试项目' });
    expect(buffer.toString()).toBe('%PDF-mock');
    expect(fileName).toBe('采购文件-测试-审查报告.pdf');
    expect(convertOfficeToPdf).toHaveBeenCalled();
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

  it('转换失败（LibreOffice 缺失）抛明确错误', async () => {
    (convertOfficeToPdf as jest.Mock).mockReturnValueOnce(null);
    await expect(svc.generate(TASK, { kbName: null, projectTitle: null })).rejects.toThrow('PDF');
  });
});
