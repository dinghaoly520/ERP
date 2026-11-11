"use client";

import { useEffect, useState } from "react";
import { Building2, LogOut, Plus } from "lucide-react";
import { toast } from "sonner";
import { UnitSearchSelect } from "@/components/registration/unit-search-select";
import { SpButton, SpDialog, SpSelect } from "@/components/ui";
import { supplierCompanyLinksApi, type CompanyLinkView } from "@/lib/api/supplier";

const STAGES: Array<{ key: string; label: string }> = [
  { key: "STAFF", label: "初审" },
  { key: "LEADER", label: "复审" },
  { key: "ADMIN", label: "终审" },
];

/** 退库文字确认短语（表单闸：输入完全一致才可提交） */
const LEAVE_CONFIRM_PHRASE = "确认退库";

type ChangeMode = "join" | "leave";

/**
 * 「申请变更归属公司」对话框（2026-11-10 并轨加入/退库）——公司归属管理页标题栏右侧按钮弹出。
 * 双模式卡切换：申请加入（原 CompanyLinkApplyDialog 逻辑不变——公司选择 + 申请说明）/
 * 申请退库（选已在库公司 + 申请说明 + 输入「确认退库」文字确认）。
 * 两轨均走该公司 STAFF/LEADER/ADMIN 三级审批；initialCompany/initialLeaveCompanyId 供预填。
 */
export function CompanyLinkChangeDialog({
  open,
  onClose,
  links,
  initialMode = "join",
  initialCompany,
  initialLeaveCompanyId,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  /** 我的归属列表（退库公司选项来源；页面已加载，弹窗不重复拉取） */
  links: CompanyLinkView[];
  initialMode?: ChangeMode;
  /** 加入轨预填公司名（审核进度窗「重新申请」） */
  initialCompany?: string;
  /** 退库轨预填公司 id（归属卡「重新申请退库」） */
  initialLeaveCompanyId?: string;
  onApplied?: () => void;
}) {
  const [mode, setMode] = useState<ChangeMode>(initialMode);
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [leaveCompanyId, setLeaveCompanyId] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 每次打开重置（预填值随 open 注入——重新申请/重新申请退库场景）
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setCompany(initialCompany ?? "");
      setNote("");
      setLeaveCompanyId(initialLeaveCompanyId ?? "");
      setConfirmText("");
    }
  }, [open, initialMode, initialCompany, initialLeaveCompanyId]);

  // 退库选项 = 本人已在库归属（含主归属——退光全部归属由登录闸兜底）
  const leaveOptions = links.filter((l) => l.status === "APPROVED");
  const selectedLeave = leaveOptions.find((l) => l.companyId === leaveCompanyId);
  // 退最后一个归属公司 → 账号将无法登录（2026-11-10 用户裁定），提交前强提示
  const isLastCompany = !!selectedLeave && leaveOptions.length === 1;
  const confirmMatched = confirmText.trim() === LEAVE_CONFIRM_PHRASE;

  async function submit() {
    if (mode === "join") {
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
      return;
    }
    if (!leaveCompanyId) {
      toast.warning("请选择要退库的归属公司");
      return;
    }
    if (!confirmMatched) {
      toast.warning(`请输入「${LEAVE_CONFIRM_PHRASE}」以确认退库操作`);
      return;
    }
    setSubmitting(true);
    try {
      await supplierCompanyLinksApi.applyLeave({ companyId: leaveCompanyId, note: note.trim() || undefined });
      toast.success("退库申请已提交，等待该公司初审/复审/终审三级审批");
      onClose();
      onApplied?.();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const joinReady = !!company;
  const leaveReady = !!leaveCompanyId && confirmMatched;

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      icon={Building2}
      title="申请变更归属公司"
      subtitle="加入新公司的供应商库，或退出已在库的公司"
      width={480}
      footer={
        <SpButton
          variant="primary"
          danger={mode === "leave"}
          onClick={() => void submit()}
          disabled={submitting || (mode === "join" ? !joinReady : !leaveReady)}
        >
          {submitting ? "提交中…" : mode === "join" ? "提交申请" : "提交退库申请"}
        </SpButton>
      }
    >
      {/* 模式切换：两张可选卡（点击即切换，选中态内凹） */}
      <div className="clq-mode-row" role="group" aria-label="申请类型">
        <button type="button" className="clq-mode" data-active={mode === "join"} aria-pressed={mode === "join"} onClick={() => setMode("join")}>
          <span className="clq-mode-icon" aria-hidden="true"><Plus size={15} strokeWidth={1.9} /></span>
          <span>
            <span className="clq-mode-title">申请加入</span>
            <span className="clq-mode-desc">加入该公司的供应商库，接收其采购邀请</span>
          </span>
        </button>
        <button type="button" className="clq-mode is-danger" data-active={mode === "leave"} aria-pressed={mode === "leave"} onClick={() => setMode("leave")}>
          <span className="clq-mode-icon" aria-hidden="true"><LogOut size={15} strokeWidth={1.9} /></span>
          <span>
            <span className="clq-mode-title">申请退库</span>
            <span className="clq-mode-desc">退出某家已在库公司的供应商库</span>
          </span>
        </button>
      </div>

      {mode === "join" ? (
        <>
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
        </>
      ) : (
        <>
          <div className="clq-field">
            <label htmlFor="leave-company">退库公司</label>
            {leaveOptions.length === 0 ? (
              <p className="clq-empty">当前没有已在库的归属公司，无需退库</p>
            ) : (
              <SpSelect id="leave-company" value={leaveCompanyId} onChange={(e) => setLeaveCompanyId(e.target.value)}>
                <option value="">请选择要退库的归属公司</option>
                {leaveOptions.map((l) => (
                  <option key={l.companyId} value={l.companyId}>
                    {l.companyName}{l.isPrimary ? "（主归属）" : ""}
                  </option>
                ))}
              </SpSelect>
            )}
            {leaveOptions.length > 0 && <p className="clq-muted">提交后至该公司终审通过前，贵司将暂不能参与该公司的采购业务</p>}
          </div>
          <div className="clq-field">
            <label htmlFor="clq-note">申请说明</label>
            <textarea
              id="clq-note"
              className="clq-note"
              placeholder="选填，如：业务调整，不再参与贵司采购"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              rows={2}
            />
          </div>
          {leaveOptions.length > 0 && (
            <div className="clq-field">
              <label htmlFor="leave-confirm">确认操作</label>
              <input
                id="leave-confirm"
                className="clq-confirm"
                placeholder={`输入「${LEAVE_CONFIRM_PHRASE}」后才能提交`}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
              {isLastCompany && <p className="clq-warn">这是贵司最后一个归属公司：退库终审通过后，贵司账号将无法登录</p>}
            </div>
          )}
        </>
      )}
    </SpDialog>
  );
}

