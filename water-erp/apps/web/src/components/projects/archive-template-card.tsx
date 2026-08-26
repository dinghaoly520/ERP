'use client';

/**
 * D1（GB/T 43711 4.1.5.1）：档案清单对标卡——标准 13 类满足度 + 线下材料人工登记。
 * 挂在 :3005 开标确认面板（归档前后均可用）；缺项标红，manual 类可登记（附件先经 /upload）。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Archive, Upload } from 'lucide-react';
import { SectionCard } from '@/components/workbench/section-card';
import { api } from '@/lib/api';

interface TemplateRow {
  key: string;
  name: string;
  hint: string;
  satisfied: boolean;
  detail?: string;
  manual: boolean;
}

export function ArchiveTemplateCard({ bidProjectId }: { bidProjectId: string }) {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<TemplateRow[]>(`/bid/projects/${bidProjectId}/archive-template`)
      .then(setRows)
      .catch(() => setRows(null));
  }, [bidProjectId]);

  useEffect(() => { load(); }, [load]);

  const register = async (row: TemplateRow) => {
    const note = prompt(`登记「${row.name}」（可选备注，如材料名称/日期）：`) ?? '';
    if (note === '') return;
    setBusy(true);
    try {
      await api.post(`/bid/projects/${bidProjectId}/archive-manual-item`, { categoryKey: row.key, note });
      toast.success(`已登记「${row.name}」（进入归档清单待确认）`);
      load();
    } catch (e: any) {
      toast.error(e?.message || '登记失败');
    } finally { setBusy(false); }
  };

  const satisfiedCount = rows?.filter(r => r.satisfied).length ?? 0;

  return (
    <SectionCard
      icon={<Archive size={14} />}
      title="档案清单对标"
      action={rows ? (
        <span className={`text-xs font-semibold ${satisfiedCount === rows.length ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
          {satisfiedCount}/{rows.length} 类齐备（GB/T 43711 4.1.5.1）
        </span>
      ) : undefined}
    >
      {rows === null ? (
        <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {rows.map(r => (
            <div key={r.key} className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5"
              style={{ background: r.satisfied ? 'var(--accent-soft)' : 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
              <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${r.satisfied ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
              <span className={`text-[0.72rem] font-semibold ${r.satisfied ? 'text-[var(--foreground)]' : 'text-[var(--warning)]'}`}>{r.name}</span>
              <span className="truncate text-[0.62rem] text-[var(--muted-foreground)]">{r.detail ?? r.hint}</span>
              {!r.satisfied && r.manual && (
                <button type="button" onClick={() => register(r)} disabled={busy}
                  className="neu-btn-xs !h-[20px] !px-1.5 !text-[10px] ml-auto shrink-0">
                  <Upload size={10} /> 登记
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
