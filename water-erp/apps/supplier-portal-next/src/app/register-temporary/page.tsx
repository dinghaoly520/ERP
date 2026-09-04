"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Tags,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { RegisterAgreement } from "@/components/register-agreement";
import { BusinessTagField } from "@/components/registration/business-tag-field";
import { PasswordField } from "@/components/registration/password-field";
import {
  RegistrationSection,
  RegistrationShell,
  type RegistrationStep,
} from "@/components/registration/registration-shell";
import { authApi } from "@/lib/api/auth";
import {
  firstInvalidTemporaryRegistrationStep,
  getErrorMessage,
  validateTemporaryRegistrationStep,
  type TemporaryRegistrationForm,
} from "@/lib/registration-validation";
import "@/styles/pages/register2.css";

const STEPS = [
  { label: "邀请与账号", description: "验证邀请资格并设置密码" },
  { label: "企业与业务", description: "登记主体与业务方向" },
  { label: "联系人", description: "维护业务对接信息" },
  { label: "确认提交", description: "核对资料并提交审核" },
] satisfies RegistrationStep[];

const INITIAL_FORM: TemporaryRegistrationForm = {
  invitationCode: "",
  password: "",
  confirmPassword: "",
  name: "",
  creditCode: "",
  legalPerson: "",
  legalPersonIdCard: "",
  registeredAddress: "",
  region: "",
  displayName: "",
  phone: "",
  email: "",
};

type FormKey = keyof typeof INITIAL_FORM;

