'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ListChecks, Pencil, RefreshCw, Sparkles, X } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   合规规则配置（C4）——阶段合规审查要点在线维护（DB 覆盖层 + 内置回退）
   数据管理页标准三层：page-hero + 工具栏(tab) + neu-table-card
   ═══════════════════════════════════════════════════════════════ */

type RuleRow = {
  id: string; stageKey: string; name: string; dimension: string;
  criteria: string; regulationRef: string; enabled: boolean; sortOrder: number;
};
type StageData = { source: 'db' | 'builtin'; rows: RuleRow[] };

const STAGE_LABEL: Record<string, string> = {
  PROCUREMENT_DEMAND: '采购需求', INITIATION: '采购立项', TENDER_DOCUMENT: '采购文件',
  SUPPLIER_INVITATION: '供应商邀请', PUBLIC_ANNOUNCEMENT: '公告公示', EXPERT_SELECTION: '专家抽取',
  BID_EVALUATION: '开标评标', AWARD_DECISION: '定标', CONTRACT: '合同',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/stage-compliance${path}`, {
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

  const toggle = async (row: RuleRow) => {
    setBusy(true);
    try {
      await api(`/rules/${row.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !row.enabled }) });
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
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
      {/* ═══ page-hero ═══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ListChecks size={17} /></div>
            <div>
              <div className="page-hero__title">合规规则配置</div>
              <div className="page-hero__sub">阶段合规审查要点在线维护（DB 覆盖层，空阶段回退内置规则表）</div>
            </div>
          </div>
          <div className="page-hero__right">
            {data?.source === 'builtin' && (
              <button onClick={() => void initFromBuiltin()} className="neu-btn-soft text-xs" disabled={busy}>
                <Sparkles size={13} /> 从内置初始化
              </button>
            )}
            <button onClick={() => void reload()} className="neu-btn-xs" title="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)', paddingTop: '1rem' }} />

        <div className="neu-tab-bar flex flex-wrap">
          {stages.map(k => (
            <button key={k} onClick={() => setStage(k)} className={`neu-tab ${stage === k ? 'is-active' : ''}`}>
              {STAGE_LABEL[k] ?? k}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="px-1 text-xs text-[var(--danger)]">{error}</p>}
      {data?.source === 'builtin' && (
        <p className="px-1 text-xs text-[var(--muted-foreground)]">
          当前展示内置规则快照（只读）——点「从内置初始化」入库后即可在线编辑/停用。
        </p>
      )}

      <section className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold tracking-wide">
            {STAGE_LABEL[stage] ?? stage} · 审查要点
            <span className="neu-tab-count ml-2">{data?.rows.length ?? 0}</span>
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            规则来源：{data?.source === 'db' ? '数据库（生效中）' : '内置表（回退）'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[860px]">
            <thead>
              <tr className="text-left">
                <th>审查项</th><th>维度</th><th>审查要点（AI 判据）</th><th>法规依据</th><th>状态</th><th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map(r =>
                editing?.id === r.id ? (
                  <tr key={r.id} data-selected="true">
                    <td className="font-medium">{r.name}</td>
                    <td>{r.dimension}</td>
                    <td><textarea value={editing.criteria} onChange={e => setEditing({ ...editing, criteria: e.target.value })} rows={3} className="neu-input w-full min-w-[280px] text-xs" /></td>
                    <td><textarea value={editing.regulationRef} onChange={e => setEditing({ ...editing, regulationRef: e.target.value })} rows={3} className="neu-input w-full min-w-[200px] text-xs" /></td>
                    <td>编辑中</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setEditing(null)} className="neu-btn-xs" disabled={busy}><X size={12} /></button>
                        <button onClick={() => void save()} className="neu-btn-xs is-success" disabled={busy}><Check size={12} /> 保存</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="row-clickable">
                    <td className="font-medium">{r.name}</td>
                    <td className="whitespace-nowrap text-[var(--muted-foreground)]">{r.dimension}</td>
                    <td className="max-w-[340px] truncate text-xs" title={r.criteria}>{r.criteria}</td>
                    <td className="max-w-[220px] truncate text-xs text-[var(--muted-foreground)]" title={r.regulationRef}>{r.regulationRef}</td>
                    <td>
                      <span className={`text-xs font-medium ${r.enabled ? 'text-emerald-700' : 'text-[var(--muted-foreground)]'}`}>
                        {r.enabled ? '生效' : '已停用'}
                      </span>
                    </td>
                    <td className="text-right">
                      {data?.source === 'db' && (
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setEditing({ id: r.id, criteria: r.criteria, regulationRef: r.regulationRef })} className="neu-btn-xs" disabled={busy}>
                            <Pencil size={12} /> 编辑
                          </button>
                          <button onClick={() => void toggle(r)} className={`neu-btn-xs ${r.enabled ? 'is-warning' : 'is-success'}`} disabled={busy}>
                            {r.enabled ? '停用' : '启用'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ),
              )}
              {data && data.rows.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-xs text-[var(--muted-foreground)]">该阶段无规则</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
