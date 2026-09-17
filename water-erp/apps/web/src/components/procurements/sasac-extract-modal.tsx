"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen, Check, ChevronDown, ClipboardCheck, FileSpreadsheet, Loader2, Network, PencilLine,
} from "lucide-react";
import { Modal } from "@/components/workbench";
import { fetchSasacExtract, type SasacProjectRow, type SasacSupplierRow } from "@/lib/api/procurements";
import { SASAC_INDICATORS } from "@/lib/data/sasac-indicators";
import { PROCUREMENT_METHODS, PROCUREMENT_CATEGORY_OPTIONS } from "@/lib/types/project-management";
import { SASAC_UNITS } from "@/lib/data/sasac-units";
import * as XLSX from "xlsx-js-style";

/**
 * 国资监管九大领域业务数据指标库·采购领域提取（2026-09-16，表格版）。
 * 三分区 tab：采购项目（17+1 指标列）/ 供应商（7 指标列）/ 采购组织结构树（待确认，留空）。
 * 表格形态：行=记录、列=指标；双行表头（指标分组 + 指标名）；单元格内联编辑；
 * 空值=待补录（琥珀底提示）、修改过的单元格标品牌蓝。修改仅本次会话，不写回业务系统。
 */

type FieldType = "text" | "number" | "date";
interface FieldDef<T> {
  key: keyof T;
  label: string;
  type?: FieldType;
  unit?: string;
  width?: number;
  group: string;
}

const PROJECT_FIELDS: FieldDef<SasacProjectRow>[] = [
  { key: "name", label: "采购项目名称", group: "基础信息", width: 230 },
  { key: "purchaserName", label: "采购单位名称", group: "基础信息", width: 240 },
  { key: "purchaserCode", label: "统一身份代码", group: "基础信息", width: 190 },
  { key: "contact", label: "采购联系人", group: "基础信息", width: 110 },
  { key: "category", label: "采购类别", group: "基础信息", width: 160 },
  { key: "method", label: "采购方式", group: "基础信息", width: 140 },
  { key: "publishForm", label: "发布形式", group: "基础信息", width: 140 },
  { key: "budgetAmount", label: "采购预算金额", type: "number", unit: "元", group: "金额与日期", width: 130 },
  { key: "awardAmount", label: "中标（成交）金额", type: "number", unit: "元", group: "金额与日期", width: 130 },
  { key: "procurementDate", label: "采购日期", type: "date", group: "金额与日期", width: 130 },
  { key: "awardDate", label: "中标日期", type: "date", group: "金额与日期", width: 130 },
  { key: "centralized", label: "是否集中采购", group: "合规检查", width: 100 },
  { key: "salePeriodOk", label: "发售期是否满足", group: "合规检查", width: 110 },
  { key: "salePeriodNote", label: "发售期不满足详情", group: "合规检查", width: 140 },
  { key: "publicityPeriodOk", label: "公示期是否满足", group: "合规检查", width: 110 },
  { key: "publicityPeriodNote", label: "公示期不满足详情", group: "合规检查", width: 140 },
  { key: "wonSupplierName", label: "中标供应商名称", group: "成交供应商", width: 230 },
  { key: "wonSupplierCode", label: "中标供应商代码", group: "成交供应商", width: 170 },
  { key: "stage", label: "采购实施阶段", group: "过程信息", width: 320 },
];

const SUPPLIER_FIELDS: FieldDef<SasacSupplierRow>[] = [
  { key: "name", label: "供应商名", group: "基本信息", width: 200 },
  { key: "creditCode", label: "统一信用代码", group: "基本信息", width: 170 },
  { key: "mainBusiness", label: "主营业务", group: "基本信息", width: 340 },
  { key: "foundingDate", label: "成立日期", type: "date", group: "基本信息", width: 130 },
  { key: "industry", label: "所属行业", group: "基本信息", width: 300 },
  { key: "profile", label: "企业简介", group: "基本信息", width: 220 },
  { key: "registeredCapital", label: "注册资金", type: "number", unit: "万元", group: "基本信息", width: 200 },
];

