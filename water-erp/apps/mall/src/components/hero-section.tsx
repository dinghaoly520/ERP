'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MallAssistantAvatar } from '@/app/assistant/mall-assistant-avatar';
import { MallAssistantDialog } from '@/app/assistant/mall-assistant-dialog';
import type { MallAssistantContext } from '@/app/assistant/types';
import { useGlobalHotkey } from '@/app/interactions';

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Hero — 水叮当 · 集中采购目录 指挥中心

   左侧：水叮当头像 + 状态环 + 上下文标签
   右侧：双模搜索栏（物资搜索 ⇄ AI 提问），模式切换带视觉反馈
         水叮当头像同步反应：AI 模式 → thinking 表情 + 呼吸光晕
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/* ── 意图检测 ── */
const QUESTION_MARKERS = [
  '？','?','吗','呢','吧','啊',
  '什么','怎么','如何','为什么','为何','哪些','哪个',
  '能否','可以','是否','能不能','可不可以',
  '帮我','请帮','请问','请教','解释','说明',
  '介绍一下','告诉我','什么是','是什么意思',
  '分析','比较','对比','推荐','建议','预测',
  '生成','排查','找出',
];

function detectInputMode(input: string): 'search' | 'assistant' {
  const t = input.trim();
  if (!t) return 'search';
  if (t.includes('？') || t.includes('?')) return 'assistant';
  for (const m of QUESTION_MARKERS) { if (t.includes(m)) return 'assistant'; }
  if (t.length > 12) return 'assistant';
  return 'search';
}

/* ── 快捷提问 ── */
function deriveQuickQuestions(ctx: MallAssistantContext): string[] {
  const chips: string[] = [];
  const hasFilter =
    ctx.currentFilters.category !== '全部' || ctx.currentFilters.region !== '全部' ||
    ctx.currentFilters.status !== '全部' || ctx.currentFilters.source !== '全部' ||
    ctx.currentFilters.search.trim() !== '';
  if (hasFilter) chips.push('分析当前筛选结果');
  if (ctx.riskSummary.inquiry > 0 || ctx.riskSummary.review > 0) chips.push('找出需复核价格');
  if (ctx.budget.length > 0) chips.push('生成预算清单建议');
  chips.push('比较供应商报价');
  if (ctx.riskSummary.expiring > 0) chips.push('排查即将过期物资');
  for (const fb of ['分析当前筛选结果','找出需复核价格','生成预算清单建议']) {
    if (chips.length >= 4) break;
    if (!chips.includes(fb)) chips.push(fb);
  }
  return chips.slice(0, 4);
}

/* ── 上下文摘要 ── */
function contextSummary(ctx: MallAssistantContext): string[] {
  const lines: string[] = [];
  const f = ctx.currentFilters;
  if (f.category !== '全部') lines.push(`分类：${f.category}`);
  if (f.region !== '全部') lines.push(`区域：${f.region}`);
  if (f.status !== '全部') lines.push(`状态：${f.status}`);
  if (f.source !== '全部') lines.push(`来源：${f.source}`);
  if (f.search.trim()) lines.push(`搜索：${f.search.trim()}`);
  lines.push(`目录：${ctx.totalItems} 项`);
  const r = ctx.riskSummary;
  lines.push(`预警：${r.safe}安全 / ${r.inquiry}波动 / ${r.expiring}临期 / ${r.review}待复核`);
  if (ctx.budget.length > 0) {
    const total = ctx.budget.reduce((s, b) => s + b.referencePrice * b.qty, 0);
    lines.push(`预算：${ctx.budget.length} 项，合计 ¥${total.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`);
  }
  return lines;
}

