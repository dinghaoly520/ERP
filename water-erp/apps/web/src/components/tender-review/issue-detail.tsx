'use client';

import type { Issue } from '@/lib/types/tender-review';
import { Search } from 'lucide-react';
import { SEVERITY_LABELS, SEVERITY_COLORS } from '@/lib/types/tender-review';
import OriginalTextCompare from './original-text-compare';
import SuggestionEditor from './suggestion-editor';

interface IssueDetailProps {
  issue: Issue;
  taskId: string;
  issueIndex: number;
  documentName: string;
  onResolved: (action: 'accept' | 'reject', editedSuggestion?: string) => Promise<void>;
}

export default function IssueDetail({
  issue,
  taskId,
  issueIndex,
  documentName,
  onResolved,
}: IssueDetailProps) {
  return (
    <div className="space-y-6">
      {/* Problem detail */}
      <section className="neu-tile p-4">
        <div className="text-xs font-semibold text-[color:var(--muted-foreground)] mb-3 flex items-center gap-2">
          {issue.notApplicable ? (
            <span>⬜ 不适用</span>
          ) : issue.passed ? (
            <span>✅ 通过</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" />
              问题详情
            </span>
          )}
          {issue.source === 'llm-free' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] bg-[color-mix(in_oklch,var(--accent-soft)_45%,transparent)] text-[color:var(--accent)] font-medium">
              AI 自主判断
            </span>
          )}
        </div>
        <div className={`rounded-[14px] p-3.5 border ${
          issue.notApplicable
            ? 'bg-[color-mix(in_oklch,var(--muted)_15%,transparent)] border-[color-mix(in_oklch,var(--muted-foreground)_15%,transparent)]'
            : 'bg-[color-mix(in_oklch,var(--danger)_6%,transparent)] border-[color-mix(in_oklch,var(--danger)_18%,transparent)]'
        }`}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${SEVERITY_COLORS[issue.severity]}`}>
              {SEVERITY_LABELS[issue.severity]}
            </span>
            <h3 className="text-xs font-semibold text-[var(--foreground)] leading-snug truncate">
              {issue.title}
            </h3>
          </div>
          {issue.description && (
            <div className="text-xs text-[var(--foreground)] leading-relaxed">
              {issue.description}
            </div>
          )}
        </div>
      </section>

      {/* Original text comparison */}
      {issue.documentExcerpt || issue.documentLocation?.excerpt || issue.kbExcerpt || issue.knowledgeBaseReferences?.[0]?.clauseContent ? (
        <section className="neu-tile p-4">
          <OriginalTextCompare
            documentExcerpt={issue.documentExcerpt}
            documentFileName={documentName}
            documentLocation={issue.documentLocation}
            kbExcerpt={issue.kbExcerpt}
            knowledgeBaseReferences={issue.knowledgeBaseReferences}
          />
        </section>
      ) : null}

      {/* Suggestion editor (not shown for passed items) */}
      {issue.passed !== true && (
        <section className="rounded-2xl border border-gray-100 bg-gray-50/30 shadow-sm p-4">
          <SuggestionEditor
            taskId={taskId}
            issueIndex={issueIndex}
            suggestion={issue.suggestion || ''}
            editedSuggestion={issue.editedSuggestion}
            status={issue.status || 'pending'}
            onResolved={onResolved}
          />
        </section>
      )}
    </div>
  );
}
