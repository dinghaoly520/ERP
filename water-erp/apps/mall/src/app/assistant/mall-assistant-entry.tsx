'use client';

import { useMemo, useState } from 'react';
import { MallAssistantAvatar } from './mall-assistant-avatar';
import { MallAssistantDialog } from './mall-assistant-dialog';
import type { MallAssistantContext } from './types';

interface MallAssistantEntryProps {
  context: MallAssistantContext;
  initialQuestion?: string;
  onInitialQuestionConsumed?: () => void;
}

export function MallAssistantEntry({
  context,
  initialQuestion = '',
  onInitialQuestionConsumed = () => {},
}: MallAssistantEntryProps) {
  const [entryQuestion, setEntryQuestion] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialQuestion, setDialogInitialQuestion] = useState('');

  const effectiveInitialQuestion = initialQuestion || dialogInitialQuestion;

  const contextLabel = useMemo(() => {
    const activeFilters = [
      context.currentFilters.category !== '全部' ? context.currentFilters.category : null,
      context.currentFilters.region !== '全部' ? context.currentFilters.region : null,
      context.currentFilters.status !== '全部' ? context.currentFilters.status : null,
      context.currentFilters.source !== '全部' ? context.currentFilters.source : null,
      context.currentFilters.search.trim() ? `关键词「${context.currentFilters.search.trim()}」` : null,
    ].filter(Boolean);

    if (activeFilters.length > 0) return activeFilters.join(' / ');
    if (context.budget.length > 0) return `预算清单 ${context.budget.length} 项`;
    return '可结合当前目录、筛选和预算清单回答';
  }, [context]);

  const openDialog = (question?: string) => {
    const trimmed = question?.trim() ?? '';
    setDialogInitialQuestion(trimmed);
    setDialogOpen(true);
    if (trimmed) setEntryQuestion('');
  };

  return (
    <section className="mt-5 rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-white to-[#f4f8ff] p-4 shadow-[0_12px_34px_rgba(6,78,162,.07)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <button
          type="button"
          onClick={() => openDialog()}
          className="flex shrink-0 items-center gap-3 text-left"
        >
          <MallAssistantAvatar size="md" expression="normal" />
          <div>
            <h2 className="text-lg font-black text-[#123a6e]">水叮当 · 电子商城价格参谋</h2>
            <p className="mt-1 text-xs font-semibold text-[#6a7890]">{contextLabel}</p>
          </div>
        </button>

        <form
          className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            openDialog(entryQuestion);
          }}
        >
          <input
            value={entryQuestion}
            onChange={(event) => setEntryQuestion(event.target.value)}
            onFocus={() => {
              if (!entryQuestion.trim()) setDialogOpen(true);
            }}
            placeholder="问水叮当：分析当前筛选结果、找出需复核价格、生成预算清单建议"
            className="h-12 min-w-0 flex-1 rounded-xl border border-[#cdd9ea] bg-white px-4 text-sm outline-none transition placeholder:text-[#8a96aa] focus:border-[#064ea2] focus:shadow-[0_0_0_4px_rgba(6,78,162,.08)]"
          />
          <button
            type="submit"
            className="h-12 rounded-xl bg-[#064ea2] px-5 text-sm font-black text-white transition hover:bg-[#043d82]"
          >
            问水叮当
          </button>
        </form>
      </div>

      <MallAssistantDialog
        open={dialogOpen}
        context={context}
        initialQuestion={effectiveInitialQuestion}
        onInitialQuestionConsumed={() => {
          setDialogInitialQuestion('');
          onInitialQuestionConsumed();
        }}
        onClose={() => setDialogOpen(false)}
      />
    </section>
  );
}
