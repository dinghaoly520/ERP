'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MallAssistantAvatar } from './mall-assistant-avatar';
import { MallAssistantDialog } from './mall-assistant-dialog';
import type { MallAssistantContext } from './types';

interface MallAssistantEntryProps {
  context: MallAssistantContext;
  initialQuestion?: string;
  onInitialQuestionConsumed?: () => void;
}

const PLACEHOLDERS = [
  '问水叮当：分析当前筛选结果、找出需复核价格、生成预算清单建议',
  '试试：这批物资的价格竞争性如何？',
  '试试：帮我比较供应商报价，推荐性价比最高的',
] as const;

const PLACEHOLDER_INTERVAL = 4200;

function buildContextDetails(context: MallAssistantContext) {
  const lines: string[] = [];
  const { riskSummary, budget, currentFilters, totalItems } = context;

  if (currentFilters.category !== '全部') lines.push(`分类：${currentFilters.category}`);
  if (currentFilters.region !== '全部') lines.push(`区域：${currentFilters.region}`);
  if (currentFilters.status !== '全部') lines.push(`状态：${currentFilters.status}`);
  if (currentFilters.source !== '全部') lines.push(`来源：${currentFilters.source}`);
  if (currentFilters.search.trim()) lines.push(`搜索：${currentFilters.search.trim()}`);

  lines.push(`目录物资：${totalItems} 项`);
  lines.push(`安全 / 波动 / 临期 / 待复核：${riskSummary.safe} / ${riskSummary.inquiry} / ${riskSummary.expiring} / ${riskSummary.review}`);

  if (budget.length > 0) {
    const total = budget.reduce((s, r) => s + r.referencePrice * r.qty, 0);
    lines.push(`预算清单：${budget.length} 项，参考合计 ¥${total.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`);
  }

  return lines;
}

function deriveQuickQuestions(context: MallAssistantContext): string[] {
  const chips: string[] = [];
  const hasActiveFilter =
    context.currentFilters.category !== '全部' ||
    context.currentFilters.region !== '全部' ||
    context.currentFilters.status !== '全部' ||
    context.currentFilters.source !== '全部' ||
    context.currentFilters.search.trim() !== '';

  if (hasActiveFilter) chips.push('分析当前筛选结果');
  if (context.riskSummary.inquiry > 0 || context.riskSummary.review > 0) chips.push('找出需复核价格');
  if (context.budget.length > 0) chips.push('生成预算清单建议');
  chips.push('比较供应商报价');
  if (context.riskSummary.expiring > 0) chips.push('排查即将过期物资');

  // Ensure at least 3 distinct chips
  const fallbacks = ['分析当前筛选结果', '找出需复核价格', '生成预算清单建议'];
  for (const fb of fallbacks) {
    if (chips.length >= 4) break;
    if (!chips.includes(fb)) chips.push(fb);
  }

  return chips.slice(0, 4);
}

