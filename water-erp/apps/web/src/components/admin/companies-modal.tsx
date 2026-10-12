"use client";

import { useCallback, useEffect, useState } from "react";
import { Landmark, Pencil, RefreshCw } from "lucide-react";
import { Modal } from "@/components/workbench";
import { CompanyEditDialog } from "@/components/admin/company-edit-dialog";
import { apiFetch } from "@/lib/api/api-fetch";

/* ═══════════════════════════════════════════════════════════════
   公司信息管理弹窗（D4 · CTS A-205~A-207）——admin 全量公司维护
   2026-10-09：由 /admin/companies 独立页迁入账号管理，窗口展示
   2026-10-09②：账号数拆口径（在编/评审专家）、立项数剔除回收站条目
   2026-10-10：更名「公司信息管理」；行内展开全字段编辑
   2026-10-12：编辑改嵌套弹窗（与 leader 公司信息管理页同数据面：基本信息 +
   采购人/开标地点/监督条目），旧单值字段退出维护界面；KPI 已归档/合同额
   改按采购台账 AWARDED 轮次口径（服务端 /management 同步切换）
   ═══════════════════════════════════════════════════════════════ */

type CompanyRow = {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null; // 公司编码（项目编号前缀段，只读）
  createdAt: string;
  officeUsers: number; // 在编人员（admin/leader/staff/bid_host）
  expertUsers: number; // 评审专家（专家库公司归属）
  activeProjects: number; // 在办项目（PMI ACTIVE）
  archivedCount: number; // 已归档（2026-10-12 改口径：台账 AWARDED 轮次）
  contractTotal: number; // 合同额合计（台账 AWARDED 轮次 awardAmount 求和）
  purchaserCount: number; // 采购人条目数（编辑窗口可见性）
  placeCount: number; // 开标地点条目数
  supervisionCount: number; // 监督举报条目数
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
  /** 公司改名后公司选项集变化，调用方静默刷新账号表单/归属下拉 */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 编辑窗口目标公司（2026-10-12：行内展开改嵌套弹窗） */
  const [editing, setEditing] = useState<CompanyRow | null>(null);

  const reload = useCallback(async (): Promise<CompanyRow[]> => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api<CompanyRow[]>("/management");
      setRows(rows);
      return rows;
    } catch (e) {
      setError((e as Error).message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** 基本信息保存（改名/简称）→ 刷新台账/KPI + 同步编辑中公司对象（弹窗标题不陈旧）+ 冒泡账号刷新 */
  const handleEditChanged = useCallback(() => {
    void (async () => {
      const rows = await reload();
      setEditing((prev) => (prev ? rows.find((r) => r.id === prev.id) ?? prev : prev));
    })();
    onChanged?.();
  }, [reload, onChanged]);

  /** 条目增删改 → 仅刷新台账（公司列「N 条目」计数），不触发账号表单刷新 */
  const handleCountsChanged = useCallback(() => {
    void reload();
  }, [reload]);

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
            <Landmark size={14} strokeWidth={1.9} className="text-[var(--accent)]" />
          </span>
          公司信息管理
        </span>
      }
      description="全部公司主数据与业绩 · 开标/监督/采购人信息维护（采购文件与公告编写自动带入）"
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
      {/* 指标行 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="公司数" value={rows.length} />
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
            <span className="text-sm font-semibold tracking-wide">公司台账</span>
          </div>
          <span className="text-xs text-[var(--muted-foreground)]">点「编辑」打开窗口维护该公司信息（与 leader 公司信息管理页同口径）；改名即时生效于新项目归属快照，历史快照不受影响</span>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[820px]">
            <thead>
              <tr className="text-left">
                <th>公司</th>
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
              {rows.map(r => (
                <tr key={r.id} className="row-clickable">
                  <td>
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-[var(--muted-foreground)]">
                      {r.code ?? "—"}
                      {r.shortName ? ` · ${r.shortName}` : ""}
                    </div>
                    {/* 条目计数（2026-10-12）：编辑窗口数据面可见性——0 条即未维护（编写页不预填） */}
                    <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                      采购人 {r.purchaserCount} · 地点 {r.placeCount} · 监督 {r.supervisionCount}
                    </div>
                  </td>
                  <td className="tabular-nums">{r.officeUsers}</td>
                  <td className="tabular-nums">{r.expertUsers}</td>
                  <td className="tabular-nums">{r.activeProjects}</td>
                  <td className="tabular-nums">{r.archivedCount}</td>
                  <td className="font-mono tabular-nums text-xs">{r.contractTotal ? `￥${r.contractTotal.toLocaleString("zh-CN")}` : "—"}</td>
                  <td className="font-mono text-xs text-[var(--muted-foreground)]">{new Date(r.createdAt).toLocaleDateString("zh-CN")}</td>
                  <td className="text-right">
                    <button onClick={() => setEditing(r)} className="neu-btn-xs">
                      <Pencil size={12} /> 编辑
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={8} className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无公司（供应商/用户注册建档时自动生成）</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="neu-table-card-footer">
          <span className="text-xs text-[var(--muted-foreground)]">
            统计口径：在编人员 = 管理/办公/开标主持账号，评审专家单列（专家库公司归属）；在办项目 = 项目管理进行中；已归档项目/合同额合计 = 采购台账已成交轮次（不含回收站与已终止）
          </span>
        </div>
      </section>

      {/* 编辑窗口（2026-10-12）：嵌套 Modal——ESC 只关顶层；基本信息保存联动台账+账号表单，条目操作仅联动台账计数 */}
      {editing && (
        <CompanyEditDialog
          company={editing}
          onClose={() => setEditing(null)}
          onChanged={handleEditChanged}
          onCountsChanged={handleCountsChanged}
        />
      )}
    </Modal>
  );
}
