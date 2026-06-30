'use client';

import { useState, useMemo } from 'react';
import { Download } from 'lucide-react';
import type { ReviewTask, Issue, ReviewReport } from '@/lib/types/tender-review';
import { fetchReviewTask, getDownloadUrl } from '@/lib/api/review';
import IssueNavigator from './issue-navigator';
import IssueDetail from './issue-detail';

function flattenReport(report: ReviewReport): Issue[] {
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

  return issues;
}

interface TaskReportViewProps {
  task: ReviewTask;
  onClose: () => void;
}

export default function TaskReportView({ task: initialTask, onClose }: TaskReportViewProps) {
  const [task, setTask] = useState<ReviewTask>(initialTask);
  const report = task.results as ReviewReport | null;
  const [issues, setIssues] = useState<Issue[]>(() => report ? flattenReport(report) : []);

  const initialIndex = useMemo(() => {
    const firstCritical = issues.findIndex(
      (i) => !i.passed && i.severity === 'critical',
    );
    if (firstCritical >= 0) return firstCritical;
    const firstIssue = issues.findIndex((i) => !i.passed);
    return firstIssue >= 0 ? firstIssue : 0;
  }, []);

  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  if (!report?.summary) return null;

  const acceptedCount = issues.filter((i) => i.status === 'accepted').length;
  const hasModifications = acceptedCount > 0 && !!task.objectKey;

  async function handleResolved(
    originalIndex: number,
    action: 'accept' | 'reject',
    editedSuggestion?: string,
  ) {
    setIssues((prev) =>
      prev.map((issue, idx) => {
        if (idx !== originalIndex) return issue;
        return {
          ...issue,
          status: action === 'accept' ? 'accepted' : 'rejected',
          ...(action === 'accept' && editedSuggestion
            ? { editedSuggestion }
            : {}),
          resolvedAt: new Date().toISOString(),
        };
      }),
    );
    fetchReviewTask(task.id).then(setTask).catch(() => {});
  }

  return (
    <div className="space-y-4">
      {/* Back + title bar */}
      <div className="flex items-center gap-4">
        <button
          onClick={onClose}
          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          ← 返回列表
        </button>
        <span className="text-xs font-medium text-[var(--foreground)]">
          {task.documentName}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          task.reviewMode === 'strict'
            ? 'text-indigo-400 bg-indigo-400/10'
            : 'text-purple-400 bg-purple-400/10'
        }`}>
          {task.reviewMode === 'strict' ? '严格审查' : '通用审查'}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">
          {new Date(task.createdAt).toLocaleString('zh-CN')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-[var(--muted-foreground)]">
            已采纳 {acceptedCount} 项
          </span>
          <a
            href={hasModifications ? getDownloadUrl(task.id) : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              hasModifications
                ? 'bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25'
                : 'bg-[var(--muted-foreground)]/5 text-[var(--muted-foreground)]/30 cursor-not-allowed pointer-events-none'
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            下载修改后文件
          </a>
        </div>
      </div>

      {/* Main layout: left nav + right detail */}
      <div
        className="flex rounded-2xl border border-gray-100 bg-gray-50/30 shadow-sm overflow-hidden"
        style={{ height: 'calc(100dvh - 160px)', minHeight: 480 }}
      >
        <div className="w-[300px] shrink-0 border-r border-gray-100 bg-gray-50/30 shadow-sm">
          <IssueNavigator
            issues={issues}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {issues[selectedIndex] ? (
            <IssueDetail
              key={selectedIndex}
              issue={issues[selectedIndex]}
              taskId={task.id}
              issueIndex={selectedIndex}
              documentName={task.documentName}
              onResolved={(action, editedSuggestion) =>
                handleResolved(selectedIndex, action, editedSuggestion)
              }
            />
          ) : (
            <div className="text-center py-20 text-[var(--muted-foreground)]/40">
              选择左侧问题查看详情
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
