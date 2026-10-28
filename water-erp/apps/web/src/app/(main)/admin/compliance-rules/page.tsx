'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, ListChecks, Pencil, RefreshCw, Sparkles, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/api-fetch';
import { TableSkeleton } from '@/components/workbench';
import { PMI_STAGE_LABEL } from '@water-erp/shared';

/* ═══════════════════════════════════════════════════════════════
   合规规则配置（C4）——阶段合规审查要点在线维护（DB 覆盖层 + 内置回退）
   数据管理页标准三层：page-hero + wb-toolbar(阶段 tab) + neu-table-card
   2026-10-09：自账号管理弹窗迁出，独立页挂侧栏「系统管理」组（leader/admin）
   ═══════════════════════════════════════════════════════════════ */

type RuleRow = {
  id: string; stageKey: string; name: string; dimension: string;
  criteria: string; regulationRef: string; enabled: boolean; sortOrder: number;
};
type StageData = { source: 'db' | 'builtin'; rows: RuleRow[] };

const STAGE_LABEL: Record<string, string> = PMI_STAGE_LABEL; // R7-4① 单一源

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/stage-compliance${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json();
}

export default function ComplianceRulesPage() {
  const [stages, setStages] = useState<string[]>([]);
  const [stage, setStage] = useState('');
  const [data, setData] = useState<StageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; criteria: string; regulationRef: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<string[]>('/stages').then(keys => {
      setStages(keys);
      setStage(k => k || keys[0] || '');
    }).catch(e => setError((e as Error).message));
  }, []);

  const reload = useCallback(async () => {
    if (!stage) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<StageData>(`/rules?stageKey=${stage}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stage]);

  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api(`/rules/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ criteria: editing.criteria, regulationRef: editing.regulationRef }),
      });
      setEditing(null);
      void reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* builtin 快照行 id 是合成的（后端 PATCH 拒绝 BUILTIN_NOT_IMPORTED）——首次操作先把
     该阶段内置规则幂等入库，再按 name 对回 DB 行（init upsert 键=stageKey+name，稳定） */
  const ensureEditable = async (): Promise<RuleRow[] | null> => {
    if (data?.source === 'db') return data.rows;
    await api(`/init?stageKey=${stage}`, { method: 'POST' });
    const fresh = await api<StageData>(`/rules?stageKey=${stage}`);
    setData(fresh);
    return fresh.rows;
  };

  const startEdit = async (r: RuleRow) => {
    setBusy(true);
    try {
      const row = (await ensureEditable())?.find(x => x.name === r.name);
      if (row) setEditing({ id: row.id, criteria: row.criteria, regulationRef: row.regulationRef });
      else setError('未找到对应规则行，请刷新重试');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: RuleRow) => {
    setBusy(true);
    try {
      const dbRow = (await ensureEditable())?.find(x => x.name === row.name) ?? row;
      await api(`/rules/${dbRow.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !dbRow.enabled }) });
      void reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const initFromBuiltin = async () => {
    setBusy(true);
    try {
      const r = await api<{ imported: number }>(`/init?stageKey=${stage}`, { method: 'POST' });
      void reload();
      setError(null);
      window.alert(`已导入 ${r.imported} 条内置规则到数据库（已存在的项保持不变）`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ═══ page-hero ═══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ListChecks size={17} strokeWidth={1.9} /></div>
            <div>
              <div className="page-hero__title">合规规则</div>
              <div className="page-hero__sub">在线维护各采购阶段的合规审查要点，未维护的阶段沿用系统内置规则</div>
            </div>
          </div>
          <div className="page-hero__right">
            {data?.source === 'db' && (
              <span className="page-hero__stat page-hero__stat--info">数据库（生效中）</span>
            )}
            {data?.source === 'builtin' && (
              <button onClick={() => void initFromBuiltin()} className="neu-btn-xs" disabled={busy} title="将内置规则快照显式导入数据库（行内编辑/停用时也会自动入库）">
                <Sparkles size={13} /> 从内置初始化
              </button>
            )}
            <button onClick={() => void reload()} disabled={loading} className="neu-btn-xs" aria-label="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="page-hero__divider" />
      </div>

      {/* ═══ 工具栏：阶段切换（11 个阶段超出 segment 支持段数，沿用 neu-tab-bar 换行；
          置于页面底色而非 hero 白瓷渐变上，内凹轨道对比度才成立）═══ */}
      <div className="wb-toolbar !py-2.5">
        <div className="neu-tab-bar flex flex-wrap">
          {stages.map(k => (
            <button key={k} onClick={() => setStage(k)} className={`neu-tab ${stage === k ? 'is-active' : ''}`}>
              {STAGE_LABEL[k] ?? k}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-xs text-[var(--muted-foreground)]">
          {STAGE_LABEL[stage] ?? (stage || '—')} · 审查要点
          <span className="neu-tab-count ml-2">{data?.rows.length ?? 0}</span>
        </span>
      </div>

      {data?.source === 'builtin' && (
        <p className="text-xs text-[var(--muted-foreground)]">
          当前展示内置规则快照（只读）——点「从内置初始化」入库后即可在线编辑/停用。
        </p>
      )}

      {/* ═══ 数据表 ═══ */}
      <div className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold tracking-wide">审查要点清单</span>
          <span className="text-xs text-[var(--muted-foreground)]">消费方：项目管理「阶段合规审查」（audit-compliance）</span>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[960px]">
            <thead>
              <tr>
                <th>审查项</th><th>维度</th><th>审查要点（AI 判据）</th><th>法规依据</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {error && (
                <tr>
                  <td colSpan={6} className="px-4 py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
                        <AlertTriangle size={22} className="text-[var(--danger)]" />
                      </div>
                      <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
                      <button onClick={() => void reload()} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
                    </div>
                  </td>
                </tr>
              )}
              {!error && loading && (
                <TableSkeleton cols={6} rows={6} />
              )}
              {!error && !loading && (data?.rows ?? []).map(r =>
                editing?.id === r.id ? (
                  <tr key={r.id} data-selected="true">
                    <td className="align-top font-medium">{r.name}</td>
                    <td className="align-top">{r.dimension}</td>
                    <td className="align-top"><textarea value={editing.criteria} onChange={e => setEditing({ ...editing, criteria: e.target.value })} rows={4} className="neu-input w-full min-w-[280px] text-xs leading-relaxed" /></td>
                    <td className="align-top"><textarea value={editing.regulationRef} onChange={e => setEditing({ ...editing, regulationRef: e.target.value })} rows={4} className="neu-input w-full min-w-[200px] text-xs leading-relaxed" /></td>
                    <td className="align-top">编辑中</td>
                    <td className="align-top">
                      <div className="flex justify-center gap-1.5">
                        <button onClick={() => setEditing(null)} className="neu-btn-xs" disabled={busy}><X size={12} /></button>
                        <button onClick={() => void save()} className="neu-btn-xs is-success" disabled={busy}><Check size={12} /> 保存</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="row-clickable">
                    <td className="align-top font-medium">{r.name}</td>
                    <td className="align-top whitespace-nowrap text-[var(--muted-foreground)]">{r.dimension}</td>
                    {/* 长文列全文换行（2026-10-28：原 truncate 单行截断显示不全）——max-w 控制阅读宽度，align-top 走 globals 对齐出口 */}
                    <td className="align-top max-w-[520px] text-left text-xs leading-relaxed">{r.criteria}</td>
                    <td className="align-top max-w-[320px] text-left text-xs leading-relaxed text-[var(--muted-foreground)]">{r.regulationRef}</td>
                    <td className="align-top">
                      <span className={`text-xs font-medium ${r.enabled ? 'text-emerald-700' : 'text-[var(--muted-foreground)]'}`}>
                        {r.enabled ? '生效' : '已停用'}
                      </span>
                    </td>
                    {/* 操作按钮恒渲染（2026-10-28）：builtin 阶段（DB 无记录）原为空列，现首次操作自动入库 */}
                    <td className="align-top">
                      <div className="flex justify-center gap-1.5" title={data?.source === 'db' ? undefined : '内置规则快照：首次操作将自动入库后执行'}>
                        <button onClick={() => void startEdit(r)} className="neu-btn-xs" disabled={busy}>
                          <Pencil size={12} /> 编辑
                        </button>
                        <button onClick={() => void toggle(r)} className={`neu-btn-xs ${r.enabled ? 'is-warning' : 'is-success'}`} disabled={busy}>
                          {r.enabled ? '停用' : '启用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {!error && !loading && data && data.rows.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-xs text-[var(--muted-foreground)]">该阶段无规则</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
