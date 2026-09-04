"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { CheckCircle2, LifeBuoy, TriangleAlert } from "lucide-react";
import { authApi } from "@/lib/api/auth";
import {
  normalizePasswordResetRequest,
  validatePasswordResetRequest,
  type PasswordResetRequestInput,
} from "@/lib/password-reset";
import { SpButton, SpDialog, SpInput } from "@/components/ui";

interface PasswordResetRequestDialogProps {
  open: boolean;
  onClose: () => void;
  initialUsername?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const EMPTY_FORM: PasswordResetRequestInput = {
  username: "",
  applicantName: "",
  applicantContact: "",
  verificationCode: "",
  newPassword: "",
  confirmPassword: "",
};

export function PasswordResetRequestDialog({ open, onClose, initialUsername = "", returnFocusRef }: PasswordResetRequestDialogProps) {
  const [form, setForm] = useState<PasswordResetRequestInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const timerRef = useRef<number | NodeJS.Timeout | null>(null);

  const applicantContact = form.applicantContact.trim();
  const isSendCodeDisabled = sendingCode || codeCooldown > 0;
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, username: initialUsername });
      setSubmitting(false);
      setError(null);
      setSubmitted(false);
      setSendingCode(false);
      setCodeCooldown(0);
    }

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, initialUsername]);

  function startCooldown(seconds = 60) {
    setCodeCooldown(seconds);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = window.setInterval(() => {
      setCodeCooldown((remaining) => {
        if (remaining <= 1) {
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return remaining - 1;
      });
    }, 1000);
  }

  async function sendCode() {
    if (isSendCodeDisabled) return;
    if (!/^1\d{10}$/.test(applicantContact)) {
      setError("请先输入 11 位正确的手机号码");
      return;
    }

    setError(null);
    setSendingCode(true);
    try {
      await authApi.sendRegistrationCode(applicantContact);
      setError("验证码已发送到该手机号，请查收");
      startCooldown();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证码发送失败，请稍后重试");
    } finally {
      setSendingCode(false);
    }
  }

  function update(field: keyof PasswordResetRequestInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validatePasswordResetRequest(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(normalizePasswordResetRequest(form));
      setSubmitted(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "申请提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      title="忘记密码"
      subtitle="提交身份核验与新密码，管理员审核通过后生效"
      icon={LifeBuoy}
      returnFocusRef={returnFocusRef}
      footer={(
        <>
          <SpButton onClick={onClose}>{submitted ? "关闭" : "取消"}</SpButton>
          {!submitted && (
            <SpButton variant="primary" type="submit" form="supplier-password-reset-form" loading={submitting}>
              提交申请
            </SpButton>
          )}
        </>
      )}
    >
      {submitted ? (
        <div className="flex items-start gap-3" role="status">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} aria-hidden="true" />
          <div>
            <p className="font-semibold">申请已提交</p>
            <p className="mt-1 text-sm text-slate-600">
              无论账号是否存在，平台都会按统一流程受理。管理员审核通过后会按你填写的新密码更新账号，并提示申请人完成后续登录与密码确认。
            </p>
          </div>
        </div>
      ) : (
        <form id="supplier-password-reset-form" className="space-y-4" onSubmit={submit} noValidate>
          <label className="block text-sm font-medium">
            登录账号
            <SpInput
              className="mt-1 w-full"
              value={form.username}
              onChange={(event) => update("username", event.target.value)}
              autoComplete="username"
              data-dialog-initial-focus
            />
          </label>
          <label className="block text-sm font-medium">
            申请人姓名
            <SpInput
              className="mt-1 w-full"
              value={form.applicantName}
              onChange={(event) => update("applicantName", event.target.value)}
              autoComplete="name"
            />
          </label>
          <label className="block text-sm font-medium">
            联系方式（11位手机号）
            <SpInput
              className="mt-1 w-full"
              value={form.applicantContact}
              onChange={(event) => update("applicantContact", event.target.value)}
              autoComplete="tel"
              placeholder="手机号码或办公联系方式"
            />
          </label>
          <div className="flex items-start gap-2">
            <label className="block min-w-0 flex-1 text-sm font-medium">
              短信验证码
              <SpInput
                className="mt-1 w-full"
                value={form.verificationCode}
                onChange={(event) => update("verificationCode", event.target.value)}
                autoComplete="one-time-code"
                maxLength={6}
                inputMode="numeric"
                placeholder="6 位验证码"
              />
            </label>
            <button
              type="button"
              className="mt-6 inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={sendCode}
              disabled={isSendCodeDisabled}
            >
              {sendingCode ? "发送中..." : codeCooldown ? `${codeCooldown}s 后重试` : "获取验证码"}
            </button>
          </div>
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            申请前须先通过电话核验身份，请致电采购中心 <a className="underline" href="tel:02866666666">028-66666666</a>。
            页面将对手机号码进行短信验证码校验，申请提交后经采购管理人员审核，通过后生效。
          </p>
          <label className="block text-sm font-medium">
            新密码
            <SpInput
              className="mt-1 w-full"
              value={form.newPassword}
              onChange={(event) => update("newPassword", event.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="至少 8 位，含字母和数字"
            />
          </label>
          <label className="block text-sm font-medium">
            确认新密码
            <SpInput
              className="mt-1 w-full"
              value={form.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="再次输入新密码"
            />
          </label>
          {error && (
            <p className="flex items-start gap-2 text-sm text-red-700" role="alert">
              <TriangleAlert className="mt-0.5 shrink-0" size={16} aria-hidden="true" />{error}
            </p>
          )}
        </form>
      )}
    </SpDialog>
  );
}