/** 过程信息步骤色板：序号 1-8 各一色（oklch 色相环，超 8 循环）；文字编号/编码全量显示，禁止截断 */
const STEP_COLORS = [
  "oklch(0.55 0.14 247)", // 1 蓝
  "oklch(0.55 0.12 190)", // 2 青
  "oklch(0.55 0.14 164)", // 3 绿
  "oklch(0.62 0.13 75)",  // 4 琥珀
  "oklch(0.62 0.15 45)",  // 5 橙
  "oklch(0.58 0.15 25)",  // 6 赭红
  "oklch(0.55 0.14 290)", // 7 紫
  "oklch(0.5 0.1 265)",   // 8 靛
];

const GROUP_TINT: Record<string, string> = {
  基础信息: "oklch(0.63 0.128 247 / 0.07)",
  "金额与日期": "oklch(0.55 0.14 164 / 0.07)",
  合规检查: "oklch(0.72 0.13 75 / 0.08)",
  成交供应商: "oklch(0.55 0.14 280 / 0.06)",
  过程信息: "oklch(0.6 0.13 175 / 0.07)",
};

/** 可选指标选项集（2026-09-17）：方式/类别与项目管理统一口径（lib/types/project-management）；发布形式=公告/邀请 */
const METHOD_OPTIONS = [...PROCUREMENT_METHODS];
const CATEGORY_OPTIONS = PROCUREMENT_CATEGORY_OPTIONS;
const PUBLISH_FORM_OPTIONS = ["公告公示", "供应商邀请"];

/** 通用下拉单元格（支持搜索）：点击展开面板，首行搜索框实时过滤选项；
 *  选项少（≤8）时不显示搜索框。空值红底待补录；当前值不在选项中附加保留。 */
function SelectCell({
  value, options, onChange,
}: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const empty = !value;
  const keep = value && !options.includes(value) ? [value] : [];
  const filtered = [...keep, ...options].filter((o) => !q.trim() || o.toLowerCase().includes(q.trim().toLowerCase()));
  const showSearch = options.length > 8;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) { setOpen(false); setQ(""); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setQ(""); } };
    const away = () => { setOpen(false); setQ(""); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // 面板内部滚动不关闭（capture 捕获自身滚动曾致"无法滚动查看"）；仅外部滚动关闭
    const onScrollAway = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      away();
    };
    window.addEventListener("scroll", onScrollAway, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollAway, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const pick = (v: string) => { setOpen(false); setQ(""); onChange(v); };

  return (
    <div
      ref={anchorRef}
      className={`relative flex items-center justify-center rounded-[7px] px-1 py-1 transition-colors ${empty ? "bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]" : open ? "bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]"}`}
    >
      <button
        type="button"
        onClick={() => {
          if (!open) { const r = anchorRef.current?.getBoundingClientRect(); if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) }); }
          setOpen((o) => !o);
        }}
        className={`flex w-full items-center justify-center gap-1 truncate text-[11px] font-medium outline-none ${empty ? "font-bold text-[color:var(--danger)]" : "text-[color:var(--foreground)]"}`}
        aria-label="选择指标值"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{value || "待补录"}</span>
        <ChevronDown size={10} strokeWidth={2} className={`shrink-0 text-[color:var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="listbox"
          style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
          className="z-[700] max-h-[220px] overflow-y-auto rounded-[12px] bg-[var(--background)]/97 px-1 pb-1 shadow-[0_14px_36px_rgba(24,40,70,0.18),inset_0_1px_0_oklch(1_0_0/0.8)] backdrop-blur-md"
        >
          {showSearch && (
            <div className="sticky top-0 z-10 mb-1 rounded-t-[11px] bg-[var(--background)] px-1 pb-1 pt-1 shadow-[0_1px_0_oklch(0.6_0.04_258/0.14)]">
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`搜索 ${options.length} 项…`}
                className="neu-input w-full !h-8 !min-h-0 text-[11px]"
              />
            </div>
          )}
          {value ? (
            <button type="button" role="option" aria-selected onClick={() => pick(value)} className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-center text-[11px] font-semibold text-[var(--accent)] bg-white shadow-[inset_0_1px_0_oklch(1_0_0/0.95),1px_1px_3px_oklch(0.55_0.03_258/0.12)]">
              <span className="truncate">{value}</span>
              <Check size={11} strokeWidth={2.4} className="shrink-0" />
            </button>
          ) : (
            <div className="px-2 py-1 text-center text-[10px] font-bold text-[color:var(--danger)]">待补录</div>
          )}
          {filtered.filter((o) => o !== value).map((o) => (
            <button key={o} type="button" role="option" aria-selected={false} onClick={() => pick(o)} className="w-full truncate rounded-[8px] px-2 py-1.5 text-center text-[11px] text-[color:var(--foreground)] transition-colors hover:bg-white/60">
              {o}
            </button>
          ))}
          {filtered.length === 0 && <div className="px-2 py-2 text-center text-[10px] text-[color:var(--muted-foreground)]">无匹配项</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** 是/否 下拉单元格：空值红底待补录；选「是」绿调、「否」琥珀调轻提示 */
function YesNoCell({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const empty = value !== "是" && value !== "否";
  return (
    <div className={`relative flex items-center justify-center rounded-[7px] px-1 py-1 transition-colors ${empty ? "bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]"}`}>
      <select
        value={empty ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full min-w-0 bg-transparent text-center text-[11px] font-medium outline-none ${empty ? "text-[color:var(--danger)]" : value === "是" ? "text-[var(--success)]" : "text-[color:var(--warning)]"}`}
        aria-label="选择 是/否"
      >
        <option value="" disabled className="font-bold">待补录</option>
        <option value="是">是</option>
        <option value="否">否</option>
      </select>
    </div>
  );
}

