"use client";

import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { useState } from "react";
import { requestPasswordChange } from "@/lib/api/auth";

type PasswordChangeRequestDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function PasswordChangeRequestDialog({
  isOpen,
  onClose,
}: PasswordChangeRequestDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const resetState = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
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

    if (!currentPassword) {
      setErrorMessage("请输入当前密码。");
      return;
    }

    if (!newPassword) {
      setErrorMessage("请输入新密码。");
      return;
    }

    if (!confirmPassword) {
      setErrorMessage("请再次输入新密码。");
      return;
    }

    if (newPassword.length < 6) {
      setErrorMessage("新密码至少需要 6 位。");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("两次输入的新密码不一致。");
      return;
    }

    setSubmitting(true);

    try {
      await requestPasswordChange({
        currentPassword,
        newPassword,
      });

      setSuccessMessage("申请已提交，等待管理员审批通过后，新密码才会生效。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "提交改密申请失败，请稍后重试。",
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
        className="password-dialog panel-surface chromatic-glass glass-calm relative w-full max-w-[560px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-change-dialog-title"
      >
        <div aria-hidden className="password-dialog__glow" />
        <button
          type="button"
          onClick={handleClose}
          className="password-dialog__close"
          aria-label="关闭修改密码弹窗"
        >
          <X size={18} />
        </button>

        <div className="password-dialog__header">
          <h2
            id="password-change-dialog-title"
            className="password-dialog__title font-[family-name:var(--font-display)]"
          >
            修改密码
          </h2>
          <div className="password-dialog__divider" />
        </div>

        <form className="password-dialog__form" onSubmit={handleSubmit} noValidate>
          <label className="password-dialog__field">
            <span className="password-dialog__label">
              当前密码
            </span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="请输入当前密码"
              className="password-dialog__input login-field-input"
              autoComplete="current-password"
            />
          </label>

          <label className="password-dialog__field">
            <span className="password-dialog__label">
              新密码
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="请输入不少于 6 位的新密码"
              className="password-dialog__input login-field-input"
              autoComplete="new-password"
            />
          </label>

          <label className="password-dialog__field">
            <span className="password-dialog__label">
              确认新密码
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="请再次输入新密码"
              className="password-dialog__input login-field-input"
              autoComplete="new-password"
            />
          </label>

          {errorMessage ? (
            <div
              className="password-dialog__status password-dialog__status--error"
              aria-live="polite"
            >
              <AlertCircle size={16} strokeWidth={1.9} className="mt-[1px] shrink-0" />
              {errorMessage}
            </div>
          ) : null}

          {successMessage ? (
            <div
              className="password-dialog__status password-dialog__status--success"
              aria-live="polite"
            >
              <CheckCircle2 size={16} strokeWidth={1.9} className="mt-[1px] shrink-0" />
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
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  提交中
                </>
              ) : (
                "提交审批"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
