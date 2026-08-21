"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import dayjs from "dayjs";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CloudUpload,
  FileText,
  Folder,
  Lock,
  Medal,
  MoreHorizontal,
  Paperclip,
  Stamp,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { supplierApi } from "@/lib/api/supplier";
import { uploadFile, type FileAssetResponse } from "@/lib/api/upload";
import { cn } from "@/lib/utils";
import "@/styles/pages/profile.css";

/* ═══ 资质类型与配色（与 CompanyInfo.vue 一致）═══ */
export const QUAL_TYPES = [
  "营业执照",
  "资质证书",
  "安全生产许可证",
  "质量管理体系认证",
  "环境管理体系认证",
  "职业健康安全管理体系认证",
  "其他",
];

export type QualTypeMeta = { token: string; value: string; icon: LucideIcon };
const QUAL_TYPE_TOKENS: Record<string, QualTypeMeta> = {
  营业执照: { token: "var(--brand)", value: "oklch(0.5 0.16 258)", icon: Stamp },
  资质证书: { token: "var(--brand-deep)", value: "oklch(0.42 0.16 258)", icon: Medal },
  安全生产许可证: { token: "var(--warning)", value: "oklch(0.72 0.15 72)", icon: Lock },
  质量管理体系认证: { token: "var(--success)", value: "oklch(0.64 0.15 152)", icon: CircleCheck },
  环境管理体系认证: { token: "var(--water)", value: "oklch(0.5 0.12 175)", icon: Sun },
  职业健康安全管理体系认证: { token: "var(--danger)", value: "oklch(0.62 0.21 27)", icon: UserRound },
};
export function qualTypeMeta(t: string): QualTypeMeta {
  return QUAL_TYPE_TOKENS[t] || { token: "var(--muted-foreground)", value: "oklch(0.6 0.02 258)", icon: MoreHorizontal };
}

/* ═══ 状态 / 有效期 / 文件名辅助 ═══ */
export function qualStatusInfo(q: any): { label: string; cls: string } {
  if (!q.validTo) return { label: "长期有效", cls: "approved" };
  const diff = (new Date(q.validTo).getTime() - Date.now()) / 86400000;
  if (diff < 0) return { label: "已过期", cls: "rejected" };
  if (diff < 30) return { label: "即将过期", cls: "pending" };
  return { label: "有效", cls: "approved" };
}

export function qualExpiryPct(q: any): number {
  if (!q.validFrom || !q.validTo) return 100;
  const total = new Date(q.validTo).getTime() - new Date(q.validFrom).getTime();
  const remaining = new Date(q.validTo).getTime() - Date.now();
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}

export function qualExtractFileName(url: string): string {
  if (!url) return "";
  const m = url.match(/\/([^/]+\.\w{2,5})$/i);
  if (m) return m[1];
  return "附件文件";
}

export function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/* ═══ 证照健康度（qHealth / qTone / qRingDash）═══ */
export function qualHealthSummary(quals: any[]) {
  let valid = 0, expiring = 0, expired = 0, longTerm = 0;
  const now = Date.now();
  quals.forEach((q) => {
    if (!q.validTo) { longTerm++; return; }
    const diff = (new Date(q.validTo).getTime() - now) / 86400000;
    if (diff < 0) expired++;
    else if (diff < 30) expiring++;
    else valid++;
  });
  const score = quals.length > 0 ? Math.round(((valid + longTerm) / quals.length) * 100) : 0;
  return { total: quals.length, valid, expiring, expired, longTerm, healthScore: score };
}

export function qualHealthTone(quals: any[]) {
  const s = qualHealthSummary(quals);
  if (s.expired > 0) return { color: "var(--danger)", label: "有证照过期，请尽快更新" };
  if (s.expiring > 0) return { color: "var(--warning)", label: "有证照即将过期" };
  return { color: "var(--success)", label: "所有证照状态良好" };
}

export function qualRingDash(quals: any[]): string {
  const r = 2 * Math.PI * 34;
  const d = (r * qualHealthSummary(quals).healthScore) / 100;
  return `${d} ${r - d}`;
}