/* ── AI 生成的轮播标语，值为 0 的跳过 ── */
function sloganPool(ctx: MallAssistantContext): string[] {
  const r = ctx.riskSummary;
  const categoryCount = new Set(ctx.visibleItems.map(i => i.category)).size;
  const hasFilter = ctx.currentFilters.category !== '全部' || ctx.currentFilters.region !== '全部' || ctx.currentFilters.status !== '全部' || ctx.currentFilters.source !== '全部';
  const warnings = r.inquiry + r.expiring + r.review;

  const pool: string[] = [];

  if (ctx.totalItems > 0) pool.push(`当前采购目录共${ctx.totalItems}项物资`);
  if (categoryCount > 0) pool.push(`已覆盖${categoryCount}个品类可供比选`);
  if (r.safe > 0) pool.push(`其中有${r.safe}项物资价格稳定`);
  if (ctx.budget.length > 0) pool.push(`已编制${ctx.budget.length}项预算清单`);
  if (r.inquiry > 0) pool.push(`发现${r.inquiry}项物资价格有异动`);
  if (r.expiring > 0) pool.push(`注意${r.expiring}项物资已临近效期`);
  if (r.review > 0) pool.push(`尚有${r.review}项物资待复核确认`);
  if (hasFilter) pool.push(`当前已筛选${ctx.totalItems}项物资`);
  if (warnings > 0) pool.push(`追踪${warnings}项物资预警信息`);

  return pool;
}

/* ══════════════════════════════════════════════════════════ */

interface HeroSectionProps {
  search: string;
  onSearchChange: (v: string) => void;
  searchHistory: string[];
  onAddSearchHistory: (t: string) => void;
  onClearSearchHistory: () => void;
  searchSuggestions: Array<{ id: string; code: string; name: string; referencePrice: number }>;
  filteredCount: number;
  assistantContext: MallAssistantContext;
  assistantInitialQuestion: string;
  onAssistantInitialQuestionConsumed: () => void;
  formatPrice: (p: number) => string;
}

const PLACEHOLDER_INTERVAL = 3800;

