'use client';

import { ArrowLeft, Database } from 'lucide-react';
import type { KnowledgeBase } from '@/lib/types/tender-review';

/**
 * 知识库下钻上下文条（2026-11-19）：自知识库列表展开区进入 文件管理/规则管理 子页时，
 * 挂 hero 第二行（tender-write 类型切换位，与报告详情 ReportContextBar 同位同语法）。
 * 纯导航层——[← 返回] 库身份（库名+计数 chip）+ 文件/规则子页互切（TenderTypeSwitcher 同款 chip）；
 * 库本体设置（共享/删除）留在列表展开区，不上导航条。
 */
export default function KbContextBar({ kb, activeView, onView, onBack }: {
  kb: KnowledgeBase;
  activeView: 'files' | 'rules';
  onView: (view: 'files' | 'rules') => void;
  onBack: () => void;
}) {
  const chip = (active: boolean) =>
    [
      'rounded-[8px] px-3.5 py-2 text-xs font-semibold transition-all duration-200',
      active
        ? 'bg-[color-mix(in_oklch,var(--accent-soft)_55%,transparent)] text-[color:var(--accent)] shadow-[inset_1px_2px_3px_oklch(0.55_0.03_258_/_0.1),inset_-1px_-1px_2px_oklch(1_0_0_/_0.4)]'
        : 'text-[color:var(--muted-foreground)] hover:bg-[color-mix(in_oklch,var(--muted)_40%,transparent)]',
    ].join(' ');

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-1 text-xs text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]"
      >
        <ArrowLeft size={13} />返回
      </button>
      {/* 名字组：Database 图标 + 库名 + 计数 chips 紧贴（空间不足时名称收缩截断） */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Database className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
        <span
          title={kb.name}
          className="min-w-0 truncate text-[13px] font-medium text-[color:var(--foreground)]"
        >
          {kb.name}
        </span>
        <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold tabular-nums tracking-[0.04em] text-[var(--accent)]">
          {kb._count.files} 文件
        </span>
        <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] px-2 py-0.5 text-[10px] font-medium tabular-nums tracking-[0.04em] text-[color:var(--muted-foreground)]">
          {kb._count.rules} 规则
        </span>
      </div>
      {/* 操作组：子页互切 chip（tender-write TenderTypeSwitcher 同款配方，免退列表往返） */}
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => onView('files')} className={chip(activeView === 'files')}>
          文件管理
        </button>
        <button type="button" onClick={() => onView('rules')} className={chip(activeView === 'rules')}>
          规则管理
        </button>
      </div>
    </div>
  );
}
