'use client';

import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { fetchProjectManagementList } from '@/lib/api/project-management';
import { PROJECT_WORKFLOW_STAGES_ALL } from '@/lib/types/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

/** 阶段枚举 → 中文（界面不允许出现英文枚举值；未识别时兜底原值防数据漂移） */
const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  PROJECT_WORKFLOW_STAGES_ALL.map((s) => [s.key, s.label]),
);

/** 阶段语义色：定标=进行中（accent）、合同=已完成（success）、其余默认中性 */
function stageTone(stage: string): 'accent' | 'success' | 'neutral' {
  if (stage === 'CONTRACT') return 'success';
  if (stage === 'AWARD_DECISION') return 'accent';
  return 'neutral';
}

const TONE_CLS: Record<string, string> = {
  accent: 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]',
  success: 'bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-[var(--success)]',
  neutral: 'bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] text-[var(--muted-foreground)]',
};

/** CTS-EBS01 A-203：标段（包）与中标信息关联查询（项目 → 中标供应商/合同金额 明细） */
export function AwardResultPanel() {
  const [items, setItems] = useState<ProjectManagementItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjectManagementList()
      .then((all) => setItems(all.filter((i) => i.awardedSupplier)))
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, []);

  return (
    <section className="wb-panel mb-3">
      <div className="wb-panel-header">
        <span className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">
          <Trophy size={15} className="text-[color:var(--accent)]" />
          项目中标结果
          <span className="text-[10px] font-normal text-[color:var(--muted-foreground)]">CTS A-203 · 标段与中标信息关联</span>
        </span>
        {items && <span className="text-[11px] text-[color:var(--muted-foreground)]">共 {items.length} 项已定标</span>}
      </div>
      {error ? (
        <p className="px-5 py-8 text-center text-xs text-[color:var(--danger)]">{error}</p>
      ) : items === null ? (
        <p className="px-5 py-8 text-center text-xs text-[color:var(--muted-foreground)]">加载中…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-[color:var(--muted-foreground)]">暂无已定标项目</p>
      ) : (
        <div className="neu-table-card mt-3">
          <div className="overflow-x-auto">
            <table className="neu-table w-full min-w-[860px] text-center">
              <thead>
                <tr>
                  <th>项目编号</th>
                  <th>项目名称</th>
                  <th>采购方式</th>
                  <th>中标供应商</th>
                  <th>合同金额（元）</th>
                  <th>当前阶段</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const tone = stageTone(i.currentStage);
                  return (
                    <tr key={i.id}>
                      <td className="font-mono text-xs text-[color:var(--accent)]">{i.projectCode ?? '—'}</td>
                      <td className="font-semibold text-[color:var(--foreground)]">{i.title}</td>
                      <td className="text-[color:var(--muted-foreground)]">{i.procurementMethod}</td>
                      <td className="font-semibold text-[color:var(--foreground)]">{i.awardedSupplier}</td>
                      <td className="font-mono text-xs tabular-nums text-[color:var(--foreground)]">
                        {i.contractAmount != null ? Number(i.contractAmount).toLocaleString('zh-CN') : '—'}
                      </td>
                      <td>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${TONE_CLS[tone]}`}>
                          {STAGE_LABELS[i.currentStage] ?? i.currentStage}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
