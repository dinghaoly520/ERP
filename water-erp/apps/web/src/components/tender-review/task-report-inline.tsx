'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ReviewTask, Issue, ReviewReport } from '@/lib/types/tender-review';
import { SEVERITY_COLORS, SEVERITY_LABELS } from '@/lib/types/tender-review';
import { getDownloadUrl, resolveIssue } from '@/lib/api/review';

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

interface TaskReportInlineProps {
  task: ReviewTask;
  onBack: () => void;
}

export default function TaskReportInline({ task: initialTask, onBack }: TaskReportInlineProps) {
  const [task, setTask] = useState<ReviewTask>(initialTask);
  const report = task.results as ReviewReport | null;
  const [issues, setIssues] = useState<Issue[]>(() => report ? flattenReport(report) : []);

  const initialIndex = useMemo(() => {
    const firstCritical = issues.findIndex(i => !i.passed && i.severity === 'critical');
    if (firstCritical >= 0) return firstCritical;
    const firstIssue = issues.findIndex(i => !i.passed);
    return firstIssue >= 0 ? firstIssue : 0;
  }, []);

  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  if (!report?.summary) {
    return (
      <div className="text-center py-8 text-[var(--muted-foreground)] text-xs">
        报告数据不完整
      </div>
    );
  }

  const selectedIssue = issues[selectedIndex];
  const totalIssues = issues.filter(i => !i.passed).length;
  const resolvedCount = issues.filter(i => i.status === 'accepted' || i.status === 'rejected').length;

  async function handleResolve(action: 'accept' | 'reject', editedSuggestion?: string) {
    if (!selectedIssue || selectedIssue.passed) return;
    try {
      const updated = await resolveIssue(task.id, selectedIndex, action, editedSuggestion);
      setTask(updated);
      setIssues(flattenReport(updated.results as ReviewReport));
      toast.success(action === 'accept' ? '已采纳' : '已拒绝');
    } catch {
      toast.error('操作失败');
    }
  }

  function handleDownload() {
    const url = getDownloadUrl(task.id);
    window.open(url, '_blank');
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium
            bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
        >
          <Download className="h-3 w-3" />
          导出
        </button>
      </div>

      {/* Document name */}
      <div className="text-sm font-medium text-[var(--foreground)] truncate">
        {task.documentName}
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3 p-2.5 rounded-[12px] bg-white/[0.02]">
        <div className="flex items-center gap-1.5 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5 text-[rgba(92,181,150,1)]" />
          <span className="text-[rgba(92,181,150,1)]">{report.summary.passed}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <XCircle className="h-3.5 w-3.5 text-[rgba(230,129,102,1)]" />
          <span className="text-[rgba(230,129,102,1)]">{report.summary.failed}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-[rgba(234,188,110,1)]" />
          <span className="text-[rgba(234,188,110,1)]">{report.summary.warnings}</span>
        </div>
        {totalIssues > 0 && (
          <div className="ml-auto text-xs text-[var(--muted-foreground)]">
            {resolvedCount}/{totalIssues} 已处理
          </div>
        )}
      </div>

      {/* Issue navigation */}
      {totalIssues > 0 && selectedIssue && (
        <div className="space-y-2">
          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex === 0}
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.02] disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-xs text-[var(--muted-foreground)]">
              {selectedIndex + 1} / {totalIssues}
            </div>
            <button
              onClick={() => setSelectedIndex(Math.min(totalIssues - 1, selectedIndex + 1))}
              disabled={selectedIndex >= totalIssues - 1}
              className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.02] disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Issue card */}
          <motion.div
            key={selectedIssue.id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-3 rounded-[14px] bg-white/[0.02] space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SEVERITY_COLORS[selectedIssue.severity]}`}>
                {SEVERITY_LABELS[selectedIssue.severity]}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                selectedIssue.status === 'accepted' ? 'bg-[rgba(92,181,150,0.12)] text-[rgba(92,181,150,1)]' :
                selectedIssue.status === 'rejected' ? 'bg-[rgba(230,129,102,0.12)] text-[rgba(230,129,102,1)]' :
                'bg-gray-400/10 text-gray-400'
              }`}>
                {selectedIssue.status === 'accepted' ? '已采纳' :
                 selectedIssue.status === 'rejected' ? '已拒绝' : '待处理'}
              </span>
            </div>

            <div className="text-xs font-medium text-[var(--foreground)]">
              {selectedIssue.title}
            </div>

            <div className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
              {selectedIssue.description}
            </div>

            {selectedIssue.evidence && (
              <div className="p-2 rounded-[8px] bg-white/[0.02] text-[10px] text-[var(--muted-foreground)]">
                <div className="font-medium mb-1">证据：</div>
                <div className="leading-relaxed">{selectedIssue.evidence}</div>
              </div>
            )}

            {selectedIssue.suggestion && (
              <div className="p-2 rounded-[8px] bg-[var(--accent)]/5 text-[10px] text-[var(--foreground)]">
                <div className="font-medium mb-1">建议：</div>
                <div className="leading-relaxed">
                  {typeof selectedIssue.suggestion === 'string'
                    ? selectedIssue.suggestion
                    : selectedIssue.suggestion.description}
                </div>
              </div>
            )}

            {/* Actions */}
            {selectedIssue.status === 'pending' && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleResolve('accept')}
                  className="flex-1 py-1.5 rounded-[10px] text-xs font-medium bg-[rgba(92,181,150,0.12)] text-[rgba(92,181,150,1)] hover:bg-[rgba(92,181,150,0.2)] transition-colors"
                >
                  采纳
                </button>
                <button
                  onClick={() => handleResolve('reject')}
                  className="flex-1 py-1.5 rounded-[10px] text-xs font-medium bg-[rgba(230,129,102,0.12)] text-[rgba(230,129,102,1)] hover:bg-[rgba(230,129,102,0.2)] transition-colors"
                >
                  拒绝
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
