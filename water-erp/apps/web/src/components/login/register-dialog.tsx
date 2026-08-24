"use client";

import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/workbench";
import { sendRegistrationCode, registerUser, fetchRegistrationCompanies } from "@/lib/api/auth";
import { REGISTER_AGREEMENT_TITLE, REGISTER_AGREEMENT } from "./register-agreement";

type RegisterDialogProps = {
  isOpen: boolean;
  onClose: () => void;
};

type FormState = {
  username: string;
  password: string;
  confirmPassword: string;
  displayName: string;
  company: string;
  department: string;
  email: string;
  phone: string;
  officeLocation: string;
  verificationCode: string;
  requestedRole: "management" | "office" | "";
};

const EMPTY_FORM: FormState = {
  username: "",
  password: "",
  confirmPassword: "",
  displayName: "",
  company: "",
  department: "",
  email: "",
  phone: "",
  officeLocation: "",
  verificationCode: "",
  requestedRole: "",
};

export function RegisterDialog({ isOpen, onClose }: RegisterDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [codeSending, setCodeSending] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [companies, setCompanies] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);

  // 打开弹窗时拉取已知公司列表（下拉建议；后端会归一化手输变体）
  useEffect(() => {
    if (!isOpen) return;
    fetchRegistrationCompanies()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [isOpen]);

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setErrorMessage(null);
    setSuccess(false);
    setCodeCooldown(0);
    onClose();
  };

  const handleSendCode = async () => {
    if (!/^1\d{10}$/.test(form.phone)) {
      setErrorMessage("请输入有效的手机号");
      return;
    }
    setErrorMessage(null);
    setCodeSending(true);
    try {
      await sendRegistrationCode(form.phone);
      setCodeCooldown(60);
      const timer = setInterval(() => {
        setCodeCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "验证码发送失败",
      );
    } finally {
      setCodeSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (form.username.trim().length < 2) {
      setErrorMessage("请输入用户名");
      return;
    }
    if (form.password.length < 6) {
      setErrorMessage("密码不少于 6 位");
      return;
    }
    if (form.confirmPassword !== form.password) {
      setErrorMessage("两次输入的密码不一致");
      return;
    }
    if (!form.displayName.trim() || !form.company.trim() || !form.department.trim()) {
      setErrorMessage("姓名、公司、部门为必填项");
      return;
    }
    if (!/^1\d{10}$/.test(form.phone)) {
      setErrorMessage("请输入有效的手机号");
      return;
    }
    if (!form.verificationCode.trim()) {
      setErrorMessage("请输入手机验证码");
      return;
    }
    if (!form.requestedRole) {
      setErrorMessage("请选择申请权限");
      return;
    }
    if (!agreed) {
      setErrorMessage("请先阅读并同意注册协议");
      return;
    }

    setSubmitting(true);
    try {
      await registerUser({
        username: form.username.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
        company: form.company.trim(),
        department: form.department.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone,
        officeLocation: form.officeLocation.trim() || undefined,
        verificationCode: form.verificationCode.trim(),
        requestedRole: form.requestedRole,
      });
      setSuccess(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "注册失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "neu-input w-full text-sm";

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={success ? "注册已提交" : "注册新用户"}
      size="md"
      footer={
        success ? (
          <button type="button" onClick={handleClose} className="neu-btn-primary">
            我知道了
          </button>
        ) : (
          <>
            <button type="button" onClick={handleClose} className="neu-btn-soft">
              取消
            </button>
            <button
              type="submit"
              form="register-form"
              disabled={submitting}
              className="neu-btn-primary"
            >
              {submitting ? "提交中..." : "提交申请"}
            </button>
          </>
        )
      }
    >
      {success ? (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <CheckCircle2 size={40} className="text-[var(--success)]" strokeWidth={1.5} />
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">
              注册申请已提交，等待审核
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mt-2 leading-relaxed max-w-[20rem]">
              您的账号需管理员审核通过后方可登录使用。审核期间申请资料不可修改，请耐心等待；若被拒绝，可重新提交注册。
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <div className="shrink-0 text-[var(--accent)]">
              <ShieldCheck size={17} strokeWidth={1.85} />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--foreground)]">
                填写注册信息
              </div>
              <p className="text-xs text-[var(--muted-foreground)] mt-1 leading-relaxed">
                注册后需管理员审核通过方可登录。带 <span className="text-[var(--danger)]">*</span> 为必填。
              </p>
            </div>
          </div>

          <form
            id="register-form"
            onSubmit={handleSubmit}
            noValidate
            className="space-y-3"
          >
            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                用户名 <span className="text-[var(--danger)]">*</span>
              </span>
              <input
                type="text"
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                placeholder="登录账号"
                className={inputCls}
                autoComplete="username"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                密码 <span className="text-[var(--danger)]">*</span>
              </span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="至少 6 位"
                  className={`${inputCls} pr-10`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((p) => !p)}
                  className="login-field-toggle"
                >
                  {showPassword ? <EyeOff size={15} strokeWidth={1.85} /> : <Eye size={15} strokeWidth={1.85} />}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                确认密码 <span className="text-[var(--danger)]">*</span>
              </span>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={(e) => set("confirmPassword", e.target.value)}
                  placeholder="再次输入密码"
                  className={`${inputCls} pr-10`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  className="login-field-toggle"
                >
                  {showConfirmPassword ? <EyeOff size={15} strokeWidth={1.85} /> : <Eye size={15} strokeWidth={1.85} />}
                </button>
              </div>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                  姓名 <span className="text-[var(--danger)]">*</span>
                </span>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                  placeholder="请输入姓名"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                  邮箱
                </span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="请输入邮箱"
                  className={inputCls}
                  autoComplete="email"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                  公司 <span className="text-[var(--danger)]">*</span>
                </span>
                <input
                  type="text"
                  list="register-company-list"
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                  placeholder="选择或输入公司名称"
                  className={inputCls}
                  autoComplete="organization"
                />
                <datalist id="register-company-list">
                  {companies.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                  部门 <span className="text-[var(--danger)]">*</span>
                </span>
                <input
                  type="text"
                  value={form.department}
                  onChange={(e) => set("department", e.target.value)}
                  placeholder="请输入部门"
                  className={inputCls}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                办公位置
              </span>
              <input
                type="text"
                value={form.officeLocation}
                onChange={(e) => set("officeLocation", e.target.value)}
                placeholder="如：A 座 3 楼"
                className={inputCls}
              />
            </label>

            <div className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                申请权限 <span className="text-[var(--danger)]">*</span>
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => set("requestedRole", "management")}
                  className={`rounded-[8px] px-3 py-2.5 text-xs font-medium transition-all ${
                    form.requestedRole === "management"
                      ? "bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_40%,transparent)]"
                      : "bg-[var(--surface)] text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.6)]"
                  }`}
                >
                  管理权限
                </button>
                <button
                  type="button"
                  onClick={() => set("requestedRole", "office")}
                  className={`rounded-[8px] px-3 py-2.5 text-xs font-medium transition-all ${
                    form.requestedRole === "office"
                      ? "bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_40%,transparent)]"
                      : "bg-[var(--surface)] text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.6)]"
                  }`}
                >
                  办公权限
                </button>
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                手机号 <span className="text-[var(--danger)]">*</span>
              </span>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="请输入手机号"
                  className={`${inputCls} flex-1`}
                  autoComplete="tel"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={codeSending || codeCooldown > 0}
                  className="neu-btn-soft shrink-0 whitespace-nowrap text-xs disabled:opacity-50"
                >
                  {codeSending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : codeCooldown > 0 ? (
                    `${codeCooldown}s`
                  ) : (
                    "获取验证码"
                  )}
                </button>
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-[var(--muted-foreground)] mb-1 block">
                验证码 <span className="text-[var(--danger)]">*</span>
              </span>
              <input
                type="text"
                value={form.verificationCode}
                onChange={(e) => set("verificationCode", e.target.value)}
                placeholder="6 位手机验证码"
                className={inputCls}
                maxLength={6}
              />
            </label>

            <div className="flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                id="register-agree"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
              />
              <label htmlFor="register-agree" className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                我已阅读并同意
                <button
                  type="button"
                  onClick={() => setShowAgreement(true)}
                  className="mx-1 font-medium text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                >
                  《{REGISTER_AGREEMENT_TITLE}》
                </button>
              </label>
            </div>

            {errorMessage && (
              <p className="text-xs text-[var(--danger)] pt-1">{errorMessage}</p>
            )}
          </form>
        </>
      )}

      {/* 协议展示窗口 */}
      <Modal
        open={showAgreement}
        onClose={() => setShowAgreement(false)}
        title={REGISTER_AGREEMENT_TITLE}
        size="lg"
        footer={
          <button
            type="button"
            onClick={() => {
              setAgreed(true);
              setShowAgreement(false);
            }}
            className="neu-btn-primary"
          >
            我已阅读并同意
          </button>
        }
      >
        <div className="space-y-4 text-sm leading-relaxed text-[var(--foreground)]">
          {REGISTER_AGREEMENT.map((section, i) => (
            <div key={i}>
              <h3 className="mb-1.5 font-semibold text-[var(--foreground)]">{section.heading}</h3>
              <p className="whitespace-pre-line text-[13px] leading-6 text-[var(--muted-foreground)]">
                {section.body}
              </p>
            </div>
          ))}
        </div>
      </Modal>
    </Modal>
  );
}
