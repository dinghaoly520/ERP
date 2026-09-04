"use client";

import { AlertCircle, CheckCircle2, LifeBuoy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/workbench";
import { requestPasswordReset, sendRegistrationCode } from "@/lib/api/auth";
import {
  normalizePasswordResetRequest,
  validatePasswordResetRequest,
} from "@/lib/password-reset";

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
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSending, setCodeSending] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const codeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetState = () => {
    setUsername("");
    setApplicantName("");
    setApplicantContact("");
    setNewPassword("");
    setConfirmPassword("");
    setVerificationCode("");
    setSubmitting(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    setCodeCooldown(0);
  };

  useEffect(() => {
    if (!isOpen) {
      if (codeTimerRef.current) {
        clearInterval(codeTimerRef.current);
        codeTimerRef.current = null;
      }
      setCodeCooldown(0);
    }
  }, [isOpen]);

  function startCooldown(seconds = 60) {
    if (codeTimerRef.current) {
      clearInterval(codeTimerRef.current);
      codeTimerRef.current = null;
    }
    setCodeCooldown(seconds);
    codeTimerRef.current = setInterval(() => {
      setCodeCooldown((prev) => {
        if (prev <= 1) {
          if (codeTimerRef.current) {
            clearInterval(codeTimerRef.current);
            codeTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const handleSendCode = async () => {
    const phone = applicantContact.trim();
    if (!/^1\d{10}$/.test(phone)) {
      setErrorMessage("请输入有效的手机号");
      return;
    }
    setErrorMessage(null);
    setCodeSending(true);
    try {
      await sendRegistrationCode(phone);
      setErrorMessage("验证码已发送，请查收");
      startCooldown();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "验证码发送失败");
    } finally {
      setCodeSending(false);
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const form = { username, applicantName, applicantContact, verificationCode, newPassword, confirmPassword };
    const validationError = validatePasswordResetRequest(form);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);

    try {
      await requestPasswordReset(normalizePasswordResetRequest(form));

      setSuccessMessage(
        "申请已提交。无论账号是否存在，平台都会按统一流程受理；审核通过后将按本次填写的新密码生效。",
      );
      setUsername("");
      setApplicantName("");
      setApplicantContact("");
      setVerificationCode("");
      setNewPassword("");
      setConfirmPassword("");
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
          {submitting ? "提交中..." : "提交申请"}
        </button>
      </>}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 text-[var(--accent)]"><LifeBuoy size={17} strokeWidth={1.85} /></div>
        <div>
          <div className="text-sm font-semibold text-[var(--foreground)]">提交密码重置申请</div>
          <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
            请填写身份核验信息和新密码。管理员审核通过后，新密码才会生效。
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
          <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">新密码</span>
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="至少 8 位，同时包含字母和数字"
            className="neu-input w-full text-sm"
            autoComplete="new-password"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">确认新密码</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="请再次输入新密码"
            className="neu-input w-full text-sm"
            autoComplete="new-password"
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
        <label className="block">
          <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">验证码</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              placeholder="6 位验证码"
              className="neu-input w-full text-sm"
              maxLength={6}
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={codeSending || codeCooldown > 0}
              className="neu-btn-soft shrink-0 text-xs disabled:opacity-50"
            >
              {codeSending ? "发送中..." : codeCooldown > 0 ? `${codeCooldown}s` : "获取验证码"}
            </button>
          </div>
        </label>

        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          如需人工核验身份，请先联系采购中心 <a className="underline" href="tel:02866666666">028-66666666</a>。
          页面会对手机号码进行短信验证码校验，提交申请后由采购管理人员审核并通过后生效。
        </p>

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
