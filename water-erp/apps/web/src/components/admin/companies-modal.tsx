"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Check, Pencil, RefreshCw, X } from "lucide-react";
import { Modal } from "@/components/workbench";
import { apiFetch } from "@/lib/api/api-fetch";

/* ═══════════════════════════════════════════════════════════════
   单位管理弹窗（D4 · CTS A-205~A-207 裁剪）——内部单位主数据维护 + 业绩视图
   2026-10-09：由 /admin/companies 独立页迁入账号管理，窗口展示
   ═══════════════════════════════════════════════════════════════ */

type CompanyRow = {
  id: string;
  name: string;
  shortName: string | null;
  createdAt: string;
  _count: { users: number; pmItems: number };
  archivedCount: number;
  contractTotal: number;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/companies${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Portal": "web", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json();
}

export function CompaniesModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  /** 单位改名后公司选项集变化，调用方静默刷新账号表单/归属下拉 */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; shortName: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<CompanyRow[]>("/management"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editing.name, shortName: editing.shortName }),
      });
      setEditing(null);
      onChanged?.();
      void reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const totals = {
    users: rows.reduce((s, r) => s + r._count.users, 0),
    archived: rows.reduce((s, r) => s + r.archivedCount, 0),
    contract: rows.reduce((s, r) => s + r.contractTotal, 0),
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]">
            <Building2 size={14} strokeWidth={1.9} className="text-[var(--accent)]" />
          </span>
          单位管理
        </span>
      }
      description="内部单位主数据维护 · 每单位项目业绩（CTS A-205~A-207）"
      size="2xl"
      headerExtra={
        <button onClick={() => void reload()} className="neu-btn-xs" title="刷新">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      }
      footer={
        <button type="button" onClick={onClose} className="neu-btn-soft !h-9 !text-xs">
          关闭
        </button>
      }
    >
      {/* 指标行（原 page-hero KPI 区） */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">单位数</span>
          <span className="text-[1.55rem] font-black tabular-nums">{rows.length}</span>
        </div>
        <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">在册账号</span>
          <span className="text-[1.55rem] font-black tabular-nums">{totals.users}</span>
        </div>
        <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">已归档项目</span>
          <span className="text-[1.55rem] font-black tabular-nums">{totals.archived}</span>
        </div>
        <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">合同额合计</span>
          <span className="text-[1.2rem] font-black tabular-nums">￥{totals.contract.toLocaleString("zh-CN")}</span>
        </div>
      </div>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      <section className="neu-table-card">
        <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold tracking-wide">单位台账</span>
          </div>
          <span className="text-xs text-[var(--muted-foreground)]">改名即时生效于新项目归属快照；历史快照不受影响</span>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[760px]">
            <thead>
              <tr className="text-left">
                <th>单位名称</th>
                <th>简称</th>
                <th>账号数</th>
                <th>立项数</th>
                <th>已归档</th>
                <th>合同额合计</th>
                <th>建档时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r =>
                editing?.id === r.id ? (
                  <tr key={r.id} data-selected="true">
                    <td><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="workbench-input text-sm" /></td>
                    <td><input value={editing.shortName} onChange={e => setEditing({ ...editing, shortName: e.target.value })} placeholder="—" className="workbench-input text-sm" /></td>
                    <td colSpan={5} className="text-xs text-[var(--muted-foreground)]">编辑中——名称须全局唯一</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setEditing(null)} className="neu-btn-xs" disabled={saving}><X size={12} /></button>
                        <button onClick={() => void save()} className="neu-btn-xs is-success" disabled={saving || !editing.name.trim()}><Check size={12} /> 保存</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className="row-clickable">
                    <td className="font-medium">{r.name}</td>
                    <td className="text-[var(--muted-foreground)]">{r.shortName ?? "—"}</td>
                    <td className="tabular-nums">{r._count.users}</td>
                    <td className="tabular-nums">{r._count.pmItems}</td>
                    <td className="tabular-nums">{r.archivedCount}</td>
                    <td className="font-mono tabular-nums text-xs">{r.contractTotal ? `￥${r.contractTotal.toLocaleString("zh-CN")}` : "—"}</td>
                    <td className="font-mono text-xs text-[var(--muted-foreground)]">{new Date(r.createdAt).toLocaleDateString("zh-CN")}</td>
                    <td className="text-right">
                      <button onClick={() => setEditing({ id: r.id, name: r.name, shortName: r.shortName ?? "" })} className="neu-btn-xs">
                        <Pencil size={12} /> 编辑
                      </button>
                    </td>
                  </tr>
                ),
              )}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={8} className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无单位（供应商/用户注册建档时自动生成）</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </Modal>
  );
}