export function MallAssistantEntry({
  context,
  initialQuestion = '',
  onInitialQuestionConsumed = () => {},
}: MallAssistantEntryProps) {
  const [entryQuestion, setEntryQuestion] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialQuestion, setDialogInitialQuestion] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderKey, setPlaceholderKey] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const effectiveInitialQuestion = initialQuestion || dialogInitialQuestion;

  // ----- derived states -----

  const hasWarnings =
    context.riskSummary.inquiry > 0 ||
    context.riskSummary.expiring > 0 ||
    context.riskSummary.review > 0;

  const avatarExpression = hasWarnings ? 'serious' : 'normal';

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

  const contextDetails = useMemo(() => buildContextDetails(context), [context]);

  const labelWarning = useMemo(() => {
    const alerts: string[] = [];
    if (context.riskSummary.inquiry > 0) alerts.push(`${context.riskSummary.inquiry} 项价格波动`);
    if (context.riskSummary.expiring > 0) alerts.push(`${context.riskSummary.expiring} 项即将过期`);
    if (context.riskSummary.review > 0) alerts.push(`${context.riskSummary.review} 项待复核`);
    return alerts.length > 0 ? alerts.join(' / ') : null;
  }, [context.riskSummary]);

  const quickQuestions = useMemo(() => deriveQuickQuestions(context), [context]);

  // ----- rotating placeholder -----

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (dialogOpen) return;
    const timer = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % PLACEHOLDERS.length);
      setPlaceholderKey(k => k + 1);
    }, PLACEHOLDER_INTERVAL);
    return () => clearInterval(timer);
  }, [dialogOpen]);

  const currentPlaceholder = PLACEHOLDERS[placeholderIndex];

  // ----- actions -----

  const openDialog = useCallback((question?: string) => {
    const trimmed = question?.trim() ?? '';
    setDialogInitialQuestion(trimmed);
    setDialogOpen(true);
    if (trimmed) setEntryQuestion('');
  }, []);

  const fillInput = useCallback((question: string) => {
    setEntryQuestion(question);
  }, []);

  const clearInput = useCallback(() => {
    setEntryQuestion('');
  }, []);

  const hasInput = entryQuestion.trim().length > 0;

  return (
    <section className="group/card mt-5 animate-border-glow rounded-2xl border border-[#bfd4f4] bg-gradient-to-br from-white to-[#f4f8ff] p-4 shadow-[0_12px_34px_rgba(6,78,162,.07)]">
      <div className="flex flex-col gap-4">
        {/* ---- 第一行：头像 + 标题 + 上下文 ---- */}
        <button
          type="button"
          onClick={() => openDialog()}
          className="flex shrink-0 items-center gap-3 text-left"
        >
          <MallAssistantAvatar
            size="md"
            expression={avatarExpression}
            animated
          />
          <div>
            <h2 className="text-lg font-black text-[#123a6e]">水叮当 · 电子商城价格参谋</h2>
            <div
              className="group/tip relative mt-1 inline-block"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            >
              <p className={`text-xs font-semibold transition-colors ${labelWarning ? 'text-[#e67e22]' : 'text-[#6a7890]'}`}>
                {contextLabel}
                {labelWarning && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-orange-50 px-1.5 py-0.5 text-[11px] font-bold text-orange-600">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500" />
                    {labelWarning}
                  </span>
                )}
              </p>

              {/* Tooltip */}
              {showTooltip && (
                <div className="absolute bottom-full left-0 mb-2 z-50 min-w-[260px] rounded-xl border border-[#cdd9ea] bg-white px-4 py-3 shadow-[0_16px_44px_rgba(15,35,65,.14)]">
                  <div className="mb-2 text-xs font-black text-[#123a6e]">当前上下文</div>
                  <ul className="space-y-1">
                    {contextDetails.map((line, i) => (
                      <li key={i} className="text-xs text-[#5a6d8a] leading-relaxed">{line}</li>
                    ))}
                  </ul>
                  <div className="absolute left-4 top-full -mt-px h-0 w-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-white" />
                </div>
              )}
            </div>
          </div>
        </button>

        {/* ---- 快捷提问芯片 ---- */}
        <div className="flex flex-wrap gap-2">
          {quickQuestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => fillInput(q)}
              className="rounded-full border border-[#cdd9ea] bg-white/70 px-3 py-1.5 text-xs font-bold text-[#5a6d8a] transition hover:border-[#064ea2] hover:bg-[#f3f8ff] hover:text-[#064ea2] active:scale-95"
            >
              {q}
            </button>
          ))}
        </div>

        {/* ---- 第二行：输入栏 ---- */}
        <form
          className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (hasInput) openDialog(entryQuestion);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <input
              value={entryQuestion}
              onChange={(event) => setEntryQuestion(event.target.value)}
              placeholder={currentPlaceholder}
              key={placeholderKey}
              className="h-12 w-full rounded-xl border border-[#cdd9ea] bg-white py-0 pl-4 pr-10 text-sm outline-none transition placeholder:text-[#8a96aa] focus:border-[#064ea2] focus:shadow-[0_0_0_4px_rgba(6,78,162,.08)] animate-placeholder-in"
            />
            {hasInput && (
              <button
                type="button"
                onClick={clearInput}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[#bcc6d4] transition hover:bg-[#f0f3f8] hover:text-[#5a6d8a]"
                aria-label="清空输入"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 1l10 10M11 1L1 11" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!hasInput}
            className={`h-12 rounded-xl px-5 text-sm font-black text-white transition active:scale-95 ${
              hasInput
                ? 'bg-[#064ea2] animate-dingdang-glow hover:bg-[#043d82]'
                : 'cursor-not-allowed bg-[#b3c7de] opacity-50'
            }`}
          >
            发送
          </button>
        </form>
      </div>

      {mounted && createPortal(
        <MallAssistantDialog
          open={dialogOpen}
          context={context}
          initialQuestion={effectiveInitialQuestion}
          onInitialQuestionConsumed={() => {
            setDialogInitialQuestion('');
            onInitialQuestionConsumed();
          }}
          onClose={() => setDialogOpen(false)}
        />,
        document.body,
      )}
    </section>
  );
}
