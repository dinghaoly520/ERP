import { Injectable } from '@nestjs/common';
import { Document, Packer } from 'docx';
import { htmlToDocxChildren } from '../../project-management/docx/html-to-docx.converter';
import { convertOfficeToPdf } from '../../common/office-to-pdf.util';

export interface PdfIssueRow {
  sectionName: string;
  severity: string;
  title: string;
  description: string;
  evidence: string;
  suggestion: string;
  status: string;
  resolvedAt: string | null;
}

const SEVERITY_LABEL: Record<string, string> = { critical: '严重', warning: '警告', info: '提示' };
const STATUS_LABEL: Record<string, string> = { accepted: '已接受', rejected: '已拒绝', pending: '未处置' };

/** 三类来源（规则/智能章节/基础检查）统一展开——与前端 flattenReport 同口径（spec §8 处置留痕） */
export function flattenIssuesForPdf(report: any): PdfIssueRow[] {
  const rows: PdfIssueRow[] = [];
  const push = (
    r: any,
    defaults: { sectionName?: string; title?: string },
  ) => {
    const suggestion =
      typeof r.suggestion === 'string'
        ? r.suggestion
        : r.suggestion?.description ?? '';
    rows.push({
      sectionName: r.sectionName || defaults.sectionName || '',
      severity: SEVERITY_LABEL[r.severity] || r.severity || '',
      title: defaults.title || String(r.description || '').split(/[。，；]/)[0] || '',
      description: r.details || r.description || '',
      evidence: r.evidence || '',
      suggestion,
      status: STATUS_LABEL[r.status || 'pending'] || '未处置',
      resolvedAt: r.resolvedAt || null,
    });
  };
  if (report?.generalResults) {
    report.generalResults.forEach((section: any) =>
      section.issues.forEach((issue: any) => push(issue, { sectionName: section.sectionName })),
    );
  } else {
    [...(report?.criticalIssues || []), ...(report?.warnings || []), ...(report?.passedChecks || [])].forEach(
      (r: any) => push(r, { title: r.ruleName }),
    );
  }
  (report?.llmFreeIssues || []).forEach((issue: any) => push(issue, {}));
  return rows;
}

@Injectable()
export class ReviewReportPdfService {
  /** 组装报告 HTML（h1-h3/p/strong/table——htmlToDocxChildren 支持的标签集） */
  buildReportHtml(
    task: {
      documentName: string;
      reviewMode: string;
      results: unknown;
      createdAt: Date;
      completedAt: Date | null;
      projectId: string | null;
    },
    meta: { kbName: string | null; projectTitle: string | null },
  ): string {
    const report: any = task.results || { summary: { totalChecks: 0, passed: 0, failed: 0, warnings: 0 } };
    const rows = flattenIssuesForPdf(report);
    const modeLabel = task.reviewMode === 'strict' ? '规则审查' : '智能审查';
    const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString('zh-CN', { hour12: false }) : '—');
    const esc = (s: string) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
<h1>采购文件审查报告</h1>
<p><strong>所属项目：</strong>${esc(meta.projectTitle || '—')}</p>
<p><strong>审查文件：</strong>${esc(task.documentName)}</p>
<p><strong>审查模式：</strong>${modeLabel}　<strong>知识库：</strong>${esc(meta.kbName || '—')}</p>
<p><strong>开始时间：</strong>${fmt(task.createdAt)}　<strong>完成时间：</strong>${fmt(task.completedAt)}　<strong>报告生成：</strong>${fmt(new Date())}</p>
<h2>一、审查概览</h2>
<table>
  <tr><td>总检查项</td><td>通过</td><td>警告</td><td>不通过</td></tr>
  <tr><td>${report.summary.totalChecks}</td><td>通过 ${report.summary.passed}</td><td>警告 ${report.summary.warnings}</td><td>不通过 ${report.summary.failed}</td></tr>
</table>
<h2>二、问题明细（含处置留痕）</h2>
<table>
  <tr><td>序号</td><td>章节/规则</td><td>严重度</td><td>问题描述</td><td>修改建议</td><td>处置结果</td></tr>
  ${rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(r.sectionName || r.title)}</td><td>${r.severity}</td><td>${esc(r.description)}</td><td>${esc(r.suggestion)}</td><td>${r.status}${r.resolvedAt ? '（' + fmt(new Date(r.resolvedAt)) + '）' : ''}</td></tr>`,
    )
    .join('\n')}
</table>
<p>本报告由智慧水发·蜀水云采采购管理系统自动生成，处置留痕与在线审查结果一致。</p>`;
  }

  async generate(
    task: {
      documentName: string;
      reviewMode: string;
      results: unknown;
      createdAt: Date;
      completedAt: Date | null;
      projectId: string | null;
    },
    meta: { kbName: string | null; projectTitle: string | null },
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const html = this.buildReportHtml(task, meta);
    const doc = new Document({ sections: [{ properties: {}, children: htmlToDocxChildren(html) }] });
    const docxBuffer = Buffer.from(await Packer.toBuffer(doc));
    const docxName = task.documentName.replace(/\.docx?$/i, '') + '-审查报告.docx';
    const pdf = convertOfficeToPdf(
      docxBuffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docxName,
    );
    if (!pdf) {
      throw new Error('PDF 转换失败（LibreOffice 不可用），请稍后重试或联系管理员');
    }
    return { buffer: pdf.buffer, fileName: docxName.replace(/\.docx$/, '.pdf') };
  }
}
