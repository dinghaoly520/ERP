"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock3, Download, FileArchive, History, ShieldCheck, Upload } from "lucide-react";
import { Modal } from "@/components/workbench";
import { apiFetch } from "@/lib/api/api-fetch";

/* ═══════════════════════════════════════════════════════════════
   归档卷弹窗（DA/T 103-2024）——自 /archive 独立页迁入采购台账卡片。
   数据全部按 pmiId 直取（范围勾稽/四性检测/补传登记/审计）；
   导出/划定期限后端 assertItemScope 限 PMI 属主与 admin，canManage
   由台账侧按同口径算好传入。条件挂载即卸载即复位（state 全内聚）。
   ═══════════════════════════════════════════════════════════════ */

export type ArchiveVolumeTarget = {
  pmiId: string;
  title: string;
  projectCode: string | null;
  retentionPeriod: "PERMANENT" | "Y30" | "Y10" | null;
  archiveExportedAt: string | null;
  archiveRegistrationKey: string | null;
};

type SnapshotRow = {
  code: string; stage: string; materialName: string; sourceType: string;
  isRequired: boolean; status: "MATCHED" | "MISSING" | "PENDING_GENERATED";
  attachmentIds: string[]; fileAssetIds: string[]; blocking: boolean;
};

type CheckResult = {
  overall: "PASSED" | "FAILED"; passedCount: number; failedCount: number;
  ranAt: string;
  details?: Array<{ code: string; materialName: string; check: string; status: string; message: string }>;
};

type AuditRow = {
  createdAt: string; username: string | null; method: string; path: string;
  statusCode: number; error: string | null;
};

