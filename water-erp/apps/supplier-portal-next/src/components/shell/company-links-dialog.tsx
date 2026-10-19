"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Building2, X } from "lucide-react";
import { toast } from "sonner";
import { SpButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { supplierCompanyLinksApi, type CompanyLinkView } from "@/lib/api/supplier";

// 动态引入：UnitSearchSelect 自带 register2.css（组件本体收口），而 app-shell 处于 node:test
// 链上——静态引入会把 CSS 拉进 tsx 测试链（SyntaxError）。浮窗打开时才加载，测试链永不触及。
const UnitSearchSelect = dynamic(
  () => import("@/components/registration/unit-search-select").then((m) => m.UnitSearchSelect),
  { ssr: false },
);

const STATUS_LABEL: Record<CompanyLinkView["status"], string> = {
  PENDING: "审批中",
  APPROVED: "已在库",
  REJECTED: "未通过",
  DISABLED: "已停用",
};
const STAGE_LABEL: Record<string, string> = { STAFF: "初审", LEADER: "复审", ADMIN: "终审" };
/** 状态 → sp-status 色档（globals.css，与归属页/个人中心同语言） */
const STATUS_TONE: Record<CompanyLinkView["status"], string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DISABLED: "disabled",
};

/**
 * 公司归属管理浮窗（多公司归属 2026-10-16）——顶栏 Building2 按钮弹出。
 * 与 /profile/company-links 页共用同一 api 客户端与类型；申请走该公司三级审批，
 * 唯一通道=供应商自主申请。onPendingChange 回传「审批中」数供顶栏徽标同步。
 */
export function CompanyLinksDialog({
  open,
  onClose,
  onPendingChange,
}: {
  open: boolean;
  onClose: () => void;
  onPendingChange?: (pending: number) => void;
}) {
  const [links, setLinks] = useState<CompanyLinkView[]>([]);
  const [loading, setLoading] = useState(false);
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await supplierCompanyLinksApi.my();
      setLinks(rows);
      onPendingChange?.(rows.filter((l) => l.status === "PENDING").length);
    } catch {
      toast.error("归属列表加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [onPendingChange]);

  // 打开时拉取（关闭不清空列表——避免重开闪空）
  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function apply() {
    if (!company) {
      toast.warning("请选择要加入的公司");
      return;
    }
    setSubmitting(true);
    try {
      // 按名称选择（62 家名单）；DTO companyId/companyName 二选一——传名称，后端只读解析不建档
      await supplierCompanyLinksApi.apply({ companyName: company, note: note.trim() || undefined });
      toast.success("申请已提交，等待该公司初审/复审/终审三级审批");
      setCompany("");
      setNote("");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const primary = links.find((l) => l.isPrimary);
  const inLibrary = links.filter((l) => l.status === "APPROVED" && !l.isPrimary).length;

  return (
    <div
      className="clq-ov"
      role="dialog"
      aria-modal="true"
      aria-label="公司归属管理"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="clq-pn">
        <div className="clq-h">
          <div className="clq-hl">
            <div className="clq-hi">
              <Building2 size={20} strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="clq-t">公司归属管理</h2>
              <p className="clq-sub">
                {primary ? (
                  <>主归属 {primary.companyName}{inLibrary > 0 ? <> · 另在 {inLibrary} 家公司库</> : null}</>
                ) : (
                  "加入多家公司的供应商库，接收其采购邀请"
                )}
              </p>
            </div>
          </div>
          <button type="button" className="pwd-x" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="clq-b">
          {/* 申请加入公司 */}
          <section className="clq-sec">
            <h3 className="clq-sec-t">申请加入公司</h3>
            <div className="clq-field">
              <label htmlFor="clq-company">归属公司</label>
              <UnitSearchSelect value={company} onChange={setCompany} />
              <p className="clq-hint">须正确选择归属公司，否则将影响投标</p>
            </div>
            <div className="clq-field">
              <label htmlFor="clq-note">申请说明</label>
              <textarea
                id="clq-note"
                className="clq-note"
                placeholder="选填，如：希望参与贵司水务项目"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                rows={2}
              />
            </div>
            <div className="clq-actions">
              <SpButton variant="primary" onClick={() => void apply()} disabled={submitting || !company}>
                {submitting ? "提交中…" : "提交申请"}
              </SpButton>
            </div>
          </section>

          {/* 我的归属（行式紧凑列表） */}
          <section className="clq-sec">
            <h3 className="clq-sec-t">我的归属</h3>
            {loading ? (
              <p className="clq-empty">正在加载归属记录…</p>
            ) : links.length === 0 ? (
              <p className="clq-empty">尚无公司归属记录，通过上方「申请加入公司」加入</p>
            ) : (
              <ul className="clq-list">
                {links.map((l) => (
                  <li key={l.id} className="clq-row">
                    <div className="clq-row-main">
                      <span className="clq-row-name">{l.companyName}</span>
                      {l.isPrimary && <span className="clq-tag">主归属</span>}
                    </div>
                    <div className="clq-row-side">
                      <span className={cn("sp-status whitespace-nowrap", STATUS_TONE[l.status])}>
                        {STATUS_LABEL[l.status]}
                        {l.status === "PENDING" && l.reviewStage && STAGE_LABEL[l.reviewStage]
                          ? `（${STAGE_LABEL[l.reviewStage]}）`
                          : ""}
                      </span>
                    </div>
                    {l.status === "REJECTED" && l.rejectReason && (
                      <p className="clq-row-reason">
                        原因：{l.rejectReason}
                        <span className="clq-row-retry">重新申请：在上方选择该公司再次提交即可</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
