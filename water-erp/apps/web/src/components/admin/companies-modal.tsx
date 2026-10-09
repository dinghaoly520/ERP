"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Check, Pencil, RefreshCw, X } from "lucide-react";
import { Modal } from "@/components/workbench";
import { apiFetch } from "@/lib/api/api-fetch";

/* ═══════════════════════════════════════════════════════════════
   单位管理弹窗（D4 · CTS A-205~A-207 裁剪）——内部单位主数据维护 + 业绩视图
   2026-10-09：由 /admin/companies 独立页迁入账号管理，窗口展示
   2026-10-09②：账号数拆口径（在编/评审专家）、立项数剔除回收站条目、
                新增公司编码与在办/已归档拆分展示
   ═══════════════════════════════════════════════════════════════ */

type CompanyRow = {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null; // 公司编码（项目编号前缀段）
  createdAt: string;
  officeUsers: number; // 在编人员（admin/leader/staff/bid_host）
  expertUsers: number; // 评审专家（专家库公司归属）
  activeProjects: number; // 在办项目（ACTIVE）
  archivedCount: number; // 已归档（ARCHIVED）
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

function KpiCard({ label, value, isMoney = false }: { label: string; value: number; isMoney?: boolean }) {
  return (
    <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</span>
      <span className={`font-black tabular-nums ${isMoney ? "text-[1.2rem]" : "text-[1.55rem]"}`}>
        {isMoney ? `￥${value.toLocaleString("zh-CN")}` : value}
      </span>
    </div>
  );
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
    office: rows.reduce((s, r) => s + r.officeUsers, 0),
    experts: rows.reduce((s, r) => s + r.expertUsers, 0),
    active: rows.reduce((s, r) => s + r.activeProjects, 0),
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
      description="内部单位主数据维护 · 每单位账号构成与项目业绩（CTS A-205~A-207）"
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="单位数" value={rows.length} />
        <KpiCard label="在编人员" value={totals.office} />
        <KpiCard label="评审专家" value={totals.experts} />
        <KpiCard label="在办项目" value={totals.active} />
        <KpiCard label="已归档项目" value={totals.archived} />
        <KpiCard label="合同额合计" value={totals.contract} isMoney />
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
          <table className="neu-table w-full min-w-[820px]">
            <thead>
              <tr className="text-left">
                <th>单位</th>
                <th>在编人员</th>
                <th>评审专家</th>
                <th>在办项目</th>
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
                    <td>
                      <div className="font-medium">{r.name}</div>
                      <div className="font-mono text-xs text-[var(--muted-foreground)]">
                        {r.code ?? "—"}
                        {r.shortName ? ` · ${r.shortName}` : ""}
                      </div>
                    </td>
                    <td className="tabular-nums">{r.officeUsers}</td>
                    <td className="tabular-nums">{r.expertUsers}</td>
                    <td className="tabular-nums">{r.activeProjects}</td>
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
        <div className="neu-table-card-footer">
          <span className="text-xs text-[var(--muted-foreground)]">
            统计口径：在编人员 = 管理/办公/开标主持账号，评审专家单列（专家库公司归属）；在办/已归档项目不含回收站与已终止条目
          </span>
        </div>
      </section>
    </Modal>
  );
}
