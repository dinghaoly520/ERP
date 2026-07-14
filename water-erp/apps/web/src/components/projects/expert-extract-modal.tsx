'use client';

import { Suspense, useEffect, useState } from 'react';
import { Users, X } from 'lucide-react';
import { ExpertExtractPage } from '@/app/(main)/expert/extract/page';
import { RulesPopover } from '@/components/rules-popover';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function ExpertExtractModal({ isOpen, onClose }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // 关闭时重置，重新打开时延迟显示界面以等待初始数据加载
  useEffect(() => {
    if (!isOpen) {
      setReady(false);
      return;
    }
    const timer = setTimeout(() => setReady(true), 1600);
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      {/* 遮罩 */}
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />

      {/* 窗口容器 */}
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* 标题栏 */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background:
              'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)',
                boxShadow:
                  'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)',
              }}
            >
              <Users size={17} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">
                专家抽取
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                从专家库中按专业分类与回避规则智能抽取评标专家，组建评审委员会
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <RulesPopover label="抽取规则" accentColor="var(--accent)">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">专家抽取规则</h3>
              <ol className="space-y-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">1.</span>合规过滤：仅「可用」状态专家，工作单位与供应商无关联，未被重复分配至同一项目，自动回避利益相关方</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">2.</span>三种抽取模式：专业匹配（AI分析专业构成+加权随机）、随机抽取（合规池公平随机）、综合择优（多维履职数据排名择优）</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">3.</span>多维评估：AI 综合专家履职评价等级(A/B/C/D)、出勤/质量/廉洁三维度评分、评分偏离度、历史经验与当前负荷</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">4.</span>手动调整：抽取后可替换/移除/添加专家，灵活组建最终专家组</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">5.</span>通知送达：确认后支持 OA站内信 / 短信 / 电话 多渠道通知被选专家</li>
              </ol>
            </RulesPopover>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 正文 */}
        <div
          className="flex-1 min-h-0 overflow-y-auto"
          style={{
            background: 'oklch(0.975 0.012 258 / 0.32)',
            boxShadow:
              'inset 2px 3px 8px oklch(0.5 0.04 258 / 0.1), inset -1px -1px 3px oklch(1 0 0 / 0.55)',
          }}
        >
          {ready ? (
            <Suspense fallback={
              <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">
                加载抽取配置...
              </div>
            }>
              <ExpertExtractPage hideHeader />
            </Suspense>
          ) : (
            <div className="flex-1 flex items-center justify-center min-h-[300px]">
              <div className="flex flex-col items-center gap-4 w-full max-w-[380px]">
                <Users size={36} className="text-[var(--muted-foreground)]" />
                <div className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">
                  正在加载专家抽取配置
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)] text-center leading-[1.55]">
                  正在获取招标项目列表、专业分类和专家库容量，请稍候…
                </div>
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-[10px] font-semibold text-[var(--muted-foreground)]">
                    <span>初始化专家抽取环境</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[oklch(0.55_0.03_258_/_0.1)]">
                    <div
                      className="h-full rounded-full animate-loading-progress"
                      style={{
                        background: 'linear-gradient(90deg, oklch(0.5 0.16 258 / 0.9), oklch(0.6 0.1 258 / 0.7))',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