/** 内联可编辑单元格：空值琥珀底「待补录」、改过蓝点标记 */
function Cell({
  value, type, dirty, onChange,
}: { value: string; type?: FieldType; dirty: boolean; onChange: (v: string) => void }) {
  const empty = value === "" || value === null || value === undefined;
  return (
    <div className={`relative flex items-center justify-center rounded-[7px] px-1.5 py-1 transition-colors ${empty ? "bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]" : "hover:bg-[color-mix(in_oklch,var(--accent)_5%,transparent)]"}`}>
      {dirty && <span className="absolute left-0.5 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" title="已修改" />}
      <input
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        value={value ?? ""}
        placeholder={empty ? "待补录" : ""}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full min-w-0 bg-transparent text-center text-[11px] outline-none placeholder:font-bold placeholder:text-[color-mix(in_oklch,var(--danger)_75%,transparent)] focus:text-[var(--accent)] ${dirty ? "font-semibold text-[var(--accent)]" : "text-[color:var(--foreground)]"}`}
      />
    </div>
  );
}

export function SasacExtractModal({ open, onClose, companyId }: { open: boolean; onClose: () => void; companyId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"projects" | "suppliers" | "org">("projects");
  const [projects, setProjects] = useState<SasacProjectRow[]>([]);
  const [suppliers, setSuppliers] = useState<SasacSupplierRow[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  // 分组带标签「屏幕居中」：横向滚动时实时钉在可视区中央（纯 CSS sticky 百分比相对表格宽，做不到）
  const scrollerRef = useRef<HTMLDivElement>(null);
  const centerBands = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const bands = el.querySelectorAll<HTMLElement>(".sasac-band");
    if (!bands.length) return;
    const half = el.clientWidth / 2;
    const max = el.scrollWidth;
    bands.forEach((b) => {
      const w = b.offsetWidth;
      // x 为表格坐标系（span 锚在表格左缘）：可视区中心 = scrollLeft + clientWidth/2，两端 clamp
      const x = Math.min(Math.max(el.scrollLeft + half, w / 2), Math.max(max - half, w / 2));
      b.style.transform = `translateX(${x}px) translateX(-50%)`;
    });
  }, []);
  useEffect(() => { centerBands(); }, [centerBands, tab, projects, suppliers, loading, open]);
  // 原生监听：用户滚动/程序化滚动/触摸板全覆盖（React 合成 onScroll 在部分程序化滚动下不触发）
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(centerBands);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [centerBands, tab, loading, open]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchSasacExtract(companyId);
      setProjects(r.projects ?? []);
      setSuppliers(r.suppliers ?? []);
      setDirtyIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "提取失败");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  const [companyNames, setCompanyNames] = useState<string[]>([]);
  useEffect(() => {
    setCompanyNames(SASAC_UNITS.map((u) => u.name)); // 集团全级次企业名单（62 家，含 18 位代码）
  }, []);

  const markDirty = (id: string) => setDirtyIds((prev) => new Set(prev).add(id));
  /** Excel 导出：三个 sheet（采购项目/采购供应商/采购组织结构树），取当前会话数据（含人工修改）。
   *  样式（xlsx-js-style）：全表居中+自动换行；表头加粗+淡蓝底；未填项红底深红字；阶段列逐行换行。
   */
  const exportExcel = () => {
    const CENTER = { alignment: { horizontal: "center", vertical: "center", wrapText: true } as const };
    const HEADER_S = { ...CENTER, font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: "FFDCE9F7" } } };
    const EMPTY_S = { ...CENTER, fill: { fgColor: { rgb: "FFFFC7CE" } }, font: { color: { rgb: "FF9C0006" } } };

    /** 给整表套样式：表头行加粗底色，数据行居中换行，空值红底 */
    const styleSheet = (ws: XLSX.WorkSheet, headerRows: number) => {
      const range = XLSX.utils.decode_range(ws["!ref"]!);
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject & { s?: Record<string, unknown> } | undefined;
          if (!cell) continue;
          if (r < headerRows) cell.s = HEADER_S;
          else {
            const v = cell.v;
            cell.s = v === "" || v === null || v === undefined ? { ...EMPTY_S } : { ...CENTER };
          }
        }
      }
      return ws;
    };

    const wb = XLSX.utils.book_new();
    // Sheet1 采购项目：首列分组 + 18 项指标；阶段列以换行符分隔逐行显示
    const stageText = (p: SasacProjectRow) =>
      (p.steps?.length ?? 0) > 0
        ? p.steps!.map((s) => `${s.order}.${s.name}${s.code ? `[${s.code}]` : ""}${s.completed ? "" : "…"}`).join("\n")
        : String(p.stage ?? "");
    const pHeader = ["分组", ...PROJECT_FIELDS.map((f) => f.label)];
    const pRows = [...projects.filter((p) => p.archived), ...projects.filter((p) => !p.archived)].map((p) => [
      p.archived ? "已归档" : "进行中",
      ...PROJECT_FIELDS.map((f) =>
        f.key === "stage" ? stageText(p) : p[f.key] === null || p[f.key] === undefined ? "" : String(p[f.key]),
      ),
    ]);
    const wsP = styleSheet(XLSX.utils.aoa_to_sheet([pHeader, ...pRows]), 1);
    wsP["!cols"] = [{ wch: 8 }, ...PROJECT_FIELDS.map((f) => ({ wch: Math.max(10, Math.round((f.width ?? 120) / 12)) }))];
    // 行高按内容行数估算（阶段列换行数为主）：lines × 14pt + 8pt 余量，至少 20pt
    const rowHeightOf = (cells: (string | number | null | undefined)[]) => {
      const lines = cells.reduce((max: number, v: string | number | null | undefined, i: number) => {
        const text = v === null || v === undefined ? "" : String(v);
        const colW = i === 0 ? 8 : Math.max(10, Math.round((PROJECT_FIELDS[i - 1]?.width ?? 120) / 12));
        const wrapped = text.split("\n").reduce((n: number, seg: string) => n + Math.max(1, Math.ceil(seg.length / Math.max(colW, 4))), 0);
        return Math.max(max, wrapped);
      }, 1);
      return Math.max(20, lines * 14 + 8);
    };
    wsP["!rows"] = [{ hpt: 22 }, ...pRows.map((r) => ({ hpt: rowHeightOf(r) }))];
    XLSX.utils.book_append_sheet(wb, wsP, "采购项目");
    // Sheet2 采购供应商：7 项指标
    const sHeader = SUPPLIER_FIELDS.map((f) => f.label);
    const sRows = suppliers.map((s) => SUPPLIER_FIELDS.map((f) => String(s[f.key] ?? "")));
    const wsS = styleSheet(XLSX.utils.aoa_to_sheet([sHeader, ...sRows]), 1);
    wsS["!cols"] = SUPPLIER_FIELDS.map((f) => ({ wch: Math.max(10, Math.round((f.width ?? 120) / 12)) }));
    const sRowHeight = (cells: string[]) => {
      const lines = cells.reduce((max: number, v: string, i: number) => {
        const colW = Math.max(10, Math.round((SUPPLIER_FIELDS[i]?.width ?? 120) / 12));
        return Math.max(max, Math.max(1, Math.ceil(String(v).length / Math.max(colW, 4))));
      }, 1);
      return Math.max(20, lines * 14 + 8);
    };
    wsS["!rows"] = [{ hpt: 22 }, ...sRows.map((r) => ({ hpt: sRowHeight(r) }))];
    XLSX.utils.book_append_sheet(wb, wsS, "采购供应商");
    // Sheet3 采购组织结构树：4 项指标（待接入，空表）
    const wsO = styleSheet(XLSX.utils.aoa_to_sheet([["单位统一社会信用代码", "采购单位ID", "上级单位ID", "所属集团ID"]]), 1);
    wsO["!cols"] = [{ wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsO, "采购组织结构树");
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(wb, `国资监管数据提取-采购领域-${day}.xlsx`);
  };

  const patchProject = (id: string, key: keyof SasacProjectRow, v: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, [key]: key.includes("Amount") && v !== "" ? Number(v) : v } as SasacProjectRow;
        // 采购单位名称联动：选名单内单位自动带出统一身份代码
        if (key === "purchaserName") {
          next.purchaserCode = SASAC_UNITS.find((u) => u.name === v)?.code ?? "";
        }
        return next;
      }),
    );
    markDirty(id);
  };
  const patchSupplier = (id: string, key: keyof SasacSupplierRow, v: string) => {
    setSuppliers((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: v } : s)));
    markDirty(id);
  };

  const defs = tab === "suppliers" ? SUPPLIER_FIELDS : PROJECT_FIELDS;
  const groupSpans = useMemo(() => {
    const g = new Map<string, number>();
    for (const f of defs) g.set(f.group, (g.get(f.group) ?? 0) + 1);
    return [...g.entries()];
  }, [defs]);

  const tabs: Array<{ key: typeof tab; label: string; count?: number }> = [
    { key: "projects", label: "采购项目", count: projects.length },
    { key: "suppliers", label: "供应商", count: suppliers.length },
    { key: "org", label: "采购组织结构树" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="4xl"
      title={
        <span className="flex items-center gap-2.5">
          <ClipboardCheck size={18} className="text-[var(--accent)]" />
          <span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">国资监管数据提取 · 采购领域</span>
        </span>
      }
      footer={
        <>
          <span className="mr-auto flex items-center gap-3">
            {dirtyIds.size > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]">
                <PencilLine size={11} /> 已修改 {dirtyIds.size} 条
              </span>
            )}
            <button type="button" onClick={() => setSheetOpen(true)} className="neu-btn-soft !h-8 gap-1.5 text-xs">
              <BookOpen size={13} strokeWidth={1.9} className="text-[var(--accent)]" />
              业务指标表
            </button>
          </span>
          <button type="button" onClick={() => void load()} disabled={loading} className="neu-btn-soft">
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            重新提取
          </button>
          <button type="button" onClick={onClose} className="neu-btn-primary">
            完成
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex min-h-[360px] items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" /> 正在提取系统数据…
        </div>
      ) : error ? (
        <div className="rounded-[16px] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-5 py-4 text-sm text-[var(--danger)]">{error}</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="neu-tab-bar">
              {tabs.map((t) => (
                <button key={t.key} type="button" className={`neu-tab ${tab === t.key ? "is-active" : ""}`} onClick={() => setTab(t.key)}>
                  {t.label}
                  {t.count !== undefined && <span className="neu-tab-count">{t.count}</span>}
                </button>
              ))}
            </div>
            <button type="button" onClick={exportExcel} className="neu-btn-primary !h-9 gap-1.5 text-xs">
              <FileSpreadsheet size={14} strokeWidth={1.9} />
              导出 Excel
            </button>
          </div>

          {tab === "org" ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[16px] bg-[color-mix(in_oklch,var(--muted-foreground)_4%,transparent)] py-14 text-center">
              <span className="neu-icon-well mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[16px] text-[color:var(--muted-foreground)]">
                <Network size={20} strokeWidth={1.6} />
              </span>
              <div className="text-sm font-medium text-[var(--foreground)]">采购组织结构树 · 待接入</div>
              <div className="mt-1 max-w-[360px] text-sm leading-6 text-[color:var(--muted-foreground)]">
                指标：单位统一社会信用代码 / 采购单位ID / 上级单位ID / 所属集团ID。写入逻辑确认后在此生成。
              </div>
            </div>
          ) : (
            <div className="neu-table-card">
              <div ref={scrollerRef} className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                <table className="neu-table w-full" style={{ minWidth: defs.reduce((s, f) => s + (f.width ?? 120), 0), borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    {/* 行1：指标分组——首组拆为冻结首格 + 余量空格，滚动时分组带从冻结区下方穿过而不重叠 */}
                    <tr>
                      {groupSpans.map(([g, span], gi) =>
                        gi === 0 ? (
                          <th
                            key={`${g}-pin`}
                            style={{ background: `linear-gradient(var(--st-group-bg), var(--st-group-bg)), var(--background)`, ["--st-group-bg" as string]: GROUP_TINT[g] ?? "transparent" } as React.CSSProperties}
                            className="sticky left-0 top-0 z-30 h-[30px] !text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)] shadow-[inset_-1px_0_0_oklch(0.65_0.03_250/0.18)]"
                          >
                            {g}
                          </th>
                        ) : null,
                      ).filter(Boolean)}
                      {groupSpans.map(([g, span], gi) =>
                        gi === 0 ? (
                          <th key={`${g}-rest`} colSpan={span - 1} style={{ background: `linear-gradient(${GROUP_TINT[g] ?? "transparent"}, ${GROUP_TINT[g] ?? "transparent"}), var(--background)` }} className="sticky top-0 z-20 h-[30px]" />
                        ) : (
                          <th
                            key={g}
                            colSpan={span}
                            style={{ background: `linear-gradient(${GROUP_TINT[g] ?? "transparent"}, ${GROUP_TINT[g] ?? "transparent"}), var(--background)` }}
                            className="sticky top-0 z-20 h-[30px] !text-center text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]"
                          >
                            {g}
                          </th>
                        ),
                      )}
                    </tr>
                    {/* 行2：指标名（含单位）——首列冻结不透明底，遮住滚动穿过的列 */}
                    <tr>
                      {defs.map((f, i) => (
                        <th
                          key={String(f.key)}
                          className={`${i === 0 ? "sticky left-0 top-[30px] z-30 bg-[var(--background)] shadow-[inset_-1px_0_0_oklch(0.65_0.03_250/0.18)]" : "sticky top-[30px] z-20 bg-[var(--background)]"} !text-center`}
                          style={{ width: f.width ?? 120 }}
                        >
                          <span className="block truncate">{f.label}</span>
                          {f.unit && <span className="block text-[9px] font-normal text-[color:var(--muted-foreground)]/70">（{f.unit}）</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tab === "projects" &&
                      (() => {
                        // 分组：已归档在前，进行中在后；带行分隔（依据 archived 标记而非 stage 文案）
                        const archived = projects.filter((p) => p.archived);
                        const ongoing = projects.filter((p) => !p.archived);
                        const band = (label: string, rows: SasacProjectRow[], tone: string, tint: string) => (
                          <Fragment key={label}>
                            <tr>
                              <td colSpan={PROJECT_FIELDS.length} className={`relative h-[26px] ${tint}`}>
                                <span
                                  className="sasac-band absolute left-0 whitespace-nowrap text-[10px] font-bold tracking-[0.08em]"
                                  style={{ top: 6, color: tone }}
                                >
                                  {label} · {rows.length} 项
                                </span>
                              </td>
                            </tr>
                            {rows.map((p) => (
                              <tr key={p.id}>
                                {PROJECT_FIELDS.map((f, i) => (
                                  <td key={String(f.key)} className={`${i === 0 ? "sticky left-0 z-10 bg-[color-mix(in_oklch,var(--background)_97%,transparent)] backdrop-blur-sm shadow-[inset_-1px_0_0_oklch(0.65_0.03_250/0.14)]" : ""}`}>
                                    {i === 0 ? (
                                      <div className="flex items-center justify-center gap-1.5">
                                        <span className={`whitespace-normal text-center leading-tight line-clamp-2 text-[11px] font-medium ${dirtyIds.has(p.id) ? "text-[var(--accent)]" : "text-[color:var(--foreground)]"}`} title={p.name}>{p.name || "（未命名）"}</span>
                                      </div>
                                    ) : f.key === "method" || f.key === "category" || f.key === "publishForm" || f.key === "purchaserName" ? (
                                      <SelectCell
                                        value={String(p[f.key] ?? "")}
                                        options={
                                          f.key === "method" ? METHOD_OPTIONS
                                          : f.key === "category" ? CATEGORY_OPTIONS
                                          : f.key === "publishForm" ? PUBLISH_FORM_OPTIONS
                                          : companyNames
                                        }
                                        onChange={(v) => patchProject(p.id, f.key, v)}
                                      />
                                    ) : ["centralized", "salePeriodOk", "publicityPeriodOk"].includes(String(f.key)) ? (
                                      <YesNoCell
                                        value={String(p[f.key] ?? "")}
                                        onChange={(v) => patchProject(p.id, f.key, v)}
                                      />
                                    ) : f.key === "stage" ? (
                                      (p.steps?.length ?? 0) > 0 ? (
                                        <div className="whitespace-normal px-1 text-center text-[10px] leading-relaxed">
                                          {p.steps!.map((s) => (
                                            <span
                                              key={s.order}
                                              className="mx-[1px] inline-block"
                                              style={{ color: STEP_COLORS[(s.order - 1) % STEP_COLORS.length], fontWeight: s.completed ? 600 : 400 }}
                                            >
                                              {`${s.order}.${s.name}${s.code ? `[${s.code}]` : ""}${s.completed ? "" : "…"}`}
                                            </span>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="whitespace-normal px-1 text-center text-[10px] leading-relaxed text-[color:var(--muted-foreground)]">
                                          {String(p.stage)}
                                        </div>
                                      )
                                    ) : (
                                      <Cell
                                        value={p[f.key] === null || p[f.key] === undefined ? "" : String(p[f.key])}
                                        type={f.type}
                                        dirty={false}
                                        onChange={(v) => patchProject(p.id, f.key, v)}
                                      />
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </Fragment>
                        );
                        return [
                          band("已归档", archived, "var(--success)", "bg-[color-mix(in_oklch,var(--success)_7%,transparent)]"),
                          band("进行中", ongoing, "var(--warning)", "bg-[color-mix(in_oklch,var(--warning)_7%,transparent)]"),
                        ];
                      })()}
                    {tab === "suppliers" &&
                      suppliers.map((s) => (
                        <tr key={s.id}>
                          {SUPPLIER_FIELDS.map((f, i) => (
                            <td key={String(f.key)} className={`${i === 0 ? "sticky left-0 z-10 bg-[color-mix(in_oklch,var(--background)_97%,transparent)] backdrop-blur-sm shadow-[inset_-1px_0_0_oklch(0.65_0.03_250/0.14)]" : ""}`}>
                              {i === 0 ? (
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className={`whitespace-normal text-center leading-tight line-clamp-2 text-[11px] font-medium ${dirtyIds.has(s.id) ? "text-[var(--accent)]" : "text-[color:var(--foreground)]"}`} title={s.name}>{s.name}</span>
                                  {s.isTemporary && <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--warning)]">临时</span>}
                                </div>
                              ) : f.key === "mainBusiness" || f.key === "profile" || f.key === "industry" ? (
                                <textarea
                                  value={String(s[f.key] ?? "")}
                                  onChange={(e) => patchSupplier(s.id, f.key, e.target.value)}
                                  rows={2}
                                  placeholder="待补录"
                                  className="w-full resize-none whitespace-pre-line bg-transparent text-center text-[11px] leading-snug outline-none placeholder:font-bold placeholder:text-[color-mix(in_oklch,var(--danger)_75%,transparent)] focus:text-[var(--accent)]"
                                  style={{ minHeight: 36 }}
                                />
                              ) : (
                                <Cell
                                  value={String(s[f.key] ?? "")}
                                  type={f.type}
                                  dirty={false}
                                  onChange={(v) => patchSupplier(s.id, f.key, v)}
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    {(tab === "projects" ? projects : suppliers).length === 0 && (
                      <tr><td colSpan={defs.length} className="py-12 text-center text-sm text-[color:var(--muted-foreground)]">暂无数据</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {sheetOpen && <IndicatorSheetModal onClose={() => setSheetOpen(false)} />}
    </Modal>
  );
}

/** 业务指标表查看器：《四川省国资监管九大领域业务数据指标库》采购领域 29 项指标原文 */
function IndicatorSheetModal({ onClose }: { onClose: () => void }) {
  const catalogs = [...new Set(SASAC_INDICATORS.map((i) => i.catalog))];
  const [cat, setCat] = useState(catalogs[0]);
  const rows = SASAC_INDICATORS.filter((i) => i.catalog === cat);
  return (
    <Modal
      open
      onClose={onClose}
      size="3xl"
      title={
        <span className="flex items-center gap-2.5">
          <BookOpen size={18} className="text-[var(--accent)]" />
          <span className="text-base font-semibold tracking-[-0.03em] text-[var(--foreground)]">业务指标表 · 采购领域</span>
        </span>
      }
      description="《四川省国资监管九大领域业务数据指标库》业务指标表原文（采购领域 29 项）"
      footer={<button type="button" onClick={onClose} className="neu-btn-primary">关闭</button>}
    >
      <div className="neu-tab-bar mb-3">
        {catalogs.map((c) => (
          <button key={c} type="button" className={`neu-tab ${cat === c ? "is-active" : ""}`} onClick={() => setCat(c)}>
            {c}
            <span className="neu-tab-count">{SASAC_INDICATORS.filter((i) => i.catalog === c).length}</span>
          </button>
        ))}
      </div>
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[900px]">
            <thead>
              <tr>
                <th style={{ width: 60 }}>序号</th>
                <th style={{ width: 80 }}>指标类型</th>
                <th style={{ width: 200 }}>指标名称</th>
                <th>指标说明</th>
                <th style={{ width: 70 }}>计算单位</th>
                <th style={{ width: 70 }}>必填</th>
                <th style={{ width: 110 }}>指标维度</th>
                <th style={{ width: 90 }}>数据类型</th>
                <th style={{ width: 90 }}>长度/精度</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${cat}-${i}`}>
                  <td className="tabular-nums text-[color:var(--muted-foreground)]">{i + 1}</td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.type === "指标项" ? "bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]" : "bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--accent)]"}`}>{r.type}</span>
                  </td>
                  <td className="font-medium text-[color:var(--foreground)]">{r.name}</td>
                  <td className="text-[color:var(--muted-foreground)]">{r.desc}</td>
                  <td className="text-[color:var(--muted-foreground)]">{r.unit ?? "—"}</td>
                  <td className="text-[color:var(--muted-foreground)]">{r.required}</td>
                  <td className="text-[color:var(--muted-foreground)]">{r.dimension ?? "—"}</td>
                  <td className="text-[color:var(--muted-foreground)]">{r.dataType}</td>
                  <td className="tabular-nums text-[color:var(--muted-foreground)]">{r.length ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
