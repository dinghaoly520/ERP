"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { toast } from "sonner";
import { Archive, Paperclip, Pencil, Plus, Trash2, TriangleAlert, X } from "lucide-react";
import { api, qs } from "@/lib/api";
import { uploadFile } from "@/lib/api/upload";
import { EmptyState, SpButton, SpDateInput, SpDialog, SpTextarea } from "@/components/ui";

/**
 * 供应商自有档案面板（:3004 我的合同 / 框架协议页）——供应商自己上传留存的资料：
 * 线下历史合同、自有履约证明、纸质协议扫描等，与平台流程生成的数据互补，仅本企业可见。
 * category: contract=合同类 | framework=框架协议类。
 */

export interface OwnArchive {
  id: string;
  category: string;
  title: string;
  refCode: string | null;
  counterparty: string | null;
  amount: string | null;
  signDate: string | null;
  startDate: string | null;
  endDate: string | null;
  scope: string | null;
  note: string | null;
  files: { name: string; url: string }[];
  createdAt: string;
}

interface FormState {
  title: string; refCode: string; counterparty: string; amount: string;
  signDate: string; startDate: string; endDate: string;
  scope: string; note: string; files: { name: string; url: string }[];
}

const EMPTY: FormState = { title: "", refCode: "", counterparty: "", amount: "", signDate: "", startDate: "", endDate: "", scope: "", note: "", files: [] };

export async function loadOwnArchiveRecords<T>(
  request: () => Promise<T[]>,
  onItems: (items: T[] | null) => void,
  onErrorChange: (hasError: boolean) => void,
): Promise<void> {
  onErrorChange(false);
  onItems(null);
  try {
    onItems(await request());
  } catch {
    onErrorChange(true);
  }
}

export function getOwnArchiveStats(
  items: ReadonlyArray<Pick<OwnArchive, "endDate">>,
  now: Dayjs = dayjs(),
): { total: number; active: number; expiring: number } {
  const today = now.startOf("day");
  const remainingDays = (endDate: string | null) => endDate
    ? dayjs(endDate).startOf("day").diff(today, "day")
    : null;

  return items.reduce(
    (stats, item) => {
      const remaining = remainingDays(item.endDate);
      if (remaining === null || remaining >= 0) stats.active += 1;
      if (remaining !== null && remaining >= 0 && remaining <= 90) stats.expiring += 1;
      return stats;
    },
    { total: items.length, active: 0, expiring: 0 },
  );
}

function expiryState(endDate: string | null): { label: string; cls: string } {
  if (!endDate) return { label: "长期/未登记到期", cls: "sp-status draft" };
  const days = dayjs(endDate).startOf("day").diff(dayjs().startOf("day"), "day");
  if (days < 0) return { label: `已到期 ${-days} 天`, cls: "sp-status disabled" };
  if (days <= 90) return { label: `剩余 ${days} 天`, cls: "sp-status pending" };
  return { label: `至 ${dayjs(endDate).format("YYYY-MM-DD")}`, cls: "sp-status approved" };
}