/**
 * 「审核进度」对话框——展示进行中（加入/退库三级进度）、未通过（原因 + 重新申请）
 * 与已退库（可重新申请加入）的记录；已在库/已停用的归属不在本窗（页面正文展示）。
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
  const items = links.filter((l) => l.status === "PENDING" || l.status === "LEAVE_PENDING" || l.status === "REJECTED" || l.status === "WITHDRAWN");
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
        <p className="clq-empty">当前没有审批中、未通过或已退库的申请</p>
      ) : (
        <ul className="clq-list">
          {items.map((l) => (
            <li key={l.id} className="clq-row">
              <div className="clq-row-main">
                <span className="clq-row-name">{l.companyName}</span>
                {(l.status === "LEAVE_PENDING" || l.status === "WITHDRAWN") && <span className="clq-tag">退库</span>}
                {l.status === "REJECTED" ? (
                  <span className="sp-status whitespace-nowrap rejected">未通过</span>
                ) : l.status === "WITHDRAWN" ? (
                  <span className="sp-status whitespace-nowrap disabled">已退库</span>
                ) : l.status === "LEAVE_PENDING" ? (
                  <span className="sp-status whitespace-nowrap pending">退库审批中</span>
                ) : (
                  <span className="sp-status whitespace-nowrap pending">审批中</span>
                )}
              </div>
              {l.status === "PENDING" || l.status === "LEAVE_PENDING" ? (
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
              {(l.status === "PENDING" || l.status === "LEAVE_PENDING") && l.note && (
                <p className="clq-row-note">说明：{l.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </SpDialog>
  );
}

/** 供页面按钮/统计复用的口径：审批中申请数（加入 + 退库） */
export function countPending(links: CompanyLinkView[]): number {
  return links.filter((l) => l.status === "PENDING" || l.status === "LEAVE_PENDING").length;
}
