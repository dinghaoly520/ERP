"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { UnitSearchSelect } from "@/components/registration/unit-search-select";
import { SpButton, SpDialog } from "@/components/ui";
import { supplierCompanyLinksApi, type CompanyLinkView } from "@/lib/api/supplier";

const STAGES: Array<{ key: string; label: string }> = [
  { key: "STAFF", label: "初审" },
  { key: "LEADER", label: "复审" },
  { key: "ADMIN", label: "终审" },
];

/**
 * 「申请加入公司」对话框（多公司归属 2026-10-16）——公司归属管理页标题栏右侧按钮弹出
 * （同「企业信息 · 申请资料变更」模式）。表单仅含归属公司选择 + 申请说明；
 * 提交后走该公司 STAFF/LEADER/ADMIN 三级审批。initialCompany 供「重新申请」预填。
 */
export function CompanyLinkApplyDialog({
  open,
  onClose,
  initialCompany,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  initialCompany?: string;
  onApplied?: () => void;
}) {
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置（initialCompany 有值则预填——重新申请场景）
  useEffect(() => {
    if (open) {
      setCompany(initialCompany ?? "");
      setNote("");
    }
  }, [open, initialCompany]);

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
      onClose();
      onApplied?.();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      icon={Building2}
      title="申请加入公司"
      subtitle="加入该公司的供应商库，接收其采购邀请"
      width={480}
      footer={
        <SpButton variant="primary" onClick={() => void apply()} disabled={submitting || !company}>
          {submitting ? "提交中…" : "提交申请"}
        </SpButton>
      }
    >
      <div className="clq-field">
        {/* 无 htmlFor：UnitSearchSelect 触发器自带 placeholder 作可达名（组件不收 id），悬空 for 反伤 a11y */}
        <label>归属公司</label>
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
    </SpDialog>
  );
}

/**
 * 「审核进度」对话框——展示进行中（三级进度）与未通过（原因 + 重新申请）的申请；
 * 已在库/已停用的归属不在本窗（页面正文展示）。
 */
export function CompanyLinkProgressDialog({
  open,
  onClose,
  links,
  onReapply,
}: {
  open: boolean;
  onClose: () => void;
  links: CompanyLinkView[];
  onReapply: (companyName: string) => void;
}) {
  const items = links.filter((l) => l.status === "PENDING" || l.status === "REJECTED");
  const currentIdx = (stage: string | null) => {
    const i = STAGES.findIndex((s) => s.key === stage);
    return i < 0 ? 0 : i;
  };

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      icon={Building2}
      title="审核进度"
      subtitle={items.length > 0 ? `${items.length} 条申请记录` : "暂无进行中的申请"}
      width={520}
    >
      {items.length === 0 ? (
        <p className="clq-empty">当前没有审批中或未通过的申请</p>
      ) : (
        <ul className="clq-list">
          {items.map((l) => (
            <li key={l.id} className="clq-row">
              <div className="clq-row-main">
                <span className="clq-row-name">{l.companyName}</span>
                {l.status === "REJECTED" ? (
                  <span className="sp-status whitespace-nowrap rejected">未通过</span>
                ) : (
                  <span className="sp-status whitespace-nowrap pending">审批中</span>
                )}
              </div>
              {l.status === "PENDING" ? (
                <div className="clq-steps" aria-label={`当前${STAGES[currentIdx(l.reviewStage)].label}`}>
                  {STAGES.map((s, i) => {
                    const cur = currentIdx(l.reviewStage);
                    const state = i < cur ? "done" : i === cur ? "current" : "todo";
                    return (
                      <span key={s.key} className="clq-step" data-state={state}>
                        {i > 0 && <span className="clq-step-line" data-done={i <= cur} aria-hidden="true" />}
                        <span className="clq-step-dot" aria-hidden="true" />
                        {s.label}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div className="clq-row-side">
                  {l.rejectReason && <span className="clq-row-reason">原因：{l.rejectReason}</span>}
                  <button type="button" className="clq-reapply" onClick={() => onReapply(l.companyName)}>
                    重新申请
                  </button>
                </div>
              )}
              {l.status === "PENDING" && l.note && (
                <p className="clq-row-note">说明：{l.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </SpDialog>
  );
}

/** 供页面按钮/统计复用的口径：审批中申请数 */
export function countPending(links: CompanyLinkView[]): number {
  return links.filter((l) => l.status === "PENDING").length;
}
