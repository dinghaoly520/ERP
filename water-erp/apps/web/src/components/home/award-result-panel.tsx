'use client';

import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { fetchProjectManagementList } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

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
        <div className="overflow-x-auto">
          <table className="workbench-table">
            <thead>
              <tr>
                <th>项目编号</th>
                <th>项目名称</th>
                <th>采购方式</th>
                <th>中标供应商</th>
                <th className="text-right">合同金额（元）</th>
                <th>当前阶段</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono text-xs text-[color:var(--accent)]">{i.projectCode ?? '—'}</td>
                  <td className="font-semibold text-[color:var(--foreground)]">{i.title}</td>
                  <td className="text-[color:var(--muted-foreground)]">{i.procurementMethod}</td>
                  <td className="font-semibold text-[color:var(--foreground)]">{i.awardedSupplier}</td>
                  <td className="text-right font-mono text-xs tabular-nums text-[color:var(--foreground)]">
                    {i.contractAmount != null ? Number(i.contractAmount).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td className="text-[color:var(--muted-foreground)]">{i.currentStage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
