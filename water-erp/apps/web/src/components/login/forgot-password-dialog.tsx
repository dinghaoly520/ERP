"use client";

import { AlertCircle, CheckCircle2, LifeBuoy, X } from "lucide-react";
import { useState } from "react";
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

  if (!isOpen) {
    return null;
  }

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
    <div
      className="password-dialog-overlay fixed inset-0 z-[90] flex items-center justify-center px-4 py-6"
      role="presentation"
    >
      <div
        className="password-dialog panel-surface chromatic-glass glass-calm relative w-full max-w-[520px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-password-dialog-title"
      >
        <div aria-hidden className="password-dialog__glow" />
        <button
          type="button"
          onClick={handleClose}
          className="password-dialog__close"
          aria-label="关闭忘记密码弹窗"
        >
          <X size={18} />
        </button>

        <div className="password-dialog__header">
          <h2
            id="forgot-password-dialog-title"
            className="password-dialog__title font-[family-name:var(--font-display)]"
          >
            忘记密码
          </h2>
          <div className="password-dialog__divider" />
        </div>

        <form
          className="password-dialog__form"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="password-dialog__intro">
            <div className="password-dialog__intro-icon">
              <LifeBuoy size={17} strokeWidth={1.85} />
            </div>
            <div className="password-dialog__intro-copy">
              <div className="password-dialog__intro-title">
                提交密码重置申请
              </div>
              <p className="password-dialog__intro-description">
                请填写账号、申请人姓名和联系方式。管理员收到申请后会核验信息，并决定是否为该账号生成临时密码。
              </p>
            </div>
          </div>

          <label className="password-dialog__field">
            <span className="password-dialog__label">账号</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入需要重置的账号"
              className="password-dialog__input login-field-input"
              autoComplete="username"
            />
          </label>

          <label className="password-dialog__field">
            <span className="password-dialog__label">申请人姓名</span>
            <input
              type="text"
              value={applicantName}
              onChange={(event) => setApplicantName(event.target.value)}
              placeholder="请输入申请人姓名"
              className="password-dialog__input login-field-input"
              autoComplete="name"
            />
          </label>

          <label className="password-dialog__field">
            <span className="password-dialog__label">申请人联系方式</span>
            <input
              type="text"
              value={applicantContact}
              onChange={(event) => setApplicantContact(event.target.value)}
              placeholder="请输入手机号码或办公联系方式"
              className="password-dialog__input login-field-input"
              autoComplete="tel"
            />
          </label>

          {errorMessage ? (
            <div
              className="password-dialog__status password-dialog__status--error"
              aria-live="polite"
            >
              <AlertCircle
                size={16}
                strokeWidth={1.9}
                className="mt-[1px] shrink-0"
              />
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div
              className="password-dialog__status password-dialog__status--success"
              aria-live="polite"
            >
              <CheckCircle2
                size={16}
                strokeWidth={1.9}
                className="mt-[1px] shrink-0"
              />
              {successMessage}
            </div>
          ) : null}

          <div className="password-dialog__actions">
            <button
              type="button"
              onClick={handleClose}
              className="password-dialog__button password-dialog__button--secondary"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="password-dialog__button password-dialog__button--primary"
            >
              {submitting ? "提交中..." : "联系管理员"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