/* ═══ 资质与证照 Tab（CompanyInfo 内联版 — 健康面板 + 卡片 + 空态）═══ */
export function QualsTab({ qualifications, onDelete }: {
  qualifications: any[];
  onDelete: (id: string) => void;
}) {
  const qHealth = qualHealthSummary(qualifications);
  const qTone = qualHealthTone(qualifications);

  return (
    <>
      {qHealth.total > 0 && (
        <div className="qual-health-dashboard">
          <div className="qual-health-ring">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="var(--hairline)" strokeWidth="6" />
              <circle
                cx="40" cy="40" r="34" fill="none"
                stroke={qTone.color} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={qualRingDash(qualifications)}
                transform="rotate(-90 40 40)"
                className="qual-health-ring-arc"
              />
            </svg>
            <span className="qual-health-score">{qHealth.healthScore}%</span>
          </div>
          <div className="qual-health-body">
            <div className="qual-health-chips">
              <span className="qual-health-chip valid"><span className="chip-dot" /> {qHealth.valid} 有效</span>
              <span className="qual-health-chip long-term"><span className="chip-dot" /> {qHealth.longTerm} 长期</span>
              <span className="qual-health-chip expiring"><span className="chip-dot" /> {qHealth.expiring} 即将过期</span>
              <span className="qual-health-chip expired"><span className="chip-dot" /> {qHealth.expired} 已过期</span>
            </div>
            <div className="qual-health-message" style={{ "--c": qTone.color } as React.CSSProperties}>
              <span>{qTone.label}</span>
            </div>
          </div>
        </div>
      )}
      {qualifications.length > 0 ? (
        <div className="qual-grid">
          {qualifications.map((q) => {
            const meta = qualTypeMeta(q.type);
            const TypeIcon = meta.icon;
            return (
              <article key={q.id} className="qual-card">
                <div className="qual-card-head">
                  <div className="qual-card-head-left" style={{ "--c": meta.value } as React.CSSProperties}>
                    <span className="qual-type-dot"><TypeIcon size={12} /></span>
                    <span className="qual-type-label">{q.type}</span>
                  </div>
                  <div className="qual-card-head-right">
                    <span className={cn("qual-status-badge", qualStatusInfo(q).cls)}>{qualStatusInfo(q).label}</span>
                    <button type="button" className="neu-btn-xs qual-delete-btn" onClick={() => onDelete(q.id)} title="删除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3 className="qual-name">{q.name}</h3>
                {q.validFrom ? (
                  <div className="qual-timeline">
                    <div className="qual-timeline-bar">
                      <div
                        className="qual-timeline-fill"
                        style={{
                          width: q.validTo ? `${qualExpiryPct(q)}%` : "100%",
                          "--c": meta.value,
                          opacity: 0.35 + (qualExpiryPct(q) / 100) * 0.65,
                        } as React.CSSProperties}
                      />
                    </div>
                    <div className="qual-timeline-labels">
                      <span className="qual-timeline-date">{dayjs(q.validFrom).format("YYYY-MM-DD")}</span>
                      {q.validTo
                        ? <span className="qual-timeline-date">{dayjs(q.validTo).format("YYYY-MM-DD")}</span>
                        : <span className="qual-timeline-date qual-timeline-date--inf">长期</span>}
                    </div>
                  </div>
                ) : (
                  <div className="qual-timeline qual-timeline--longterm"><span className="qual-timeline-label">长期有效</span></div>
                )}
                {q.fileUrl ? (
                  <div className="qual-file-row" onClick={() => window.open(q.fileUrl, "_blank", "noopener")}>
                    <span className="qual-file-icon"><FileText size={16} /></span>
                    <span className="qual-file-name">{qualExtractFileName(q.fileUrl)}</span>
                    <span className="qual-file-cta">查看</span>
                  </div>
                ) : (
                  <div className="qual-file-row qual-file-row--empty">
                    <span className="qual-file-icon qual-file-icon--muted"><FileText size={14} /></span>
                    <span className="qual-file-name qual-file-name--muted">暂未上传附件</span>
                  </div>
                )}
                {/* 附加材料（注册 2.0：attachments [{name,url}]） */}
                {Array.isArray(q.attachments) && q.attachments.length > 0 && (
                  <div className="qual-attach">
                    <span className="qual-attach-label">附加材料</span>
                    {q.attachments.map((a: { name?: string; url?: string }, i: number) => (
                      a.url ? (
                        <a
                          key={`att-${i}`}
                          className="qual-attach-link"
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Paperclip size={13} />
                          <span>{a.name || `附件${i + 1}`}</span>
                        </a>
                      ) : null
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="qual-empty">
          <div className="sp-empty-icon"><Folder size={22} strokeWidth={1.75} /></div>
          <p className="qual-empty-title">暂无资质材料</p>
          <p className="qual-empty-desc">点击上方「添加资质」按钮，上传企业资质证照</p>
        </div>
      )}
    </>
  );
}

/* ═══ 添加资质弹窗（add-panel — Teleport 等价）═══
   挂载即重置表单（对应 Vue 打开前 qualForm 置空）；dirty 时关闭需确认（createDialogLeaveGuard 等价）。 */
export function QualAddPanel({ onAdded, onClose }: {
  onAdded: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ type: "", name: "", fileUrl: "", validFrom: "", validTo: "" });
  const [uploadedMeta, setUploadedMeta] = useState<FileAssetResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const markDirty = () => setDirty(true);

  const closePanel = () => {
    if (dirty && !window.confirm("当前有未保存的修改，关闭后会丢失。确定关闭吗？")) return;
    onClose();
  };

  const qCustomUpload = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      toast.error("文件不能超过50MB");
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const res = await uploadFile(file, "qualification", (p) => setProgress(p));
      setForm((f) => ({ ...f, fileUrl: res.url }));
      setUploadedMeta(res);
      toast.success("文件上传成功");
      markDirty();
    } catch {
      /* 失败提示已由 upload 层统一弹出 */
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const qHandleAdd = async () => {
    if (!form.type || !form.name) { toast.warning("请填写资质类型和名称"); return; }
    if (!uploadedMeta || !form.fileUrl) { toast.warning("请先上传资质文件"); return; }
    setLoading(true);
    try {
      await supplierApi.addQualification(form);
      toast.success("资质添加成功");
      onAdded();
    } catch {
      /* 错误提示已由 API 层统一弹出 */
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="add-overlay" onClick={(e) => { if (e.target === e.currentTarget) closePanel(); }}>
      <div className="add-panel">
        <div className="add-panel-head">
          <div className="add-panel-head-left">
            <div className="add-panel-head-icon"><Medal size={20} /></div>
            <div>
              <h2 className="add-panel-title">添加资质材料</h2>
              <p className="add-panel-sub">上传证照文件并填写有效期信息</p>
            </div>
          </div>
          <button type="button" className="add-panel-close" onClick={closePanel}><X size={18} /></button>
        </div>
        <div className="add-panel-body">
          <div className="add-panel-sec">
            <div className="add-panel-sec-label"><span className="add-panel-sec-dot" />基本信息</div>
            <div className="add-panel-row">
              <div className="add-panel-field">
                <label className="add-panel-label">资质类型 <i>*</i></label>
                <select
                  className="add-panel-select"
                  value={form.type}
                  onChange={(e) => { setForm((f) => ({ ...f, type: e.target.value })); markDirty(); }}
                >
                  <option value="" disabled>请选择资质类型</option>
                  {QUAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="add-panel-select-arrow"><ChevronDown size={12} /></span>
              </div>
              <div className="add-panel-field">
                <label className="add-panel-label">资质名称 <i>*</i></label>
                <div className="add-panel-input-wrap">
                  <input
                    className="add-panel-input"
                    value={form.name}
                    onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); markDirty(); }}
                    placeholder="如：企业法人营业执照"
                    maxLength={50}
                  />
                  {form.name && <span className="add-panel-count">{form.name.length}/50</span>}
                </div>
              </div>
            </div>
          </div>
          <div className="add-panel-sec">
            <div className="add-panel-sec-label"><span className="add-panel-sec-dot" />有效期</div>
            <div className="add-panel-row">
              <div className="add-panel-field">
                <label className="add-panel-label add-panel-label--opt">有效期起</label>
                <input
                  className="add-panel-input" type="date"
                  value={form.validFrom}
                  onChange={(e) => { setForm((f) => ({ ...f, validFrom: e.target.value })); markDirty(); }}
                />
              </div>
              <div className="add-panel-field">
                <label className="add-panel-label add-panel-label--opt">有效期止</label>
                <input
                  className="add-panel-input" type="date"
                  value={form.validTo}
                  onChange={(e) => { setForm((f) => ({ ...f, validTo: e.target.value })); markDirty(); }}
                  placeholder="不填为长期有效"
                />
              </div>
            </div>
          </div>
          <div className="add-panel-sec">
            <div className="add-panel-sec-label"><span className="add-panel-sec-dot" />资质文件 <i>*</i></div>
            <div className={cn("add-panel-upload", uploadedMeta && "is-done", uploading && "is-uploading")}>
              {!uploadedMeta ? (
                <div className="add-panel-upload-drop">
                  <span className="add-panel-upload-drop-icon"><CloudUpload size={28} /></span>
                  <p className="add-panel-upload-drop-text">拖拽文件到此处，或点击下方按钮</p>
                  <p className="add-panel-upload-drop-hint">支持 PDF、图片、Office、ZIP 格式，不超过 50 MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sp-file-hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void qCustomUpload(f);
                    }}
                  />
                  <button type="button" className="add-panel-upload-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    <CloudUpload size={14} />
                    <span>{uploading ? "上传中…" : "选择文件"}</span>
                  </button>
                </div>
              ) : (
                <div className="add-panel-upload-file">
                  <span className="add-panel-upload-file-icon"><FileText size={18} /></span>
                  <div className="add-panel-upload-file-info">
                    <span className="add-panel-upload-file-name">{uploadedMeta.originalName}</span>
                    <span className="add-panel-upload-file-meta">{formatSize(uploadedMeta.size)}</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sp-file-hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.zip,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void qCustomUpload(f);
                    }}
                  />
                  <button type="button" className="add-panel-upload-replace" onClick={() => fileInputRef.current?.click()}>替换文件</button>
                </div>
              )}
              {progress !== null && (
                <div className="add-panel-upload-progress">
                  <div className="add-panel-upload-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="add-panel-foot">
          {!uploadedMeta ? <span className="add-panel-hint">请上传资质文件</span> : <span className="add-panel-hint ready">已准备好提交</span>}
          <div className="add-panel-foot-actions">
            <button type="button" className="add-panel-btn-cancel" onClick={closePanel}>取消</button>
            <button
              type="button"
              className={cn("add-panel-btn-submit", uploadedMeta && !loading && "ready")}
              disabled={!uploadedMeta || loading}
              onClick={() => void qHandleAdd()}
            >
              {loading ? <span>提交中…</span> : <><ArrowRight size={15} /><span>确认添加</span></>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══ 变更申请弹窗内的资质小卡片（qc-* — CompanyInfo crp 弹窗「资质与证照」tab）═══ */
export function QualCompactCard({ q, onDelete, onQualAttach }: {
  q: any;
  onDelete: (id: string) => void;
  /** 「添加附件」file input 的 onChange（Vue onQualAttach — 提示后续版本支持） */
  onQualAttach?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const meta = qualTypeMeta(q.type);
  const TypeIcon = meta.icon;
  return (
    <article className="qc">
      <div className="qc-h">
        <div className="qc-hl" style={{ "--c": meta.value } as React.CSSProperties}>
          <span className="qc-d"><TypeIcon size={12} /></span>
          <span className="qc-t">{q.type}</span>
        </div>
        <div className="qc-hr">
          <span className={cn("qc-st", qualStatusInfo(q).cls)}>{qualStatusInfo(q).label}</span>
          <button type="button" className="neu-btn-xs qc-del" onClick={() => onDelete(q.id)} title="删除">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <h3 className="qc-nm">{q.name}</h3>
      {q.validFrom ? (
        <div className="qc-tl">
          <div className="qc-tb">
            <div
              className="qc-tf"
              style={{ width: q.validTo ? `${qualExpiryPct(q)}%` : "100%", "--c": meta.value } as React.CSSProperties}
            />
          </div>
          <div className="qc-td">
            <span>{dayjs(q.validFrom).format("YYYY-MM-DD")}</span>
            {q.validTo ? <span>{dayjs(q.validTo).format("YYYY-MM-DD")}</span> : <span>长期</span>}
          </div>
        </div>
      ) : (
        <div className="qc-tl qc-tl--lt">长期有效</div>
      )}
      {q.fileUrl && (
        <div className="qc-fr" onClick={() => window.open(q.fileUrl, "_blank", "noopener")}>
          <span className="qc-fi"><FileText size={16} /></span>
          <span className="qc-fn">{qualExtractFileName(q.fileUrl)}</span>
          <span className="qc-fa">查看</span>
        </div>
      )}
      {Array.isArray(q.attachments) && q.attachments.length > 0 && (
        <div className="qual-attach qc-attach">
          <span className="qual-attach-label">附加材料</span>
          {q.attachments.map((a: { name?: string; url?: string }, i: number) => (
            a.url ? (
              <a
                key={`qcatt-${i}`}
                className="qual-attach-link"
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Paperclip size={12} />
                <span>{a.name || `附件${i + 1}`}</span>
              </a>
            ) : null
          ))}
        </div>
      )}
      {onQualAttach && (
        <label className="neu-btn-xs qc-atch">
          <input type="file" hidden onChange={onQualAttach} />添加附件
        </label>
      )}
    </article>
  );
}
