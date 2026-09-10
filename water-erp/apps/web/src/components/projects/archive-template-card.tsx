'use client';

/**
 * D1（GB/T 43711 4.1.5.1）：档案清单对标卡——标准 13 类满足度 + 线下材料人工登记。
 * 挂在 :3005 开标确认面板（归档前后均可用）；缺项标红。
 * 2026-09-10 批量登记改造：manual/缺失类一次性勾选登记（默认全选、默认备注），
 * 顺序调用幂等端点 POST /bid/projects/:id/archive-manual-item（后端同类别未归档则更新），
 * 替代原每行 prompt() 单条登记。
 * 2026-09-10 方案 X：按采购方式豁免不适用类——后端行带 applicable=false（不计缺项、
 * 无登记入口），本卡弱化展示「不适用」，计数器只对适用类对标。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Archive, ClipboardCheck } from 'lucide-react';
import { SectionCard } from '@/components/workbench/section-card';
import { Modal } from '@/components/workbench';
import { api } from '@/lib/api';

const DEFAULT_NOTE = '线下材料已归档';

interface TemplateRow {
  key: string;
  name: string;
  hint: string;
  satisfied: boolean;
  detail?: string;
  manual: boolean;
  /** 方案 X：该采购方式下是否适用（不适用=豁免对标，不计缺项、无登记入口） */
  applicable: boolean;
}

export function ArchiveTemplateCard({ bidProjectId }: { bidProjectId: string }) {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api.get<TemplateRow[]>(`/bid/projects/${bidProjectId}/archive-template`)
      .then(setRows)
      .catch(() => setRows(null));
  }, [bidProjectId]);

  useEffect(() => { load(); }, [load]);

  /** 待登记 = 未满足且可人工登记 */
  const pendingRows = useMemo(() => (rows ?? []).filter(r => !r.satisfied && r.manual), [rows]);

  const openBulk = () => {
    // 默认全选 + 默认备注（可逐行修改/取消勾选）
    const sel: Record<string, boolean> = {};
    const nt: Record<string, string> = {};
    for (const r of pendingRows) { sel[r.key] = true; nt[r.key] = DEFAULT_NOTE; }
    setSelected(sel);
    setNotes(nt);
    setBulkOpen(true);
  };

  const submitBulk = async () => {
    const targets = pendingRows.filter(r => selected[r.key]);
    if (targets.length === 0) { toast.info('请至少勾选一项'); return; }
    setSubmitting(true);
    let ok = 0;
    const failures: string[] = [];
    for (const r of targets) {
      try {
        await api.post(`/bid/projects/${bidProjectId}/archive-manual-item`, { categoryKey: r.key, note: notes[r.key]?.trim() ?? '' });
        ok += 1;
      } catch (e: any) {
        failures.push(`${r.name}：${e?.message || '登记失败'}`);
      }
    }
    setSubmitting(false);
    if (failures.length > 0) {
      toast.error(`已登记 ${ok}/${targets.length} 类；失败：${failures.join('；')}`);
    } else {
      toast.success(`已登记 ${ok} 类（进入归档清单待确认）`);
      setBulkOpen(false);
    }
    load();
  };

  // 方案 X：只对适用类对标；豁免类不计入分母
  const applicableRows = (rows ?? []).filter(r => r.applicable);
  const exemptCount = (rows?.length ?? 0) - applicableRows.length;
  const satisfiedCount = applicableRows.filter(r => r.satisfied).length;
  const allSatisfied = applicableRows.length > 0 && satisfiedCount === applicableRows.length;

  return (
    <SectionCard
      icon={<Archive size={14} />}
      title="档案清单对标"
      action={rows ? (
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${allSatisfied ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
            {satisfiedCount}/{applicableRows.length} 类齐备{exemptCount > 0 ? ` · 豁免 ${exemptCount}` : ''}
          </span>
          {pendingRows.length > 0 && (
            <button type="button" onClick={openBulk} className="neu-btn-xs">
              <ClipboardCheck size={12} /> 批量登记（{pendingRows.length}）
            </button>
          )}
        </div>
      ) : undefined}
    >
      {rows === null ? (
        <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {rows.map(r => !r.applicable ? (
            /* 方案 X：该采购方式下不适用——豁免对标，弱化展示 */
            <div key={r.key} className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 opacity-60">
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--muted-foreground)]" />
              <span className="text-[0.72rem] font-semibold text-[var(--muted-foreground)]">{r.name}</span>
              <span className="rounded-full px-1.5 py-px text-[10px] font-medium text-[var(--muted-foreground)]"
                style={{ background: 'color-mix(in oklch, var(--muted-foreground) 10%, transparent)' }}>不适用</span>
            </div>
          ) : (
            <div key={r.key} className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5"
              style={{ background: r.satisfied ? 'var(--accent-soft)' : 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
              <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${r.satisfied ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
              <span className={`text-[0.72rem] font-semibold ${r.satisfied ? 'text-[var(--foreground)]' : 'text-[var(--warning)]'}`}>{r.name}</span>
              <span className="truncate text-[0.62rem] text-[var(--muted-foreground)]">{r.detail ?? r.hint}</span>
            </div>
          ))}
        </div>
      )}

      {/* 批量登记 Modal */}
      <Modal
        open={bulkOpen}
        onClose={() => { if (!submitting) setBulkOpen(false); }}
        size="md"
        title="批量登记档案材料"
        description="勾选要登记的类别并填写备注（登记后进入归档清单待确认；同类别重复登记会更新原登记）"
      >
        <div className="space-y-2">
          {pendingRows.map(r => (
            <div key={r.key} className="flex items-start gap-2.5 rounded-[12px] bg-[oklch(0.975_0.012_258/0.5)] px-3 py-2.5">
              <input
                type="checkbox"
                className="neu-checkbox mt-0.5 shrink-0"
                checked={!!selected[r.key]}
                onChange={(e) => setSelected(s => ({ ...s, [r.key]: e.target.checked }))}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--foreground)]">{r.name}</div>
                <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{r.hint}</div>
                <input
                  value={notes[r.key] ?? ''}
                  onChange={(e) => setNotes(n => ({ ...n, [r.key]: e.target.value }))}
                  placeholder="备注（如材料名称/日期；留空则不带备注）"
                  className="workbench-input mt-1.5 w-full !h-[34px] !text-xs"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" className="neu-btn-soft h-[38px]" onClick={() => setBulkOpen(false)} disabled={submitting}>取消</button>
          <button type="button" className="neu-btn-primary !h-[38px] !text-xs" onClick={submitBulk} disabled={submitting}>
            {submitting ? '登记中…' : `登记所选（${pendingRows.filter(r => selected[r.key]).length}）`}
          </button>
        </div>
      </Modal>
    </SectionCard>
  );
}
