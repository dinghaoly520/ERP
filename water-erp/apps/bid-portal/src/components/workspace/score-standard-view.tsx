'use client';

/**
 * 只读评分标准视图——:3007 项目工作区「评分标准」tab（Phase 2 · T17）。
 * 评分项按类别展示 + 展开查看得分点，零编辑能力：
 * 编制 / 发布 / 模板 / AI 提取均在采购管理工作台（:3005）开标确认面板，本端不持有任何写操作。
 *
 * 数据来源：project.scoreItems（工作区上下文 GET /bid/projects/:id）+
 * GET /bid/projects/:id/score-items/:itemId/points（既有端点，返回 Prisma
 * BidScorePoint 原形：name + fullScore，fullScore 为 Decimal 序列化字符串，
 * 展示侧统一 Number() 消费；与 :3005 apps/web lib/api/bid.ts BidScorePoint 同形状）。
 */

import { useEffect, useState, useRef } from 'react';
import { ListChecks, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

/** 得分点（GET .../score-items/:itemId/points 返回的 BidScorePoint 子集）。 */
interface ScorePoint {
  id: string;
  name: string;
  fullScore: string; // Prisma Decimal → 序列化字符串，展示以 Number() 消费
  seq: number;
}

/** 评分标准只读展示（编制/发布/模板/AI 提取均在 :3005）。 */
export default function ScoreStandardView({ projectId, project }: { projectId: string; project?: BidProjectDetail }) {
  // O1：context 副本已删（工作区页恒传 project，原 ctx 回退实际不可达）
  const [pointsByItem, setPointsByItem] = useState<Record<string, ScorePoint[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const items = project?.scoreItems ?? [];

  useEffect(() => {
    const ac = new AbortController();
    const fetched = new Set(Object.keys(pointsByItem));
    for (const item of items) {
      if (fetched.has(item.id)) continue;
      api.get<ScorePoint[]>(`/bid/projects/${projectId}/score-items/${item.id}/points`, { signal: ac.signal })
        .then(pts => setPointsByItem(prev => ({ ...prev, [item.id]: pts })))
        .catch(() => {});
    }
    return () => ac.abort();
  }, [items, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;
  if (items.length === 0) {
    return <div className="neu-card-static px-6 py-16 text-center text-[13px] text-[color:var(--muted-foreground)]">暂无评分标准。编制入口在采购管理工作台（:3005）开标确认面板。</div>;
  }

  const total = items.reduce((s, i) => s + Number(i.maxScore || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <ListChecks size={15} /> 评分标准（只读）
          <span className="text-[11px] font-normal text-[color:var(--muted-foreground)]">编制在采购管理工作台（:3005）</span>
        </h2>
        <span className="text-[12px] font-mono font-bold tabular-nums text-[color:var(--accent-strong)]">总分 {total}</span>
      </div>
      {items.map(item => {
        const pts = pointsByItem[item.id];
        const isOpen = expanded.has(item.id);
        return (
          <section key={item.id} className="neu-card-static overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
              className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="flex-1 text-[13px] font-bold">{item.name}</span>
              <span className="rounded-full bg-[oklch(0.62_0.16_251_/_0.1)] px-2 py-0.5 text-[10px] font-bold text-[oklch(0.5_0.13_251)]">{item.category}</span>
              <span className="font-mono text-[12px] font-bold tabular-nums">{item.maxScore} 分</span>
            </button>
            {isOpen && (
              <div className="border-t border-[oklch(0.6_0.04_258_/_0.12)] px-5 py-3">
                {!pts ? (
                  <div className="py-2 text-[12px] text-[color:var(--muted-foreground)]">加载得分点…</div>
                ) : pts.length === 0 ? (
                  <div className="py-2 text-[12px] text-[color:var(--muted-foreground)]">无得分点</div>
                ) : (
                  <ul className="space-y-1.5">
                    {pts.map(p => (
                      <li key={p.id} className="flex items-center justify-between text-[12px]">
                        <span className="text-[color:var(--foreground)]">{p.name}</span>
                        <span className="font-mono tabular-nums text-[color:var(--muted-foreground)]">{Number(p.fullScore)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
