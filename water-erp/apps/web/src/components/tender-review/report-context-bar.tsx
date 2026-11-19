'use client';

import { useMemo } from 'react';
import { ArrowLeft, Download, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import type { ReviewTask, Issue, ReviewReport, LlmFreeIssue } from '@/lib/types/tender-review';
import { getDownloadUrl, getReportDocxUrl } from '@/lib/api/review';
import { apiFetch } from '@/lib/api/api-fetch';

/** 文档名编号分离（2026-11-12；2026-11-18 自 report-view-combined 迁入本文件供两处共用）：
 *  形如「SWHI-TP-2026111201-名称…」/「TP-2026101901-名称…」——前段 字母数字(-字母2-4)?-数字4+
 *  即项目编号；匹配失败整名作标题（不拆）。 */
export const DOC_CODE_RE = /^([A-Za-z0-9]+(?:-[A-Za-z]{1,4})?-\d{4,})-(.+)$/;

/** 报告结构拍平为问题列表（2026-11-18 自 report-view-combined 迁入，逻辑不变） */
export function flattenReport(report: ReviewReport): Issue[] {
  const issues: Issue[] = [];

  if (report.generalResults) {
    report.generalResults.forEach((section) => {
      section.issues.forEach((issue, idx) => {
        issues.push({
          id: `gen-${section.sectionName}-${idx}`,
          severity: issue.severity,
          title: issue.description.split(/[。，；]/)[0] || issue.description,
          description: issue.description,
          evidence: issue.evidence || '',
          suggestion: issue.suggestion || '',
          documentExcerpt: issue.documentExcerpt,
          kbExcerpt: issue.kbExcerpt,
          documentLocation: issue.documentLocation,
          knowledgeBaseReferences: issue.knowledgeBaseReferences,
          sectionName: section.sectionName,
          source: issue.relatedClause,
          status: issue.status || 'pending',
          editedSuggestion: issue.editedSuggestion,
          resolvedAt: issue.resolvedAt,
        });
      });
    });
  } else {
    const addResults = (results: any[], passed: boolean) => {
      results.forEach((r, idx) => {
        issues.push({
          id: `${r.ruleId || idx}`,
          severity: r.severity,
          title: r.ruleName || r.details?.split(/[。，；]/)[0] || '检查项',
          description: r.details || '',
          evidence: r.evidence || '',
          suggestion: r.suggestion ?? '',
          documentExcerpt: r.documentExcerpt,
          kbExcerpt: r.kbExcerpt,
          documentLocation: r.documentLocation,
          knowledgeBaseReferences: r.knowledgeBaseReferences,
          ruleType: r.ruleType,
          source: r.source,
          status: r.status || 'pending',
          editedSuggestion: r.editedSuggestion,
          resolvedAt: r.resolvedAt,
          passed,
          notApplicable: r.notApplicable,
          dataMissing: r.dataMissing,
        });
      });
    };
    addResults(report.criticalIssues || [], false);
    addResults(report.warnings || [], false);
    addResults(report.passedChecks || [], true);
  }

  if (report.llmFreeIssues) {
    report.llmFreeIssues.forEach((issue: LlmFreeIssue, idx: number) => {
      issues.push({
        id: `llm-free-${idx}`,
        severity: issue.severity,
        title: issue.description.split(/[。，；]/)[0] || issue.description,
        description: issue.description,
        evidence: issue.evidence || '',
        suggestion: issue.suggestion || '',
        documentExcerpt: issue.documentExcerpt,
        documentLocation: issue.documentLocation,
        sectionName: issue.sectionName,
        source: 'llm-free',
        status: issue.status || 'pending',
        editedSuggestion: issue.editedSuggestion,
        resolvedAt: issue.resolvedAt,
      });
    });
  }

  return issues;
}

/**
 * 报告详情上下文条（2026-11-18 自 ReportViewCombined 头部升格）：
 * 独立审查页（/tender-review）挂在 hero 内 hairline 下第二行（tender-write 类型切换位）；
 * 编写弹窗审查流（project-review-flow）仍在详情原位渲染。
 * 布局：[← 返回] [文件名 truncate + 编号/模式 chip + 已采纳计数] ——弹性—— [导出修订文件] [审查报告 Word]。
 */
export default function ReportContextBar({ task, onBack }: { task: ReviewTask; onBack?: () => void }) {
  const issues = useMemo(
    () => (task.results ? flattenReport(task.results as ReviewReport) : []),
    [task],
  );
  const acceptedCount = issues.filter((i) => i.status === 'accepted').length;
  const hasModifications = acceptedCount > 0 && !!task.objectKey;
  const codeMatch = DOC_CODE_RE.exec(task.documentName);

  function handleDownload() {
    if (hasModifications) {
      window.open(getDownloadUrl(task.id), '_blank');
    }
  }

  // 审查报告 Word（含处置留痕）——项目管理流与独立审查页共用；需 PDF 时在 Word 侧另存
  async function handleDownloadWord() {
    try {
      const res = await apiFetch(getReportDocxUrl(task.id), { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || '报告下载失败，请稍后重试');
      }
      const blob = await res.blob();
      const disp = res.headers.get('content-disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
      const fileName = m
        ? decodeURIComponent(m[1])
        : `${task.documentName.replace(/\.docx?$/i, '')}-审查报告.docx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '报告下载失败');
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex shrink-0 items-center gap-1 text-xs text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]"
        >
          <ArrowLeft size={13} />返回
        </button>
      )}
      {/* 名字组：文件名按内容宽度、胶囊紧贴其后（空间不足时才收缩截断） */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          title={task.documentName}
          className="min-w-0 truncate text-[13px] font-medium text-[color:var(--foreground)]"
        >
          {codeMatch ? codeMatch[2] : task.documentName}
        </span>
        {codeMatch && (
          <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold tabular-nums tracking-[0.04em] text-[var(--accent)]">
            {codeMatch[1]}
          </span>
        )}
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
          task.reviewMode === 'strict'
            ? 'bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--accent)]'
            : 'bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] text-[var(--muted-foreground)]'
        }`}>
          {task.reviewMode === 'strict' ? '严格审查' : '通用审查'}
        </span>
      </div>
      {/* 操作组：右侧收尾，与名字组之间为弹性空隙（无分隔线） */}
      <div className="flex shrink-0 items-center gap-2.5">
        {acceptedCount > 0 && (
          <span className="shrink-0 text-xs text-[var(--muted-foreground)]">已采纳 {acceptedCount} 项</span>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={!hasModifications}
          className="neu-btn-soft shrink-0"
          title="下载已采纳修改建议的采购文件（docx）"
        >
          <Download size={14} />导出修订文件
        </button>
        <button type="button" onClick={() => void handleDownloadWord()} className="neu-btn-soft shrink-0">
          <FileDown size={14} />审查报告 Word
        </button>
      </div>
    </div>
  );
}