/** 临时供应商注册：与正式注册保持一致的分步结构，并复用业务标签规则。 */
export default function RegisterTemporaryPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const [form, setForm] = useState(INITIAL_FORM);
  const [tags, setTags] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");

  const [verifying, setVerifying] = useState(false);
  const [inviteVerified, setInviteVerified] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [validityDays, setValidityDays] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");
  const verifySequence = useRef(0);

  const [submitting, setSubmitting] = useState(false);
  const [agreeAgreement, setAgreeAgreement] = useState(false);
  const [creditCodeDuplicate, setCreditCodeDuplicate] = useState(false);

  useEffect(() => {
    authApi.listBusinessTags().then(setTagOptions).catch(() => setTagOptions([]));
  }, []);

  // 输入满 8 位后自动校验；序号可防止慢请求覆盖更新的邀请码状态。
  useEffect(() => {
    const code = form.invitationCode;
    const requestId = ++verifySequence.current;
    setInviteVerified(false);
    setInviteError("");
    setValidityDays(0);
    setExpiresAt("");

    if (code.length !== 8) {
      setVerifying(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setVerifying(true);
      try {
        const result = await authApi.verifyInvitation(code);
        if (requestId !== verifySequence.current) return;
        if (result?.valid) {
          setInviteVerified(true);
          setValidityDays(result.validityDays || 0);
          setExpiresAt(dayjs(result.expiresAt).format("YYYY-MM-DD"));
        } else {
          setInviteError(result?.reason || "邀请码无效");
        }
      } catch {
        if (requestId === verifySequence.current) setInviteError("校验失败，请重试");
      } finally {
        if (requestId === verifySequence.current) setVerifying(false);
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [form.invitationCode]);

  function setValue(key: FormKey, value: string) {
    let nextValue = value;
    if (key === "invitationCode") nextValue = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (key === "creditCode") nextValue = value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 18);
    if (key === "legalPersonIdCard") nextValue = value.toUpperCase().replace(/[^0-9X]/g, "").slice(0, 18);

    setForm((current) => ({ ...current, [key]: nextValue }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (key === "creditCode") setCreditCodeDuplicate(false);
  }

  function setBusinessTags(nextTags: string[]) {
    setTags(nextTags);
    setErrors((current) => {
      if (!current.tags) return current;
      const next = { ...current };
      delete next.tags;
      return next;
    });
  }

  async function checkCreditCodeDuplicate(): Promise<boolean> {
    setCreditCodeDuplicate(false);
    const code = form.creditCode.trim();
    if (!/^[0-9A-Z]{18}$/.test(code)) return false;
    try {
      const result = await authApi.checkDuplicate({ creditCode: code });
      setCreditCodeDuplicate(result.creditCode);
      if (result.creditCode) toast.warning("该统一社会信用代码已被注册，请核对后重试");
      return result.creditCode;
    } catch {
      return false;
    }
  }

  function validateStep(targetStep: number): boolean {
    const nextErrors = validateTemporaryRegistrationStep(targetStep, form, tags, {
      verifying,
      inviteVerified,
      inviteError,
      agreeAgreement,
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function focusFirstError() {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".reg-step-pane:not([hidden]) [aria-invalid='true'], .reg-step-pane:not([hidden]) .has-error input")?.focus();
    });
  }

  async function nextStep() {
    if (!validateStep(step)) {
      focusFirstError();
      return;
    }
    if (step === 1 && await checkCreditCodeDuplicate()) {
      setErrors({ creditCode: "该统一社会信用代码已被注册" });
      focusFirstError();
      return;
    }

    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    setMaxVisitedStep((current) => Math.max(current, next));
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previousStep() {
    setStep((current) => Math.max(0, current - 1));
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    setSubmissionError("");
    const invalid = firstInvalidTemporaryRegistrationStep(form, tags, {
      verifying,
      inviteVerified,
      inviteError,
      agreeAgreement,
    });
    if (invalid) {
      setErrors(invalid.errors);
      setStep(invalid.step);
      focusFirstError();
      return;
    }

    if (creditCodeDuplicate || await checkCreditCodeDuplicate()) {
      toast.error("统一社会信用代码重复，无法注册，请核对后重试");
      setErrors({ creditCode: "该统一社会信用代码已被注册" });
      setStep(1);
      focusFirstError();
      return;
    }

    setSubmitting(true);
    try {
      await authApi.registerTemporary({
        invitationCode: form.invitationCode,
        name: form.name.trim(),
        creditCode: form.creditCode.trim(),
        legalPerson: form.legalPerson.trim(),
        legalPersonIdCard: form.legalPersonIdCard.trim(),
        registeredAddress: form.registeredAddress.trim() || undefined,
        region: form.region.trim() || undefined,
        displayName: form.displayName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        password: form.password,
        tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))],
      });
      toast.success("注册申请已提交，等待采购中心审核");
      router.push("/login");
    } catch (error: unknown) {
      const message = getErrorMessage(error, "注册失败，请检查信息后重试");
      setSubmissionError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  function input(
    key: FormKey,
    placeholder: string,
    attributes: InputHTMLAttributes<HTMLInputElement> = {},
  ) {
    const id = `temporary-${key}`;
    const errorId = `${id}-error`;
    const describedBy = [attributes["aria-describedby"], errors[key] ? errorId : ""].filter(Boolean).join(" ") || undefined;
    return (
      <input
        {...attributes}
        id={id}
        className={`reg-inp${attributes.className ? ` ${attributes.className}` : ""}`}
        value={form[key]}
        placeholder={placeholder}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={describedBy}
        onChange={(event) => setValue(key, event.target.value)}
      />
    );
  }

  function field(label: string, key: FormKey, control: ReactNode, required = false) {
    const errorId = `temporary-${key}-error`;
    return (
      <div className={`reg-item${errors[key] ? " has-error" : ""}`}>
        <label className="reg-label" htmlFor={`temporary-${key}`}>
          {label}{required && <i> *</i>}
        </label>
        {control}
        {errors[key] && <span id={errorId} className="reg-error-text" role="alert">{errors[key]}</span>}
      </div>
    );
  }

  const notice = (
    <div className="reg-temporary-note">
      <ShieldCheck size={19} aria-hidden="true" />
      <div>
        <strong>临时账户说明</strong>
        <span>临时供应商须凭采购方邀请码注册，审核通过后仅在邀请有效期内参与对应业务。</span>
      </div>
    </div>
  );

  const actions = (
    <>
      {step > 0 ? (
        <button type="button" className="reg-btn reg-btn--back" onClick={previousStep} disabled={submitting}>
          <ArrowLeft size={16} aria-hidden="true" />上一步
        </button>
      ) : <span className="reg-actions-spacer" />}

      {step < STEPS.length - 1 ? (
        <button type="button" className="reg-btn reg-btn--primary" onClick={nextStep} disabled={verifying && step === 0}>
          下一步<ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" className="reg-btn reg-btn--primary" onClick={submit} disabled={submitting}>
          <CheckCircle2 size={16} aria-hidden="true" />{submitting ? "提交中…" : "提交注册申请"}
        </button>
      )}
    </>
  );

  return (
    <RegistrationShell
      title="临时供应商注册"
      subtitle="凭邀请快速建档，按有效期参与采购业务"
      notice={notice}
      steps={STEPS}
      currentStep={step}
      maxVisitedStep={maxVisitedStep}
      onStepChange={(nextStepIndex) => {
        setStep(nextStepIndex);
        setErrors({});
      }}
      actions={actions}
    >
      <form className="reg-form" onSubmit={(event) => event.preventDefault()} noValidate>
        <div className="reg-step-pane" hidden={step !== 0}>
          <RegistrationSection icon={KeyRound} title="验证邀请资格" hint="输入满 8 位后自动校验">
            <div className={`reg-item${errors.invitationCode ? " has-error" : ""}`}>
              <label className="reg-label" htmlFor="temporary-invitationCode">邀请码 <i>*</i></label>
              {input("invitationCode", "请输入 8 位邀请码", {
                className: "reg-invite-input",
                maxLength: 8,
                autoComplete: "one-time-code",
                "aria-describedby": "temporary-invitation-status",
              })}
              <div id="temporary-invitation-status" aria-live="polite">
                {verifying && <span className="reg-invite-state is-loading">正在校验邀请资格…</span>}
                {!verifying && inviteVerified && (
                  <span className="reg-invite-state is-valid">邀请码有效，有效期 {validityDays} 天，至 {expiresAt} 到期</span>
                )}
                {!verifying && inviteError && <span id="temporary-invitationCode-error" className="reg-invite-state is-invalid" role="alert">{inviteError}</span>}
              </div>
              {errors.invitationCode && errors.invitationCode !== inviteError && <span id="temporary-invitationCode-error" className="reg-error-text" role="alert">{errors.invitationCode}</span>}
            </div>
          </RegistrationSection>

          <RegistrationSection icon={ShieldCheck} title="设置登录密码" hint="统一社会信用代码将作为登录用户名">
            <div className="reg-form-grid">
              <PasswordField
                label="登录密码"
                value={form.password}
                onChange={(value) => setValue("password", value)}
                error={errors.password}
                placeholder="至少 8 位，包含字母和数字"
                required
              />
              <PasswordField
                label="确认密码"
                value={form.confirmPassword}
                onChange={(value) => setValue("confirmPassword", value)}
                error={errors.confirmPassword}
                placeholder="请再次输入登录密码"
                required
              />
            </div>
          </RegistrationSection>
        </div>

        <div className="reg-step-pane" hidden={step !== 1}>
          <RegistrationSection icon={Building2} title="企业基本信息" hint="请与营业执照保持一致">
            <div className="reg-form-grid">
              {field("企业名称", "name", input("name", "营业执照上的企业全称", { autoComplete: "organization" }), true)}
              {field("统一社会信用代码", "creditCode", input("creditCode", "18 位代码，即登录用户名", {
                maxLength: 18,
                autoComplete: "username",
                onBlur: () => void checkCreditCodeDuplicate(),
              }), true)}
              {field("所属行政区域", "region", input("region", "如：四川省 / 成都市 / 高新区"))}
              {field("注册地址", "registeredAddress", input("registeredAddress", "营业执照登记地址", { autoComplete: "street-address" }))}
            </div>
            {creditCodeDuplicate && <p className="reg-error-banner" role="alert">该统一社会信用代码已注册，无法重复提交。</p>}
          </RegistrationSection>

          <RegistrationSection icon={ShieldCheck} title="法定代表人" hint="用于核验企业主体身份">
            <div className="reg-form-grid">
              {field("法人姓名", "legalPerson", input("legalPerson", "法定代表人姓名"), true)}
              {field("法人身份证号", "legalPersonIdCard", input("legalPersonIdCard", "18 位身份证号", { maxLength: 18 }), true)}
            </div>
          </RegistrationSection>

          <RegistrationSection icon={Tags} title="业务方向" hint="与正式注册使用相同的标签规则">
            <BusinessTagField
              value={tags}
              options={tagOptions}
              onChange={setBusinessTags}
              error={errors.tags}
            />
          </RegistrationSection>
        </div>

        <div className="reg-step-pane" hidden={step !== 2}>
          <RegistrationSection icon={UserRound} title="业务联系人" hint="平台将通过此联系人进行业务对接">
            <div className="reg-form-grid">
              {field("联系人姓名", "displayName", input("displayName", "请输入联系人姓名", { autoComplete: "name" }), true)}
              {field("手机号", "phone", input("phone", "11 位手机号", { maxLength: 11, inputMode: "tel", autoComplete: "tel" }), true)}
              {field("邮箱", "email", input("email", "选填，用于接收通知", { type: "email", autoComplete: "email" }))}
            </div>
          </RegistrationSection>
        </div>

        <div className="reg-step-pane" hidden={step !== 3}>
          <RegistrationSection icon={CheckCircle2} title="注册信息确认" hint="提交后由采购中心审核">
            <dl className="reg-summary">
              <div className="reg-summary-item"><dt>邀请状态</dt><dd>{inviteVerified ? `有效至 ${expiresAt}` : "待重新校验"}</dd></div>
              <div className="reg-summary-item"><dt>登录用户名</dt><dd className="reg-mono">{form.creditCode || "未填写"}</dd></div>
              <div className="reg-summary-item"><dt>企业名称</dt><dd>{form.name || "未填写"}</dd></div>
              <div className="reg-summary-item"><dt>法定代表人</dt><dd>{form.legalPerson || "未填写"}</dd></div>
              <div className="reg-summary-item"><dt>业务联系人</dt><dd>{form.displayName || "未填写"}</dd></div>
              <div className="reg-summary-item"><dt>联系人手机</dt><dd>{form.phone || "未填写"}</dd></div>
              <div className="reg-summary-item reg-summary-item--wide">
                <dt>业务标签</dt>
                <dd className="reg-tags">
                  {tags.length > 0 ? tags.map((tag) => <span key={tag} className="reg-tag-chip">{tag}</span>) : "未选择"}
                </dd>
              </div>
            </dl>
          </RegistrationSection>

          <div className="reg-notice">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>临时资格仅在邀请码对应的有效期内生效。若后续需要长期合作，可在资料审核通过后申请转为正式供应商。</span>
          </div>
          <RegisterAgreement value={agreeAgreement} onChange={(value) => {
            setAgreeAgreement(value);
            if (value) setErrors((current) => {
              const next = { ...current };
              delete next.agreement;
              return next;
            });
          }} />
          {errors.agreement && <p className="reg-error-text reg-agreement-error" role="alert">{errors.agreement}</p>}
        </div>
      </form>
      {submissionError && <p className="reg-submit-error" role="alert">{submissionError}</p>}
    </RegistrationShell>
  );
}
