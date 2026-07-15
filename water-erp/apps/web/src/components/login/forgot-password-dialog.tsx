"use client";

import { AlertCircle, CheckCircle2, LifeBuoy } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/workbench";
import { requestPasswordReset } from "@/lib/api/auth";

type ForgotPasswordDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function ForgotPasswordDialog({
  isOpen,
  onClose,
}: ForgotPasswordDialogProps) {
  const [username, setUsername] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [applicantContact, setApplicantContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetState = () => {
    setUsername("");
    setApplicantName("");
    setApplicantContact("");
    setSubmitting(false);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!username.trim()) {
      setErrorMessage("请输入需要重置的账号。");
      return;
    }

    if (!applicantName.trim()) {
      setErrorMessage("请输入申请人姓名。");
      return;
    }

    if (!applicantContact.trim()) {
      setErrorMessage("请输入申请人联系方式。");
      return;
    }

    setSubmitting(true);

    try {
      await requestPasswordReset({
        username: username.trim(),
        applicantName: applicantName.trim(),
        applicantContact: applicantContact.trim(),
      });

      setSuccessMessage(
        "申请已提交，管理员收到后会核验信息，并决定是否为该账号生成临时密码。",
      );
      setUsername("");
      setApplicantName("");
      setApplicantContact("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "提交重置申请失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={isOpen} onClose={handleClose} title="忘记密码" size="md"
      footer={<>
        <button type="button" onClick={handleClose} className="neu-btn-soft">取消</button>
        <button type="submit" form="forgot-password-form" disabled={submitting} className="neu-btn-primary">
          {submitting ? "提交中..." : "联系管理员"}
        </button>
      </>}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-[var(--accent)]"><LifeBuoy size={17} strokeWidth={1.85} /></div>
        <div>
          <div className="text-sm font-semibold text-[var(--foreground)]">提交密码重置申请</div>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
            请填写账号、申请人姓名和联系方式。管理员收到申请后会核验信息，并决定是否为该账号生成临时密码。
          </p>
        </div>
      </div>

      <form id="forgot-password-form" onSubmit={handleSubmit} noValidate className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">账号</span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="请输入需要重置的账号"
            className="neu-input w-full text-sm"
            autoComplete="username"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">申请人姓名</span>
          <input
            type="text"
            value={applicantName}
            onChange={(event) => setApplicantName(event.target.value)}
            placeholder="请输入申请人姓名"
            className="neu-input w-full text-sm"
            autoComplete="name"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">申请人联系方式</span>
          <input
            type="text"
            value={applicantContact}
            onChange={(event) => setApplicantContact(event.target.value)}
            placeholder="请输入手机号码或办公联系方式"
            className="neu-input w-full text-sm"
            autoComplete="tel"
          />
        </label>

        {errorMessage ? (
          <div className="flex items-start gap-2 text-sm text-[var(--danger)]" aria-live="polite">
            <AlertCircle size={16} strokeWidth={1.9} className="mt-[1px] shrink-0" />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {successMessage ? (
          <div className="flex items-start gap-2 text-sm text-[var(--success)]" aria-live="polite">
            <CheckCircle2 size={16} strokeWidth={1.9} className="mt-[1px] shrink-0" />
            <span>{successMessage}</span>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