/** 多文件上传（附件 chips + 追加按钮） */
function FilesInput({ value, onChange, inputId, label = "上传附件" }: {
  value: { name: string; url: string }[];
  onChange: (v: { name: string; url: string }[]) => void;
  inputId: string;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast.warning("文件不能超过50MB"); return; }
    setBusy(true);
    try {
      const asset = await uploadFile(file, "general");
      onChange([...value, { name: asset.originalName || file.name, url: asset.url }]);
    } catch (err: any) {
      toast.error(err?.message || "上传失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="oa-files">
      {value.map((f, i) => (
        <span key={`${f.url}-${i}`} className="oa-file-chip">
          <Paperclip size={11} />
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="oa-file-link">{f.name}</a>
          <button type="button" className="oa-file-remove" aria-label={`移除附件 ${f.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <button type="button" className="oa-add-file" disabled={busy} onClick={() => ref.current?.click()}>
        <Plus size={11} />{busy ? "上传中…" : label}
      </button>
      <input ref={ref} id={inputId} type="file" hidden onChange={pick} />
    </div>
  );
}

export function OwnArchivesPanel({
  category,
  noun,
  embedded = false,
}: {
  category: "contract" | "framework";
  noun: string;
  embedded?: boolean;
}) {
  const [items, setItems] = useState<OwnArchive[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OwnArchive | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const fieldIds = {
    title: `${formId}-title`,
    refCode: `${formId}-ref-code`,
    counterparty: `${formId}-counterparty`,
    amount: `${formId}-amount`,
    signDate: `${formId}-sign-date`,
    startDate: `${formId}-start-date`,
    endDate: `${formId}-end-date`,
    scope: `${formId}-scope`,
    note: `${formId}-note`,
    files: `${formId}-files`,
  };

  const load = useCallback(
    () => loadOwnArchiveRecords(
      () => api.get<OwnArchive[]>(`/supplier-portal/own-archives${qs({ category })}`),
      setItems,
      setLoadError,
    ),
    [category],
  );

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }
  function openEdit(row: OwnArchive) {
    setEditing(row);
    setForm({
      title: row.title, refCode: row.refCode || "", counterparty: row.counterparty || "", amount: row.amount || "",
      signDate: row.signDate ? dayjs(row.signDate).format("YYYY-MM-DD") : "",
      startDate: row.startDate ? dayjs(row.startDate).format("YYYY-MM-DD") : "",
      endDate: row.endDate ? dayjs(row.endDate).format("YYYY-MM-DD") : "",
      scope: row.scope || "", note: row.note || "", files: Array.isArray(row.files) ? row.files : [],
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.title.trim()) { toast.warning("请填写名称"); return; }
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/supplier-portal/own-archives/${editing.id}`, form);
        toast.success("档案已更新");
      } else {
        await api.post("/supplier-portal/own-archives", { ...form, category });
        toast.success("档案已保存");
      }
      setDialogOpen(false);
      await load();
    } catch { /* 全局 toast */ } finally {
      setBusy(false);
    }
  }

  async function remove(row: OwnArchive) {
    if (!window.confirm(`确定删除「${row.title}」吗？已上传的附件仍保留在文件库。`)) return;
    try {
      await api.delete(`/supplier-portal/own-archives/${row.id}`);
      toast.success("已删除");
      await load();
    } catch { /* 全局 toast */ }
  }

  const stats = getOwnArchiveStats(items ?? []);

  const set = (k: keyof FormState, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className={embedded ? "oa-panel oa-panel-embedded" : "sp-module oa-panel"}>
      <div className="sp-module-header">
        <span className="prof-block-icon oa-panel-icon"><Archive size={16} strokeWidth={1.75} /></span>
        <h2 className="sp-module-title">我的{noun}档案留存</h2>
        <span className="sp-module-title oa-panel-count" aria-live="polite">
          {loadError
            ? "读取失败"
            : items === null
              ? "数据加载中"
              : `共 ${stats.total} 条 · 有效 ${stats.active}${stats.expiring > 0 ? ` · 90天内到期 ${stats.expiring}` : ""}`}
        </span>
        <SpButton icon={Plus} onClick={openCreate}>上传{noun}</SpButton>
      </div>
      <p className="oa-panel-hint">此处为您自行上传留存的{noun}资料（线下历史{noun}、自有证明文件等），仅本企业可见，用于记录与追溯。</p>

      {loadError ? (
        <EmptyState
          icon={TriangleAlert}
          title={`${noun}档案加载失败`}
          desc="网络或服务异常，当前无法读取企业自存档案。"
          role="alert"
        >
          <SpButton onClick={() => { void load(); }}>重新加载</SpButton>
        </EmptyState>
      ) : items === null ? (
        <div className="py-8 text-center text-sm text-[var(--fg-2)]">加载中…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Archive}
          title={`暂无自建${noun}档案`}
          desc={`点击「上传${noun}」登记您的${noun}并留存相关文件`}
        />
      ) : (
        <div className="oa-list">
          {items.map((row) => {
            const exp = expiryState(row.endDate);
            return (
              <div key={row.id} className="oa-card">
                <div className="oa-card-main">
                  <div className="oa-card-head">
                    <span className="oa-card-title">{row.title}</span>
                    <span className={exp.cls}>{exp.label}</span>
                  </div>
                  <div className="oa-card-meta">
                    {row.refCode && <span>编号 <b>{row.refCode}</b></span>}
                    {row.counterparty && <span>{row.counterparty}</span>}
                    {row.amount && <span>金额 <b>{row.amount}</b></span>}
                    {row.signDate && <span>签订 {dayjs(row.signDate).format("YYYY-MM-DD")}</span>}
                    {row.startDate && <span>起 {dayjs(row.startDate).format("YYYY-MM-DD")}</span>}
                    {row.endDate && <span>止 {dayjs(row.endDate).format("YYYY-MM-DD")}</span>}
                  </div>
                  {row.scope && <p className="oa-card-scope">{row.scope}</p>}
                  {row.note && <p className="oa-card-note">{row.note}</p>}
                  {Array.isArray(row.files) && row.files.length > 0 && (
                    <div className="oa-files">
                      {row.files.map((f, i) => (
                        <a key={i} className="oa-file-chip" href={f.url} target="_blank" rel="noopener noreferrer">
                          <Paperclip size={11} /><span>{f.name}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="oa-card-acts">
                  <SpButton variant="xs" icon={Pencil} onClick={() => openEdit(row)}>编辑</SpButton>
                  <SpButton variant="xs" danger icon={Trash2} onClick={() => remove(row)}>删除</SpButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SpDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? `编辑${noun}档案` : `上传${noun}档案`}
        subtitle="登记信息并留存扫描件/证明文件，仅本企业可见"
        icon={Archive}
        width={640}
        footer={
          <>
            <SpButton onClick={() => setDialogOpen(false)}>取消</SpButton>
            <SpButton variant="primary" loading={busy} onClick={save}>{busy ? "保存中…" : "保存"}</SpButton>
          </>
        }
      >
        <div className="oa-form">
          <div className="oa-form-grid">
            <div className="reg-item">
              <label className="reg-label" htmlFor={fieldIds.title}>{noun}名称 <i style={{ color: "var(--danger)", fontStyle: "normal" }}>*</i></label>
              <input id={fieldIds.title} className="reg-inp" required value={form.title} placeholder={`如：XX项目${noun}`} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="reg-item">
              <label className="reg-label" htmlFor={fieldIds.refCode}>{noun}编号</label>
              <input id={fieldIds.refCode} className="reg-inp" value={form.refCode} placeholder="合同/协议编号" onChange={(e) => set("refCode", e.target.value)} />
            </div>
            <div className="reg-item">
              <label className="reg-label" htmlFor={fieldIds.counterparty}>采购人/对方单位</label>
              <input id={fieldIds.counterparty} className="reg-inp" value={form.counterparty} placeholder="如：四川水发集团" onChange={(e) => set("counterparty", e.target.value)} />
            </div>
            <div className="reg-item">
              <label className="reg-label" htmlFor={fieldIds.amount}>金额</label>
              <input id={fieldIds.amount} className="reg-inp" value={form.amount} placeholder="如：86 万元" onChange={(e) => set("amount", e.target.value)} />
            </div>
            <div className="reg-item">
              <label className="reg-label" htmlFor={fieldIds.signDate}>签订日期</label>
              <SpDateInput id={fieldIds.signDate} value={form.signDate} onChange={(e) => set("signDate", e.target.value)} />
            </div>
            <div className="reg-item">
              <label className="reg-label" htmlFor={fieldIds.startDate}>{category === "framework" ? "生效日期" : "履约开始日期"}</label>
              <SpDateInput id={fieldIds.startDate} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div className="reg-item">
              <label className="reg-label" htmlFor={fieldIds.endDate}>{category === "framework" ? "有效期止（到期提醒）" : "履约截止（到期提醒）"}</label>
              <SpDateInput id={fieldIds.endDate} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </div>
          </div>
          <div className="reg-item">
            <label className="reg-label" htmlFor={fieldIds.scope}>{category === "framework" ? "入围范围/标的简述" : "标的/工作内容简述"}</label>
            <input id={fieldIds.scope} className="reg-inp" value={form.scope} placeholder="选填" onChange={(e) => set("scope", e.target.value)} />
          </div>
          <div className="reg-item">
            <label className="reg-label" htmlFor={fieldIds.note}>备注</label>
            <SpTextarea id={fieldIds.note} rows={2} value={form.note} placeholder="选填" onChange={(e) => set("note", e.target.value)} />
          </div>
          <div className="reg-item">
            <label className="reg-label" htmlFor={fieldIds.files}>附件材料（{noun}扫描件/履约证明等，可多份）</label>
            <FilesInput inputId={fieldIds.files} value={form.files} onChange={(v) => set("files", v)} label={`上传${noun}文件`} />
          </div>
        </div>
      </SpDialog>
    </div>
  );
}
