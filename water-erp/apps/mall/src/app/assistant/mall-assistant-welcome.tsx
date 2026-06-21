'use client';

import { motion } from 'framer-motion';
import { MallAssistantAvatar } from './mall-assistant-avatar';
import type { MallAssistantContext } from './types';

const QUICK_QUESTIONS = ['分析当前筛选结果', '找出需复核价格', '生成预算清单建议', '比较供应商报价'];

interface MallAssistantWelcomeProps {
  context: MallAssistantContext;
  onAsk: (question: string) => void;
}

const isActiveFilter = (value: string) => value.trim() && value !== '全部';

function buildContextHint(context: MallAssistantContext) {
  const filters = [
    isActiveFilter(context.currentFilters.category) ? context.currentFilters.category : null,
    isActiveFilter(context.currentFilters.region) ? context.currentFilters.region : null,
    isActiveFilter(context.currentFilters.status) ? context.currentFilters.status : null,
    isActiveFilter(context.currentFilters.source) ? context.currentFilters.source : null,
    context.currentFilters.search.trim() ? `关键词「${context.currentFilters.search.trim()}」` : null,
  ].filter(Boolean);

  const parts: string[] = [];
  if (filters.length > 0) parts.push(`当前筛选：${filters.join(' / ')}`);
  if (context.budget.length > 0) parts.push(`预算清单 ${context.budget.length} 项`);
  if (context.selectedItem) parts.push(`当前商品：${context.selectedItem.name}`);

  return parts.length > 0 ? `我会结合${parts.join('，')}来回答。` : null;
}

export function MallAssistantWelcome({ context, onAsk }: MallAssistantWelcomeProps) {
  const contextHint = buildContextHint(context);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      {/* 雷达扫描背景 */}
      <motion.div
        className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl"
        aria-hidden="true"
      >
        <motion.div
          className="absolute left-1/2 top-1/2 h-[1px] w-[300px]"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(91,155,213,.08), rgba(99,102,241,.06), transparent)',
            transformOrigin: 'left center',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        />
      </motion.div>

      {/* 中心头像区 */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <div className="relative">
          {/* 外层三环光晕 */}
          <motion.span
            className="absolute -inset-8 rounded-full pointer-events-none"
            animate={{ scale: [1, 1.12, 1], opacity: [0.12, 0.24, 0.12] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{
              background: 'radial-gradient(circle, rgba(91,155,213,.12) 0%, rgba(99,102,241,.08) 40%, transparent 70%)',
              filter: 'blur(16px)',
            }}
          />
          <motion.span
            className="absolute -inset-4 rounded-full pointer-events-none"
            animate={{ scale: [1, 1.08, 1], opacity: [0.15, 0.3, 0.15] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
            style={{
              background: 'radial-gradient(circle, rgba(91,155,213,.16) 0%, rgba(99,102,241,.10) 50%, transparent 75%)',
              filter: 'blur(8px)',
            }}
          />
          <MallAssistantAvatar size="lg" expression="normal" animated />
        </div>
      </motion.div>

      {/* 标题区 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="mt-6"
      >
        <h3 className="font-mono text-xl font-black tracking-wide text-[#1e3a5f]">
          你好，我是<span className="text-[#5b9bd5]">水叮当</span>
        </h3>
        <p className="mt-2.5 max-w-md text-sm leading-7 text-[#5a6d8a]">
          基于蜀水云采实时数据，为您提供价格研判、预算建议与供应商分析
        </p>
      </motion.div>

      {/* 上下文提示 */}
      {contextHint && (
        <motion.p
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, delay: 0.25 }}
          className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold"
          style={{
            background: 'rgba(238,246,255,.70)',
            border: '1px solid rgba(91,155,213,.15)',
            color: '#5b9bd5',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#5b9bd5]/50" />
          {contextHint}
        </motion.p>
      )}

      {/* 快速提问 - 磨砂玻璃芯片 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.35 }}
        className="mt-8 flex flex-wrap justify-center gap-2.5"
      >
        {QUICK_QUESTIONS.map((question, idx) => (
          <motion.button
            key={question}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.4 + idx * 0.06 }}
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onAsk(question)}
            className="rounded-full px-4 py-2.5 text-sm font-bold transition"
            style={{
              background: 'rgba(248,251,255,.75)',
              border: '1px solid rgba(205,217,234,.45)',
              color: '#5b9bd5',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0 1px 2px rgba(15,35,65,.02), 0 0 0 1px rgba(255,255,255,.20) inset',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(238,246,255,.85)';
              e.currentTarget.style.borderColor = 'rgba(91,155,213,.25)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(91,155,213,.08), 0 0 0 1px rgba(255,255,255,.25) inset';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(248,251,255,.75)';
              e.currentTarget.style.borderColor = 'rgba(205,217,234,.45)';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,35,65,.02), 0 0 0 1px rgba(255,255,255,.20) inset';
            }}
          >
            {question}
          </motion.button>
        ))}
      </motion.div>

      {/* 底部技术指标条 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="mt-8 flex items-center gap-4 font-mono text-[10px] font-bold tracking-widest text-[#bcc6d4]"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-1 rounded-full bg-emerald-400" />
          数据源 ONLINE
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-1 rounded-full bg-[#5b9bd5]" />
          LLM v2.4
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1 w-1 rounded-full bg-amber-400" />
          上下文已就绪
        </span>
      </motion.div>
    </div>
  );
}
