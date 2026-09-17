'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  isStructuredSuggestion,
  getSuggestionDescription,
  type StructuredSuggestion,
} from '@/lib/types/tender-review';

interface SuggestionEditorProps {
  taskId: string;
  issueIndex: number;
  suggestion: string | StructuredSuggestion;
  editedSuggestion?: string;
  status: 'pending' | 'accepted' | 'rejected';
  onResolved: (action: 'accept' | 'reject', editedSuggestion?: string) => Promise<void>;
}

function DiffPreview({ suggestion, accepted = false }: { suggestion: StructuredSuggestion; accepted?: boolean }) {
  if (suggestion.operation === 'manual') {
    return <div className="text-sm text-[var(--muted-foreground)] leading-relaxed">{suggestion.description}</div>;
  }

  const textSize = accepted ? 'text-sm' : 'text-xs';

  return (
    <div className="space-y-2">
      {suggestion.originalText && (
        <div className={`rounded-lg p-2.5 ${accepted ? 'bg-gray-100/50 border border-gray-200/50' : 'bg-[color-mix(in_oklch,var(--danger)_6%,transparent)] border border-[color-mix(in_oklch,var(--danger)_20%,transparent)]'}`}>
          <div className={`text-[10px] font-semibold mb-1 ${accepted ? 'text-gray-400' : 'text-[var(--danger)]'}`}>
            {suggestion.operation === 'replace' ? '替换原文' : '删除'}
          </div>
          <div className={`${textSize} line-through leading-relaxed whitespace-pre-wrap ${accepted ? 'text-gray-400' : 'text-[var(--foreground)]'}`}>
            {suggestion.originalText}
          </div>
        </div>
      )}
      {suggestion.replacementText && (
        <div className={`rounded-lg p-2.5 ${accepted ? 'bg-red-50/50 border border-red-200/40' : 'bg-[color-mix(in_oklch,var(--success)_6%,transparent)] border border-[color-mix(in_oklch,var(--success)_20%,transparent)]'}`}>
          <div className={`text-[10px] font-semibold mb-1 ${accepted ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
            {suggestion.operation === 'insert' ? '插入内容' : '替换为'}
          </div>
          <div className={`${textSize} leading-relaxed whitespace-pre-wrap ${accepted ? 'text-[var(--danger)]' : 'text-[var(--foreground)]'}`}>
            {suggestion.replacementText}
          </div>
        </div>
      )}
      {suggestion.description && (
        <div className="text-[11px] text-[var(--muted-foreground)]/80 italic">{suggestion.description}</div>
      )}
    </div>
  );
}

export default function SuggestionEditor({
  taskId,
  issueIndex,
  suggestion,
  editedSuggestion,
  status,
  onResolved,
}: SuggestionEditorProps) {
  const description = getSuggestionDescription(suggestion);
  const structured = isStructuredSuggestion(suggestion) ? suggestion : null;
  const [text, setText] = useState(editedSuggestion || description || '');
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);
    try {
      const edited = text !== description ? text : undefined;
      await onResolved('accept', edited);
      toast.success(structured?.operation !== 'manual' ? '已接受修改，原文已更新' : '已接受修改意见');
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    try {
      await onResolved('reject');
      toast.success('已拒绝修改意见');
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleUndo() {
    setLoading(true);
    try {
      await onResolved('reject');
      toast.success('已撤销采纳');
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function handleReprocess() {
    setLoading(true);
    try {
      await onResolved('accept');
      toast.success('已重新采纳');
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  const isAutoModify = structured && structured.operation !== 'manual';

  if (status === 'accepted') {
    return (
      <div>
        <div className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">
          ✏️ 修改意见
        </div>
        <div className="rounded-xl border border-[color-mix(in_oklch,var(--success)_30%,transparent)] overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[color-mix(in_oklch,var(--success)_8%,transparent)] flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[var(--success)]">
              ✅ 已修改
            </span>
            <button
              onClick={handleUndo}
              disabled={loading}
              className="px-2.5 py-1 rounded-[10px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-[var(--danger)] hover:bg-[color-mix(in_oklch,var(--danger)_20%,transparent)] transition-colors"
              style={{ fontSize: 12 }}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '放弃修改'}
            </button>
          </div>
          {isAutoModify ? (
            <div className="px-3.5 py-3">
              <DiffPreview suggestion={structured} accepted />
            </div>
          ) : (
            <div className="px-3.5 py-3 text-sm text-[var(--muted-foreground)] leading-relaxed opacity-70">
              {editedSuggestion || description}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="opacity-50">
        <div className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">
          ✏️ 修改意见
        </div>
        <div className="rounded-xl border border-[var(--muted-foreground)]/10 overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[var(--muted-foreground)]/[0.03] flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">已拒绝</span>
            <button
              onClick={handleReprocess}
              disabled={loading}
              className="text-[11px] px-2.5 py-1 rounded-[10px] bg-[var(--muted-foreground)]/10 text-[var(--muted-foreground)] hover:bg-[var(--muted-foreground)]/20 transition-colors"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '重新处理'}
            </button>
          </div>
          <div className="px-3.5 py-3 text-xs text-[var(--muted-foreground)] leading-relaxed">
            {description}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">
        ✏️ 修改意见
      </div>
      <div className="rounded-xl border border-[var(--muted-foreground)]/15 overflow-hidden">
        <div className="px-3.5 py-2.5 bg-[var(--muted-foreground)]/[0.03]">
        </div>
        {isAutoModify ? (
          <div className="px-3.5 py-3">
            <DiffPreview suggestion={structured} />
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full min-h-[160px] max-h-[300px] px-3.5 py-3 bg-transparent text-[var(--foreground)] leading-relaxed resize-y outline-none placeholder:text-[var(--muted-foreground)]/30"
            style={{ fontSize: 12 }}
            placeholder="暂无修改建议"
          />
        )}
        <div className="flex justify-end gap-2 px-3.5 py-2.5 border-t border-[var(--muted-foreground)]/[0.08]">
          <button
            onClick={handleAccept}
            disabled={loading}
            className="px-3 py-1 rounded-[14px] bg-[color-mix(in_oklch,var(--success)_90%,transparent)] text-white font-semibold hover:bg-[var(--success)] transition-colors disabled:opacity-50"
            style={{ fontSize: 12 }}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '✓ 接受修改'}
          </button>
          <button
            onClick={handleReject}
            disabled={loading}
            className="px-3 py-1 rounded-[14px] bg-[var(--muted-foreground)]/10 text-[var(--muted-foreground)] font-semibold hover:bg-[var(--muted-foreground)]/20 transition-colors disabled:opacity-50"
            style={{ fontSize: 12 }}
          >
            ✕ 拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