export function HeroSection({
  search, onSearchChange, searchHistory, onAddSearchHistory, onClearSearchHistory,
  searchSuggestions, filteredCount,
  assistantContext, assistantInitialQuestion, onAssistantInitialQuestionConsumed,
  formatPrice,
}: HeroSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownAnchorRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  useGlobalHotkey('/', () => { inputRef.current?.focus(); inputRef.current?.select(); });

  const [tipsOpen, setTipsOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogQuestion, setDialogQuestion] = useState('');
  const [mounted, setMounted] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [contextTooltipOpen, setContextTooltipOpen] = useState(false);
  const contextBtnRef = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const hasInput = search.trim().length > 0;
  const detectedMode = useMemo(() => detectInputMode(search), [search]);
  const effectiveMode = hasInput ? detectedMode : 'search';
  const effectiveInitialQuestion = assistantInitialQuestion || dialogQuestion;

  const hasWarnings =
    assistantContext.riskSummary.inquiry > 0 ||
    assistantContext.riskSummary.expiring > 0 ||
    assistantContext.riskSummary.review > 0;

  // 水叮当表情：AI 模式 + 有输入 → thinking；有预警 → serious；否则 normal
  const avatarExpression =
    (effectiveMode === 'assistant' && hasInput) ? 'thinking' :
    hasWarnings ? 'serious' : 'normal';

  // AI 颜色主题 —— 随模式切换
  const themeAccent = effectiveMode === 'assistant' && hasInput
    ? 'from-[#7c3aed] via-[#6366f1] to-[#3b82f6]'   // 紫→靛→蓝 AI 渐变
    : 'from-[#5b9bd5] to-[#0891b2]';                   // 品牌蓝→青 搜索渐变

  const ctxSummary = useMemo(() => contextSummary(assistantContext), [assistantContext]);
  const quickQuestions = useMemo(() => deriveQuickQuestions(assistantContext), [assistantContext]);
  const slogans = useMemo(() => sloganPool(assistantContext), [assistantContext]);

  // 12字标语轮播
  const [sloganIdx, setSloganIdx] = useState(0);
  useEffect(() => {
    if (slogans.length <= 1) return;
    const t = setInterval(() => setSloganIdx(i => (i + 1) % slogans.length), 3000);
    return () => clearInterval(t);
  }, [slogans.length]);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { if (assistantInitialQuestion) setDialogOpen(true); }, [assistantInitialQuestion]);
  // 更新下拉面板定位（Portal 到 body 时需要）
  useEffect(() => {
    if (tipsOpen && dropdownAnchorRef.current) {
      const rect = dropdownAnchorRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    }
  }, [tipsOpen]);

  // placeholder 轮播
  useEffect(() => {
    if (dialogOpen) return;
    const items = [
      '搜索物资编码、名称、规格或供应商…',
      '问水叮当：这批物资的价格合理吗？',
      '试试：分析当前筛选结果，找出需复核价格',
    ];
    const t = setInterval(() => setPlaceholderIdx(p => (p + 1) % items.length), PLACEHOLDER_INTERVAL);
    return () => clearInterval(t);
  }, [dialogOpen]);

  // 点击外部关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setTipsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // ── 执行 ──
  const executeAction = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    onAddSearchHistory(t);
    setTipsOpen(false);
    if (detectInputMode(t) === 'assistant') {
      setDialogQuestion(t);
      setDialogOpen(true);
    } else {
      onSearchChange(t);
    }
  }, [onAddSearchHistory, onSearchChange]);

  const openAssistant = useCallback(() => {
    const t = search.trim();
    if (t) { setDialogQuestion(t); onSearchChange(''); }
    setDialogOpen(true);
  }, [search, onSearchChange]);

  // 键盘
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(p => Math.min(p + 1, searchSuggestions.length - 1)); setTipsOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(p => Math.max(p - 1, -1)); setTipsOpen(true); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && tipsOpen && searchSuggestions[selectedIdx]) {
        executeAction(searchSuggestions[selectedIdx].name); setSelectedIdx(-1);
      } else { executeAction(search); }
    }
    else if (e.key === 'Escape') { setTipsOpen(false); setSelectedIdx(-1); if (!hasInput) inputRef.current?.blur(); }
  };

  const PLACEHOLDERS = [
    '搜索物资编码、名称、规格或供应商…',
    '问水叮当：这批物资的价格合理吗？',
    '试试：分析当前筛选结果，找出需复核价格',
  ];

  return (
    <>
      <section
        className="rounded-[28px] border shadow-[0_1px_3px_rgba(0,0,0,.03),0_8px_40px_rgba(6,78,162,.05)] relative"
        style={{
          background: effectiveMode === 'assistant' && hasInput
            ? 'linear-gradient(135deg, rgba(245,243,255,.92) 0%, rgba(238,242,255,.94) 30%, rgba(240,248,255,.94) 60%, rgba(245,243,255,.92) 100%)'
            : 'linear-gradient(135deg, rgba(248,250,255,.9) 0%, rgba(255,255,255,.94) 40%, rgba(245,249,254,.94) 100%)',
          borderColor: effectiveMode === 'assistant' && hasInput ? 'rgba(139,92,246,.25)' : 'rgba(6,78,162,.08)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          transition: 'background 0.8s ease, border-color 0.8s ease',
        }}
      >
        {/* ── 背景纹理 ── 包装层：裁剪圆角，防止光晕溢出 */}
        <div className="absolute inset-0 overflow-hidden rounded-[28px] pointer-events-none">
        {/* 网格 */}
        <div className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'linear-gradient(rgba(6,78,162,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(6,78,162,.12) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        {/* 光晕 - 淡彩柔和 */}
        <motion.div
          className="absolute h-[420px] w-[420px] rounded-full blur-[140px] pointer-events-none"
          animate={{
            x: effectiveMode === 'assistant' && hasInput ? ['-8%','6%','-8%'] : ['-4%','3%','-4%'],
            y: effectiveMode === 'assistant' && hasInput ? ['12%','-6%','12%'] : ['8%','-4%','8%'],
            scale: effectiveMode === 'assistant' && hasInput ? [1,1.1,1] : [1,1.05,1],
          }}
          transition={{ duration: effectiveMode === 'assistant' && hasInput ? 8 : 14, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            right: '-8%',
            top: '-16%',
            background: effectiveMode === 'assistant' && hasInput
              ? 'radial-gradient(circle, rgba(168,139,250,.18), rgba(129,140,248,.1), transparent 60%)'
              : 'radial-gradient(circle, rgba(147,197,253,.14), rgba(96,165,250,.07), transparent 60%)',
          }}
        />
        <motion.div
          className="absolute h-[320px] w-[320px] rounded-full blur-[120px] pointer-events-none"
          animate={{ x: ['4%','-3%','4%'], y: ['-8%','5%','-8%'], scale: [1,1.06,1] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            left: '6%',
            bottom: '-24%',
            background: 'radial-gradient(circle, rgba(52,211,153,.1), rgba(6,182,212,.06), transparent 60%)',
          }}
        />

        {/* ── 粒子 ── */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                background: i < 3 ? 'rgba(6,78,162,.18)' : 'rgba(139,92,246,.16)',
                left: `${15 + (i * 14)}%`,
                top: `${20 + (i * 12)}%`,
              }}
              animate={{
                y: [0, -18 - i * 7, 0],
                opacity: [0.2, 0.6, 0.2],
              }}
              transition={{ duration: 3.5 + i * 1.2, repeat: Infinity, delay: i * 0.7, ease: 'easeInOut' }}
            />
          ))}
        </div>
        </div>
        {/* ── 主内容 ── */}
        <div className="relative px-8 py-6 lg:px-10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">

            {/* ═══════ 左侧：水叮当 + 标题 ═══════ */}
            <div className="flex items-start gap-4 shrink-0 lg:w-[20%]">
              {/* 水叮当头像 —— 带状态环，点击打开对话框 */}
              <button
                type="button"
                className="relative shrink-0 cursor-pointer"
                onClick={() => setDialogOpen(true)}
                aria-label="打开水叮当对话框"
              >
                {/* 外圈状态环 */}
                <motion.div
                  className={`absolute -inset-[6px] rounded-full border-2 ${hasWarnings ? 'border-orange-400/50' : 'border-[#5b9bd5]/10'}`}
                  animate={
                    hasWarnings
                      ? { scale: [1, 1.06, 1], opacity: [0.5, 0.9, 0.5] }
                      : { scale: [1, 1.03, 1], opacity: [0.3, 0.6, 0.3] }
                  }
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
                {/* 内圈脉冲光环 */}
                <motion.div
                  className="absolute -inset-[3px] rounded-full border border-transparent"
                  animate={effectiveMode === 'assistant' && hasInput
                    ? {
                        borderColor: ['rgba(99,102,241,.4)', 'rgba(99,102,241,.2)', 'rgba(99,102,241,.4)'],
                        scale: [1, 1.15, 1],
                      }
                    : { scale: 1 }
                  }
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
                <MallAssistantAvatar
                  size="lg"
                  expression={avatarExpression}
                  animated
                  className="relative z-10"
                />
                {/* 状态圆点指示器 */}
                <AnimatePresence mode="wait">
                  {hasWarnings ? (
                    <motion.span
                      key="warn"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="absolute -bottom-0.5 -right-0.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[9px] font-black text-white ring-2 ring-[#f0f4fb]"
                    >
                      !
                    </motion.span>
                  ) : (
                    <motion.span
                      key="ok"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="absolute -bottom-0.5 -right-0.5 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-black text-white ring-2 ring-[#f0f4fb]"
                    >
                      ✓
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              {/* 标题 + 描述 */}
              <div className="pt-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1
                    className={`text-3xl font-black tracking-wide lg:text-4xl bg-clip-text text-transparent ${
                      effectiveMode === 'assistant' && hasInput
                        ? 'animate-gradient-shift-ai'
                        : 'animate-gradient-shift'
                    }`}
                    style={{
                      backgroundImage: effectiveMode === 'assistant' && hasInput
                        ? 'linear-gradient(135deg, #7c3aed 0%, #6366f1 30%, #4f46e5 50%, #6366f1 70%, #7c3aed 100%)'
                        : 'linear-gradient(90deg, #1e293b 0%, #2c5282 40%, #5b9bd5 60%, #1e293b 100%)',
                      backgroundSize: effectiveMode === 'assistant' && hasInput ? '200% 200%' : '200% 100%',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    集中采购目录
                  </h1>
                  {/* AI 模式标签 */}
                  <AnimatePresence>
                    {effectiveMode === 'assistant' && hasInput && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0.8, x: -8 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-100 to-indigo-100 border border-violet-300/60 px-3 py-1 text-xs font-bold text-violet-700"
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
                        水叮当参谋模式
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>


                {/* 上下文指示器 */}
                <div className="relative mt-2.5 inline-block">
                  <button
                    ref={contextBtnRef}
                    type="button"
                    className="flex items-center gap-1.5 rounded-full bg-[#eef3fb]/80 hover:bg-[#e2ebf8] transition px-2.5 py-1 text-xs text-[#5a6d8a] border border-[#5b9bd5]/10"
                    onMouseEnter={() => {
                      const rect = contextBtnRef.current?.getBoundingClientRect();
                      if (rect) setTooltipPos({ top: rect.bottom + 8, left: rect.left });
                      setContextTooltipOpen(true);
                    }}
                    onMouseLeave={() => setContextTooltipOpen(false)}
                    onClick={() => {
                      const rect = contextBtnRef.current?.getBoundingClientRect();
                      if (rect) setTooltipPos({ top: rect.bottom + 8, left: rect.left });
                      setContextTooltipOpen(v => !v);
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                    <span className="inline-block min-w-[18em] text-left">水叮当：{slogans[sloganIdx] || '全量目录'}</span>
                  </button>
                </div>

                {/* 上下文浮层 Portal —— 避开 section overflow-hidden */}
                {mounted && createPortal(
                  <AnimatePresence>
                    {contextTooltipOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.96 }}
                        transition={{ duration: 0.18 }}
                        style={{ position: 'fixed', top: tooltipPos.top, left: tooltipPos.left, zIndex: 100 }}
                        className="w-72 rounded-2xl border border-[#e1e9f4] bg-white/98 backdrop-blur-xl px-4 py-3.5 shadow-[0_16px_48px_rgba(15,35,65,.12)]"
                      >
                        <div className="flex items-center gap-2 mb-2.5">
                          <MallAssistantAvatar size="sm" expression="normal" className="!h-5 !w-5 !p-0" />
                          <span className="text-[11px] font-black text-[#2c5282]">水叮当上下文</span>
                        </div>
                        <ul className="space-y-1.5">
                          {ctxSummary.map((line, i) => (
                            <li key={i} className="flex items-baseline gap-1.5 text-[11px] text-[#5a6d8a] leading-relaxed">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#5b9bd5]/25" />
                              {line}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-2.5 pt-2.5 border-t border-[#eef2f8] text-[10px] text-[#8a96aa]">
                          搜索栏中直接提问即可获得 AI 分析
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>,
                  document.body,
                )}
              </div>
            </div>

            {/* ═══════ 右侧：搜索栏 ═══════ */}
            <div ref={containerRef} className="relative flex-1 min-w-0 lg:pt-2.5 lg:w-[80%]">
              {/* 搜索框 */}
              <div ref={dropdownAnchorRef} className="relative">
                {/* 流光边框层 */}
                <motion.div
                  className="absolute -inset-[2px] rounded-2xl pointer-events-none"
                  style={{ background: 'transparent', zIndex: 0 }}
                  animate={{
                    background: effectiveMode === 'assistant' && hasInput
                      ? [
                          'conic-gradient(from 0deg, transparent, rgba(139,92,246,.5), rgba(99,102,241,.4), transparent)',
                          'conic-gradient(from 120deg, transparent, rgba(139,92,246,.5), rgba(99,102,241,.4), transparent)',
                          'conic-gradient(from 240deg, transparent, rgba(139,92,246,.5), rgba(99,102,241,.4), transparent)',
                          'conic-gradient(from 360deg, transparent, rgba(139,92,246,.5), rgba(99,102,241,.4), transparent)',
                        ]
                      : [
                          'conic-gradient(from 0deg, transparent, rgba(91,155,213,.3), rgba(6,182,212,.2), transparent)',
                          'conic-gradient(from 120deg, transparent, rgba(91,155,213,.3), rgba(6,182,212,.2), transparent)',
                          'conic-gradient(from 240deg, transparent, rgba(91,155,213,.3), rgba(6,182,212,.2), transparent)',
                          'conic-gradient(from 360deg, transparent, rgba(91,155,213,.3), rgba(6,182,212,.2), transparent)',
                        ],
                  }}
                  transition={{ duration: tipsOpen ? 4 : 6, repeat: Infinity, ease: 'linear' }}
                />

                <motion.div
                  className={`relative z-10 flex items-center rounded-2xl border transition-all duration-500 ${
                    tipsOpen
                      ? 'bg-white shadow-[0_8px_32px_rgba(0,0,0,.08),0_0_0_1px_rgba(91,155,213,.12),0_0_20px_rgba(91,155,213,.08)]'
                      : 'bg-white/95 shadow-[0_2px_12px_rgba(0,0,0,.04),0_0_0_1px_rgba(0,0,0,.03)] hover:shadow-[0_4px_18px_rgba(0,0,0,.06),0_0_0_1px_rgba(91,155,213,.06),0_0_12px_rgba(91,155,213,.04)]'
                  }`}
                  animate={{
                    borderColor: effectiveMode === 'assistant' && hasInput
                      ? ['rgba(139,92,246,.35)', 'rgba(99,102,241,.35)', 'rgba(139,92,246,.35)']
                      : tipsOpen ? 'rgba(91,155,213,.35)' : 'rgba(0,0,0,.06)',
                    boxShadow: effectiveMode === 'assistant' && hasInput
                      ? [
                          '0 8px 32px rgba(0,0,0,.08), 0 0 0 1px rgba(139,92,246,.15), 0 0 24px rgba(139,92,246,.1)',
                          '0 8px 36px rgba(0,0,0,.1), 0 0 0 1px rgba(99,102,241,.2), 0 0 32px rgba(99,102,241,.14)',
                          '0 8px 32px rgba(0,0,0,.08), 0 0 0 1px rgba(139,92,246,.15), 0 0 24px rgba(139,92,246,.1)',
                        ]
                      : tipsOpen
                        ? '0 8px 32px rgba(0,0,0,.06), 0 0 0 1px rgba(91,155,213,.12), 0 0 20px rgba(91,155,213,.08)'
                        : '0 2px 12px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.03)',
                  }}
                  transition={{ duration: tipsOpen ? 3 : 6, repeat: effectiveMode === 'assistant' && hasInput || tipsOpen ? Infinity : 0, ease: 'easeInOut' }}
                >
                {/* 搜索放大镜图标 */}
                <div className="pl-4 shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                    className="text-[#8a96aa]">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                  </svg>
                </div>

                {/* 输入框 */}
                <input
                  ref={inputRef}
                  value={search}
                  onChange={e => { onSearchChange(e.target.value); setTipsOpen(true); setSelectedIdx(-1); }}
                  onFocus={() => setTipsOpen(true)}
                  onBlur={() => setTimeout(() => { if (!containerRef.current?.contains(document.activeElement)) setTipsOpen(false); }, 200)}
                  onKeyDown={handleKeyDown}
                  placeholder={PLACEHOLDERS[placeholderIdx]}
                  className="h-14 flex-1 min-w-0 bg-transparent py-0 px-3 text-sm text-[#334155] outline-none placeholder:text-[#6a7890] [&:focus-visible]:shadow-none"
                  aria-label="搜索物资或向水叮当提问（/ 键聚焦）"
                />

                {/* 清除按钮 */}
                <AnimatePresence>
                  {hasInput && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      type="button"
                      onClick={() => { onSearchChange(''); inputRef.current?.focus(); }}
                      className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#bcc6d4] transition hover:bg-[#f0f3f8] hover:text-[#5a6d8a]"
                      aria-label="清空输入"
                    >
                      <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l10 10M11 1L1 11"/></svg>
                    </motion.button>
                  )}
                </AnimatePresence>

                {/* 执行按钮 */}
                <motion.button
                  type="button"
                  onClick={() => executeAction(search)}
                  className="h-14 shrink-0 rounded-r-2xl px-6 text-sm font-black text-white transition active:scale-95"
                  animate={{
                    background: effectiveMode === 'assistant' && hasInput
                      ? 'linear-gradient(135deg, #7c3aed, #6366f1, #4f46e5)'
                      : hasInput
                        ? 'linear-gradient(135deg, #5b9bd5, #4a89c4)'
                        : 'linear-gradient(135deg, #94a3b8, #94a3b8)',
                  }}
                  whileHover={{ filter: 'brightness(1.1)' }}
                  whileTap={{ scale: 0.95 }}
                >
                  {effectiveMode === 'assistant' && hasInput ? (
                    <span>提问水叮当</span>
                  ) : hasInput ? (
                    <span>搜索</span>
                  ) : '搜索'}
                </motion.button>
              </motion.div>
              </div>

              {/* 搜索结果反馈 */}
              <AnimatePresence mode="wait">
                {hasInput && filteredCount > 0 && (
                  <motion.p
                    key="found"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-2.5 flex items-center gap-2 text-xs text-[#5a6d8a]"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                    </svg>
                    找到 <span className="font-black text-[#5b9bd5]">{filteredCount}</span> 项匹配物资
                  </motion.p>
                )}
                {hasInput && filteredCount === 0 && (
                  <motion.p
                    key="notfound"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-2.5 text-xs text-[#e74c3c] flex items-center gap-2"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="11" cy="11" r="8"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    未找到匹配项 —
                    <button type="button" onClick={openAssistant}
                      className="font-bold text-[#5b9bd5] underline decoration-dotted underline-offset-2 hover:text-[#7c3aed] hover:decoration-solid transition">
                      让水叮当分析
                    </button>
                  </motion.p>
                )}
              </AnimatePresence>

              {/* ═══════ 下拉面板（Portal 到 body，不受堆叠上下文限制）═══════ */}
              {mounted && createPortal(
                <AnimatePresence>
                  {tipsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.18 }}
                      style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
                      className="overflow-hidden rounded-2xl border border-[#e1e9f4] bg-white shadow-[0_20px_56px_rgba(15,35,65,.16)]"
                    >
                      {hasInput ? (
                        /* ── 有输入：搜索建议 + AI入口 ── */
                        <>
                          {searchSuggestions.length > 0 ? (
                            <ul className="py-1.5" role="listbox">
                              {searchSuggestions.map((item, idx) => (
                                <li key={item.id} role="option" aria-selected={idx === selectedIdx}>
                                  <button
                                    type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => executeAction(item.name)}
                                    onMouseEnter={() => setSelectedIdx(idx)}
                                    className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition ${
                                      idx === selectedIdx ? 'bg-[#f3f8ff] text-[#5b9bd5]' : 'text-[#24364f] hover:bg-[#f8fbff]'
                                    }`}
                                  >
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#eef3fb] text-[10px] font-bold text-[#5b9bd5]">
                                      {item.code.slice(0, 4)}
                                    </span>
                                    <span className="flex-1 text-left truncate font-semibold">{item.name}</span>
                                    <span className="shrink-0 text-xs tabular-nums text-[#8a96aa]">{formatPrice(item.referencePrice)}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : filteredCount === 0 ? (
                            <div className="px-5 py-7 text-center">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#bcc6d4" strokeWidth="1.2" className="mx-auto mb-3">
                                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                              </svg>
                              <p className="text-sm text-[#8a96aa]">未找到匹配物资</p>
                              <button
                                type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => { setTipsOpen(false); setDialogQuestion(search); setDialogOpen(true); }}
                                className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 px-4 py-2.5 text-xs font-bold text-violet-700 hover:from-violet-100 hover:to-indigo-100 active:scale-95 transition-all"
                              >
                                <MallAssistantAvatar size="sm" expression="thinking" className="!h-5 !w-5 !p-0" />
                                让水叮当来分析
                              </button>
                            </div>
                          ) : null}

                          {/* AI 入口脚注 */}
                          {effectiveMode !== 'assistant' && searchSuggestions.length > 0 && (
                            <div className="border-t border-[#eef2f8] px-4 py-2.5 flex items-center gap-2 bg-[#fafbff]">
                              <span className="text-[10px] text-[#bcc6d4]">不是你要找的？</span>
                              <button
                                type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => { setTipsOpen(false); setDialogQuestion(search); setDialogOpen(true); }}
                                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-50 to-indigo-50 px-2.5 py-1 text-[10px] font-bold text-violet-600 hover:from-violet-100 hover:to-indigo-100 transition"
                              >
                                <MallAssistantAvatar size="sm" expression="normal" className="!h-4 !w-4 !p-0" />
                                问水叮当
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        /* ── 无输入：搜索历史 + AI 快捷提问 ── */
                        <>
                          {searchHistory.length > 0 && (
                            <>
                              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#eef2f8]">
                                <span className="text-[11px] font-bold text-[#8a96aa] flex items-center gap-1.5">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                  最近搜索
                                </span>
                                <button type="button" onMouseDown={e => e.preventDefault()} onClick={onClearSearchHistory}
                                  className="text-[10px] text-[#bcc6d4] hover:text-[#e74c3c] transition font-semibold">清除全部</button>
                              </div>
                              <ul className="py-1.5">
                                {searchHistory.map(term => (
                                  <li key={term}>
                                    <button type="button" onMouseDown={e => e.preventDefault()}
                                      onClick={() => executeAction(term)}
                                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-[#5a6d8a] hover:bg-[#f8fbff] transition">
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#bcc6d4] shrink-0">
                                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                                      </svg>
                                      <span className="truncate font-medium">{term}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}

                          {/* 水叮当快捷提问 */}
                          <div className="px-4 py-3.5">
                            <div className="flex items-center gap-2 mb-3">
                              <MallAssistantAvatar size="sm" expression="normal" className="!h-5 !w-5 !p-0.5" />
                              <span className="text-[11px] font-black text-[#5a6d8a] uppercase tracking-wider">
                                水叮当 · 快捷提问
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {quickQuestions.map(q => (
                                <button key={q} type="button" onMouseDown={e => e.preventDefault()}
                                  onClick={() => { setTipsOpen(false); setDialogQuestion(q); setDialogOpen(true); }}
                                  className="rounded-full border border-[#e1e9f4] bg-white px-3.5 py-2 text-xs font-bold text-[#5a6d8a] transition hover:border-[#6366f1] hover:text-[#4f46e5] hover:bg-violet-50/30 active:scale-95"
                                >{q}</button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>,
                document.body,
              )}

              {/* 快捷键提示 */}
              {!hasInput && (
                <p className="mt-2.5 text-[10px] text-[#8a96aa] flex items-center gap-1.5">
                  <kbd className="inline-flex items-center justify-center h-4 px-1.5 rounded bg-[#eef3fb] text-[9px] font-semibold text-[#5a6d8a] border border-[#d5e0ef]">/</kbd>
                  聚焦搜索 · 输入关键词搜索物资 · 输入问题让水叮当分析
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 水叮当对话框 Portal */}
      {mounted && createPortal(
        <MallAssistantDialog
          open={dialogOpen}
          context={assistantContext}
          initialQuestion={effectiveInitialQuestion}
          onInitialQuestionConsumed={() => { setDialogQuestion(''); onAssistantInitialQuestionConsumed(); }}
          onClose={() => setDialogOpen(false)}
        />,
        document.body,
      )}
    </>
  );
}
