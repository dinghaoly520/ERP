'use client';

/**
 * 项目变更体系入口（2026-11-11 spec §1）：项目标题行动作位——按钮双形态。
 *  创建人 + 开标前 →「⟳ 变更 / 补遗」（发起，Task 6 接弹窗）
 *  其余场景（他人视野 / 开标后 / 只读）→「变更 / 补遗记录」（仅查看流水）
 * 记录视图：轮次·类型·摘要·理由·操作人·时间·「公告待发」红标；点行展开字段级 diff。
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, ScrollText, X, ChevronRight } from 'lucide-react';
import { listChanges, type ProjectChangeRecord } from '@/lib/api/project-changes';

export function ProjectChangeEntry({
  projectId,
  canInitiate,
  onInitiate,
}: {
  projectId: string;
  /** 创建人且开标前（面板 actionsDisabled/isBidLocked 已合成） */
  canInitiate: boolean;
  /** 发起变更——Task 6 接三步弹窗；竞态开标后由面板 toast「开标后不可修改标前数据」 */
  onInitiate: () => void;
}) {
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [records, setRecords] = useState<ProjectChangeRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await listChanges(projectId));
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (recordsOpen) void load();
  }, [recordsOpen, load]);

  return (
    <>
      {canInitiate ? (
        <button
          type="button"
          onClick={onInitiate}
          className="neu-btn-soft"
          title="修改项目信息（登记轮次与理由，开标前可用）"
        >
          <RefreshCcw size={16} />变更 / 补遗
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setRecordsOpen(true)}
          className="neu-btn-soft"
          title="查看本项目变更与补遗记录"
        >
          <ScrollText size={16} />变更 / 补遗记录
        </button>
      )}

      {recordsOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ background: 'oklch(0.1 0.02 258 / 0.42)', backdropFilter: 'blur(4px)' }}
            onClick={() => setRecordsOpen(false)}
          />
          <div
            className="relative z-10 flex max-h-[80vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[20px]"
            style={{
              background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.75))',
              boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 4px 5px 18px oklch(0.45 0.07 258 / 0.2)',
            }}
          >
            <div className="flex shrink-0 items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
              <div className="flex items-center gap-2 text-[0.92rem] font-semibold text-[var(--foreground)]">
                <ScrollText size={16} className="text-[var(--accent)]" />
                变更 / 补遗记录
                {records && <span className="text-xs font-normal text-[var(--muted-foreground)]">共 {records.length} 轮</span>}
              </div>
              <button type="button" onClick={() => setRecordsOpen(false)} className="neu-btn-xs"><X size={15} /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {loading && <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">正在加载…</p>}
              {!loading && records && records.length === 0 && (
                <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">本项目尚无变更 / 补遗记录</p>
              )}
              {!loading && records && records.length > 0 && (
                <div className="space-y-2">
                  {records.map((r) => {
                    const summary = r.changeset?.[0]
                      ? `${r.changeset[0].label}：${r.changeset[0].from} → ${r.changeset[0].to}${r.changeset.length > 1 ? ` 等 ${r.changeset.length} 项` : ''}`
                      : '补遗登记';
                    const open = expandedId === r.id;
                    return (
                      <div key={r.id} className="rounded-[12px] border border-[var(--border)] bg-[oklch(1_0_0/0.55)]">
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-3 text-left"
                          onClick={() => setExpandedId(open ? null : r.id)}
                        >
                          <span
                            className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[7px] px-1.5 text-[11px] font-extrabold"
                            style={{
                              background: r.type === 'CHANGE' ? 'color-mix(in oklch, var(--warning) 16%, transparent)' : 'color-mix(in oklch, var(--accent) 14%, transparent)',
                              color: r.type === 'CHANGE' ? 'var(--warning)' : 'var(--accent)',
                            }}
                          >
                            {r.round}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[var(--foreground)]">
                              {r.type === 'CHANGE' ? '变更' : '补遗'} · {summary}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">
                              理由：{r.reason} · {r.operatorName} · {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                            </span>
                          </span>
                          {r.needsAnnouncement && !r.announcementId && (
                            <span className="shrink-0 rounded-[6px] bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                              公告待发
                            </span>
                          )}
                          <ChevronRight size={15} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-90' : ''}`} />
                        </button>
                        {open && r.changeset?.length > 0 && (
                          <div className="border-t border-dashed border-[var(--border)] px-4 py-3">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                                  <th className="py-1 pr-2 font-bold">字段</th>
                                  <th className="py-1 pr-2 font-bold">原值</th>
                                  <th className="py-1 font-bold">新值</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.changeset.map((c) => (
                                  <tr key={c.field} className="border-t border-[var(--border)]/60">
                                    <td className="py-1.5 pr-2 font-semibold text-[var(--foreground)]">{c.label}</td>
                                    <td className="py-1.5 pr-2 text-[var(--muted-foreground)] line-through decoration-[var(--muted-foreground)]/40">{c.from || '（空）'}</td>
                                    <td className="py-1.5 font-semibold text-[var(--accent-strong)]">{c.to || '（空）'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