const RETENTION_LABEL: Record<string, string> = { PERMANENT: "永久", Y30: "30 年", Y10: "10 年" };
const SOURCE_LABEL: Record<string, string> = {
  attachment: "系统附件", fileAsset: "回流件", manual: "人工补传", generated: "系统生成",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/archive${path}`, {
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

export function ArchiveVolumeModal({
  target, canManage, onClose, onExported, onRetentionSaved,
}: {
  target: ArchiveVolumeTarget;
  /** admin 或 PMI 属主（后端 assertItemScope 同口径）——门控 划定期限/导出 按钮 */
  canManage: boolean;
  onClose: () => void;
  /** 导出成功 → 台账 loadData() 刷「ASIP 已导出」徽标 */
  onExported?: () => void;
  /** 划定期限成功 → 台账 loadData() 刷 DTO 字段 */
  onRetentionSaved?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<SnapshotRow[] | null>(null); // null=加载中
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastDownload, setToastDownload] = useState<string | null>(null); // 导出成功 → toast 内联下载链接
  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null);
  const [registrationKey, setRegistrationKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 本地镜像：导出/划期限成功即时更新；target（loadData 后新 props）变化时重同步
  const [localRetention, setLocalRetention] = useState(target.retentionPeriod);
  const [localExportedAt, setLocalExportedAt] = useState(target.archiveExportedAt);
  useEffect(() => {
    setLocalRetention(target.retentionPeriod);
    setLocalExportedAt(target.archiveExportedAt);
  }, [target.pmiId, target.retentionPeriod, target.archiveExportedAt]);

  // 划定期限子弹窗三态（自原 /archive 页 :212-214 迁入）
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionValue, setRetentionValue] = useState<"PERMANENT" | "Y30" | "Y10">("Y30");
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [reExportConfirm, setReExportConfirm] = useState(false); // 重导出覆盖旧包前的确认

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => { setToast(null); setToastDownload(null); }, 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // 挂载即拉（弹窗先开、内部 loading）；audit 懒加载失败不阻塞（原 openInspect 同款）
  const load = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    try {
      const snap = await api<{ rows: SnapshotRow[] }>(`/items/${target.pmiId}/snapshot`);
      const latest = await api<CheckResult | null>(`/items/${target.pmiId}/check-latest`);
      setSnapshot(snap.rows);
      setCheck(latest ?? null);
      api<AuditRow[]>(`/items/${target.pmiId}/audit`).then(setAuditRows).catch(() => setAuditRows(null));
      setRegistrationKey(target.archiveRegistrationKey ?? null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "归档卷加载失败");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.pmiId]);
  useEffect(() => { void load(); }, [load]);

  // D3 补传（multipart）：headers 只带 X-Portal，绝不能带 Content-Type（boundary 由浏览器生成）
  async function uploadRegistration(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch(`/api/archive/items/${target.pmiId}/registration-scan`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Portal": "web" },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "上传失败");
      setRegistrationKey(body.objectKey);
      setToast("登记表扫描件已回传（纸电关联闭环）");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    setBusy(true);
    try {
      const result = await api<CheckResult>(`/items/${target.pmiId}/check`, { method: "POST" });
      setCheck(result);
      setToast(`检测完成：${result.overall === "PASSED" ? "全部通过" : `${result.failedCount} 项不合格`}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "检测失败");
    } finally {
      setBusy(false);
    }
  }

  // M2：不硬编码期限——已划定的保留原值（后端无参即不更新），未划定的默认 Y30
  async function exportAsip() {
    setBusy(true);
    try {
      const body = localRetention ? {} : { retentionPeriod: "Y30" as const };
      const r = await api<{ fileCount: number; zipSha256: string }>(`/items/${target.pmiId}/export-asip`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setLocalExportedAt(new Date().toISOString());
      setToast(`归档信息包已导出（${r.fileCount} 件，指纹 ${r.zipSha256.slice(0, 12)}…）`);
      setToastDownload(`/api/archive/items/${target.pmiId}/package`);
      onExported?.();
      void load(); // 重拉快照/检测/审计
    } catch (e) {
      setToast(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    window.open(`/api/archive/items/${target.pmiId}/package`, "_blank");
  }

  // 划定保管期限（§9.3 永久/30年/10年）
  async function saveRetention() {
    setRetentionSaving(true);
    try {
      await api<{ id: string; retentionPeriod: string }>(`/items/${target.pmiId}/retention`, {
        method: "PATCH",
        body: JSON.stringify({ retentionPeriod: retentionValue }),
      });
      setLocalRetention(retentionValue);
      setToast(`已划定保管期限：${RETENTION_LABEL[retentionValue]}`);
      setRetentionOpen(false);
      onRetentionSaved?.();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "保存失败");
    } finally {
      setRetentionSaving(false);
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]"><ShieldCheck size={14} strokeWidth={1.9} className="text-[var(--accent)]" /></span>
            归档卷（DA/T 103-2024）
          </span>
        }
        description={
          <span>
            <span className="font-semibold text-[color:var(--foreground)]">{target.title}</span>
            {" "}· <span className="font-mono">{target.projectCode ?? "—"}</span>
            {" "}· 保管期限 {localRetention ? RETENTION_LABEL[localRetention] : "未划定"}
            {localExportedAt && (
              <span className="ml-1 font-semibold text-[var(--success)]">已导出 {new Date(localExportedAt).toLocaleDateString()}</span>
            )}
            {check && (
              <span className={`ml-2 font-semibold ${check.overall === "PASSED" ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                最近检测：{check.overall === "PASSED" ? "通过" : `${check.failedCount} 项不合格`}（{new Date(check.ranAt).toLocaleString("zh-CN", { hour12: false })}）
              </span>
            )}
          </span>
        }
        size="2xl"
        className="!max-w-[980px]"
        footer={
          <>
            {canManage && !localRetention && (
              <button type="button" className="neu-btn-soft !h-9 !text-xs" disabled={busy} onClick={() => { setRetentionValue("Y30"); setRetentionOpen(true); }}>
                <Clock3 size={13} /> 划定期限
              </button>
            )}
            {/* 状态驱动主按钮：未导出=封卷；已导出=取件为主、重新封卷降级为次要动作 */}
            {canManage && !localExportedAt && (
              <button type="button" className="neu-btn-soft !h-9 !text-xs is-success" disabled={busy} onClick={() => void exportAsip()}>
                <FileArchive size={13} /> 导出 ASIP
              </button>
            )}
            {localExportedAt && (
              <>
                <button type="button" className="neu-btn-soft !h-9 !text-xs is-success" onClick={download}><Download size={13} /> 下载归档包</button>
                {canManage && (
                  <button
                    type="button"
                    className="neu-btn-soft !h-9 !text-xs"
                    disabled={busy}
                    onClick={() => setReExportConfirm(true)}
                    title="重新封卷将覆盖旧包：整包指纹与导出时间更新，旧指纹失效"
                  >
                    <FileArchive size={13} /> 重新导出 ASIP
                  </button>
                )}
              </>
            )}
            <button type="button" className="neu-btn-soft !h-9 !text-xs" disabled={busy} onClick={() => void runCheck()}><ShieldCheck size={13} strokeWidth={1.9} /> 运行检测</button>
            <button type="button" className="neu-btn-soft !h-9 !text-xs" onClick={onClose}>关闭</button>
          </>
        }
      >
        {loadError ? (
          <div className="py-10 text-center text-sm text-[var(--danger)]">{loadError}</div>
        ) : snapshot === null ? (
          <div className="flex items-center justify-center py-10 text-sm text-[color:var(--muted-foreground)]">归档卷加载中…</div>
        ) : (
          <div>
            <table className="neu-table w-full min-w-[720px]">
              <thead>
                <tr><th style={{ width: 60 }}>序号</th><th style={{ width: 70 }}>阶段</th><th>归档材料</th><th style={{ width: 80 }}>来源</th><th style={{ width: 90 }}>状态</th><th>命中</th></tr>
              </thead>
              <tbody>
                {snapshot.map((s) => (
                  <tr key={s.code}>
                    <td className="tabular-nums text-[0.75rem]">{s.code}</td>
                    <td className="text-[0.75rem]">{s.stage}</td>
                    <td className="text-[0.82rem] font-semibold">
                      {s.materialName}
                      {s.isRequired && <span className="ml-1.5 text-[10px] font-bold text-[var(--danger)]">必选</span>}
                    </td>
                    <td className="text-[0.75rem] text-[var(--muted-foreground)]">{SOURCE_LABEL[s.sourceType] ?? s.sourceType}</td>
                    <td>
                      <span className={`text-[0.72rem] font-semibold ${
                        s.status === "MATCHED" ? "text-[var(--success)]"
                        : s.status === "PENDING_GENERATED" ? "text-[var(--muted-foreground)]"
                        : s.blocking ? "text-[var(--danger)]" : "text-[var(--warning)]"}`}>
                        {s.status === "MATCHED" ? "✓ 已归集" : s.status === "PENDING_GENERATED" ? "导出时生成" : s.blocking ? "✗ 缺件（阻断）" : "缺件（提示）"}
                      </span>
                    </td>
                    <td className="text-[0.72rem] tabular-nums text-[var(--muted-foreground)]">
                      {s.attachmentIds.length + s.fileAssetIds.length > 0 ? `${s.attachmentIds.length + s.fileAssetIds.length} 件` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {check?.details && check.details.some((d) => d.status === "FAIL") && (
              <>
                <hr className="wb-section-rule my-4" />
                <p className="mb-2 text-xs font-bold text-[var(--danger)]">不合格明细</p>
                <ul className="space-y-1">
                  {check.details.filter((d) => d.status === "FAIL").map((d, i) => (
                    <li key={i} className="text-xs text-[var(--foreground)]">
                      <span className="font-semibold">[{d.check}]</span> {d.materialName} — {d.message}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* D3 纸电关联：登记表回传（A.1h） */}
            <hr className="wb-section-rule my-4" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-[var(--foreground)]">移交接收登记表（纸电关联）</p>
                <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                  {registrationKey
                    ? "✓ 已回传签章扫描件，与归档信息包同卷互链"
                    : "导出 ASIP 后打印「其他/移交接收登记表」→ 双方签章 → 扫描回传此处"}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileInputRef} type="file" hidden
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadRegistration(f);
                    e.target.value = "";
                  }}
                />
                <button className="neu-btn-xs" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  <Upload size={13} /> {registrationKey ? "重新上传" : "上传扫描件"}
                </button>
                {registrationKey && (
                  <a className="neu-btn-xs" href={`/api/archive/items/${target.pmiId}/registration`} target="_blank" rel="noreferrer">
                    <Download size={13} />
                  </a>
                )}
              </div>
            </div>

            {/* S2 归档审计（A.1g） */}
            {auditRows && auditRows.length > 0 && (
              <>
                <hr className="wb-section-rule my-4" />
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
                  <History size={13} /> 归档操作审计（最近 {auditRows.length} 条）
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {auditRows.map((a, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span className="tabular-nums">{new Date(a.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
                      <span className="font-semibold text-[var(--foreground)]">{a.username ?? "—"}</span>
                      <span className="font-mono">{a.method} {a.path.replace(`/api/archive/items/${target.pmiId}`, "…")}</span>
                      <span className={a.statusCode >= 400 ? "font-bold text-[var(--danger)]" : "text-[var(--success)]"}>{a.statusCode}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 划定保管期限子弹窗（§9.3；自原页 :350-382 迁入） */}
      {retentionOpen && (
        <Modal
          open
          onClose={() => setRetentionOpen(false)}
          title="划定保管期限"
          description={<>项目：<strong className="text-[var(--foreground)]">{target.title}</strong>（{target.projectCode ?? "—"}）</>}
          footer={
            <>
              <button onClick={() => setRetentionOpen(false)} className="neu-btn-soft">取消</button>
              <button onClick={() => void saveRetention()} disabled={retentionSaving} className="neu-btn-soft is-success">
                {retentionSaving ? "保存中..." : "确认划定"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--muted-foreground)]">依据 DA/T 103-2024 §9.3 划定；划定后导出归档信息包将保留原值，不再默认 Y30。</p>
            <div className="flex gap-2">
              {(["PERMANENT", "Y30", "Y10"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRetentionValue(v)}
                  className={retentionValue === v ? "neu-btn-xs is-info" : "neu-btn-xs"}
                >
                  {RETENTION_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* 重新导出确认：覆盖旧包（整包指纹与导出时间更新）——防误触靠确认而非隐藏 */}
      {reExportConfirm && (
        <Modal
          open
          onClose={() => setReExportConfirm(false)}
          title="重新导出归档信息包"
          description={<>项目：<strong className="text-[var(--foreground)]">{target.title}</strong>（{target.projectCode ?? "—"}）</>}
          footer={
            <>
              <button onClick={() => setReExportConfirm(false)} className="neu-btn-soft">取消</button>
              <button
                onClick={() => { setReExportConfirm(false); void exportAsip(); }}
                className="neu-btn-soft is-success"
              >
                确认重导
              </button>
            </>
          }
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <p className="text-sm leading-relaxed text-[color:var(--foreground)]">
              将覆盖当前归档信息包：整包指纹与导出时间更新，已下发的旧包指纹将失效。材料无变化时请直接「下载归档包」。
            </p>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-[var(--foreground)] px-4 py-2.5 text-sm text-[var(--background)] shadow-[2px_3px_8px_oklch(0.45_0.05_258/0.25),-1px_-1px_3px_oklch(1_0_0/0.15)]">
          {toast}
          {toastDownload && toast.includes('归档信息包已导出') && (
            <a href={toastDownload} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-semibold underline underline-offset-2">
              <Download size={12} /> 立即下载
            </a>
          )}
        </div>
      )}
    </>
  );
}
