"use client";

import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { Building2, CheckCircle2, KeyRound, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authApi } from "@/lib/api/auth";
import { RegisterAgreement } from "@/components/register-agreement";
import { RegistrationField, RegistrationSection, RegistrationShell } from "@/components/registration/registration-shell";
import { PasswordField } from "@/components/registration/password-field";
import { BusinessTagField } from "@/components/registration/business-tag-field";
import "@/styles/pages/register2.css";

/** 临时供应商注册（凭邀请码，输满 8 位自动校验 + 协议勾选 + 信用代码查重）— 与正式注册同款设计 */
export default function RegisterTemporaryPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    invitationCode: "", name: "", creditCode: "",
    legalPerson: "", legalPersonIdCard: "",
    displayName: "", phone: "", password: "", registrationCode: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string }[]>([]);

  const [verifying, setVerifying] = useState(false);
  const [inviteVerified, setInviteVerified] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [validityDays, setValidityDays] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [agreeAgreement, setAgreeAgreement] = useState(false);
  const [creditCodeDuplicate, setCreditCodeDuplicate] = useState(false);

  // 归属公司选项（拉取失败不阻塞注册——留空即未归属，admin 可后补）
  const [companyOptions, setCompanyOptions] = useState<{ id: string; name: string }[]>([]);
  const [belongCompanyId, setBelongCompanyId] = useState("");
  useEffect(() => {
    authApi.companyOptions()
      .then(setCompanyOptions)
      .catch(() => { /* 不阻塞 */ });
    authApi.listBusinessTags()
      .then(setTagOptions)
      .catch(() => { /* 不阻塞 */ });
  }, []);

  /* ── 注册短信验证码 ── */
  const [codeSending, setCodeSending] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [codeStatus, setCodeStatus] = useState<"idle" | "checking" | "ok" | "bad">("idle");

  async function sendRegCode() {
    if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) { toast.warning("请先输入有效的手机号"); return; }
    setCodeSending(true);
    try {
      await authApi.sendRegistrationCode(form.phone.trim());
      toast.success("验证码已发送");
      setCodeCooldown(60);
      const timer = setInterval(() => {
        setCodeCooldown((c) => { if (c <= 1) { clearInterval(timer); return 0; } return c - 1; });
      }, 1000);
    } catch (error: unknown) {
      toast.error((error as Error)?.message || "验证码发送失败，请稍后重试");
    } finally {
      setCodeSending(false);
    }
  }

  // 验证码输满 6 位 → 400ms 防抖预检（不消费验证码），即时反馈 ✓/✗
  useEffect(() => {
    setCodeStatus("idle");
    const code = form.registrationCode.trim();
    if (code.length !== 6 || !/^1[3-9]\d{9}$/.test(form.phone.trim())) return;
    setCodeStatus("checking");
    const timer = setTimeout(() => {
      authApi.checkRegistrationCode(form.phone.trim(), code)
        .then(() => setCodeStatus("ok"))
        .catch(() => setCodeStatus("bad"));
    }, 400);
    return () => clearTimeout(timer);
  }, [form.registrationCode, form.phone]);

  async function verifyCode(code: string) {
    setVerifying(true);
    setInviteError("");
    setInviteVerified(false);
    try {
      const res = await authApi.verifyInvitation(code);
      if (res?.valid) {
        setInviteVerified(true);
        setValidityDays(res.validityDays || 0);
        setExpiresAt(dayjs(res.expiresAt).format("YYYY-MM-DD"));
      } else {
        setInviteError(res?.reason || "邀请码无效");
      }
    } catch {
      setInviteError("校验失败，请重试");
    } finally {
      setVerifying(false);
    }
  }

  // 邀请码输满 8 位自动校验；粘贴清洗为大写字母数字
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (codeTimer.current) clearTimeout(codeTimer.current);
    setInviteVerified(false);
    setInviteError("");
    const cleaned = (form.invitationCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (cleaned !== form.invitationCode) {
      codeTimer.current = setTimeout(() => setForm((f) => ({ ...f, invitationCode: cleaned })), 0);
      return;
    }
    if (cleaned.length === 8) {
      codeTimer.current = setTimeout(() => verifyCode(cleaned), 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.invitationCode]);

  async function checkCreditCodeDuplicate() {
    setCreditCodeDuplicate(false);
    const code = form.creditCode.trim();
    if (!/^[0-9A-Z]{18}$/.test(code)) return;
    try {
      const res = await authApi.checkDuplicate({ creditCode: code });
      setCreditCodeDuplicate(res.creditCode);
      if (res.creditCode) toast.warning("该统一社会信用代码已被注册，请核对后重试");
    } catch { /* 查重失败不阻塞流程 */ }
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.invitationCode.trim()) e.invitationCode = "请输入邀请码";
    if (!form.name.trim()) e.name = "请输入企业名称";
    if (!form.creditCode.trim()) e.creditCode = "请输入统一社会信用代码";
    else if (!/^[0-9A-Z]{18}$/.test(form.creditCode.trim())) e.creditCode = "统一社会信用代码须为 18 位";
    if (!form.legalPerson.trim()) e.legalPerson = "请输入法定代表人";
    if (!form.legalPersonIdCard.trim()) e.legalPersonIdCard = "请输入法定代表人身份证号";
    else if (!/^\d{17}[\dXx]$/.test(form.legalPersonIdCard.trim())) e.legalPersonIdCard = "身份证号须为 18 位";
    if (!form.displayName.trim()) e.displayName = "请输入联系人姓名";
    if (!form.phone.trim()) e.phone = "请输入手机号";
    else if (!/^1\d{10}$/.test(form.phone.trim())) e.phone = "手机号格式不正确";
    if (!form.registrationCode.trim()) e.registrationCode = "请输入短信验证码";
    else if (!/^\d{6}$/.test(form.registrationCode.trim())) e.registrationCode = "验证码须为 6 位数字";
    else if (codeStatus === "bad") e.registrationCode = "验证码不正确，请核对后重新输入";
    if (tags.length < 2) e.tags = "请至少选择 2 个业务标签";
    else if (tags.length > 8) e.tags = "最多选择 8 个业务标签";
    if (!form.password) e.password = "请输入密码";
    else if (form.password.length < 6) e.password = "密码不少于 6 位";
    if (!belongCompanyId) e.belongCompanyId = "请选择归属公司：须正确选择，否则将影响投标";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    if (!inviteVerified) { toast.warning("请先校验邀请码"); return; }
    if (!agreeAgreement) { toast.warning("请先阅读并同意《供应商注册入驻协议》"); return; }
    if (creditCodeDuplicate) { toast.error("统一社会信用代码重复，无法注册，请核对后重试"); return; }
    setSubmitting(true);
    try {
      await authApi.registerTemporary({
        invitationCode: form.invitationCode.trim(),
        companyId: belongCompanyId || undefined,
        name: form.name.trim(),
        creditCode: form.creditCode.trim(),
        legalPerson: form.legalPerson.trim(),
        legalPersonIdCard: form.legalPersonIdCard.trim(),
        displayName: form.displayName.trim(),
        phone: form.phone.trim(),
        registrationCode: form.registrationCode.trim(),
        tags,
        password: form.password,
      });
      toast.success("注册申请已提交，等待采购中心审核");
      router.push("/login");
    } catch (e: any) {
      toast.error(e?.message || "注册失败，请检查信息后重试");
    } finally {
      setSubmitting(false);
    }
  }

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const inp = (v: string, setKey: (s: string) => void, ph: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="reg-inp" value={v} placeholder={ph} onChange={(e) => setKey(e.target.value)} {...extra} />
  );
  const item = (prop: string, label: string, node: React.ReactNode, required = false, extra?: React.ReactNode) => (
    <RegistrationField id={`reg-temp-${prop}`} label={label} error={errors[prop]} required={required}>
      {node}
      {extra}
    </RegistrationField>
  );

  const inviteNote = inviteVerified ? (
    <span className="reg-invite-note is-ok"><CheckCircle2 size={14} strokeWidth={2.25} aria-hidden="true" />邀请码有效，有效期 {validityDays} 天，至 {expiresAt} 到期</span>
  ) : inviteError ? (
    <span className="reg-invite-note is-err">{verifying ? "校验中…" : inviteError}</span>
  ) : null;

  return (
    <RegistrationShell
      className="reg-page--temp"
      title="临时供应商注册"
      subtitle="凭邀请码快速注册，审核通过后即可在有效期内使用"
      formLabel="临时供应商注册表单"
      footExtra={<Link href="/register" className="reg-foot-link">改为正式注册</Link>}
      actions={(
        <>
          <span className="reg-actions-spacer" />
          <button type="button" className="reg-btn reg-btn--primary" disabled={!inviteVerified || submitting} onClick={submit}>
            {!submitting && <CheckCircle2 size={16} aria-hidden="true" />}
            {submitting ? "提交中…" : "提交注册申请"}
          </button>
        </>
      )}
    >
      <form className="reg-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <RegistrationSection icon={KeyRound} title="邀请码验证" hint="输满 8 位自动校验">
          <div className="reg-form-grid">
            {item("invitationCode", "邀请码", (
              <input className="reg-inp" value={form.invitationCode} placeholder="请输入 8 位邀请码" maxLength={8}
                aria-label="邀请码" onChange={(e) => set("invitationCode", e.target.value)} />
            ), true, inviteNote)}
          </div>
        </RegistrationSection>

        <RegistrationSection icon={Building2} title="企业与账号" hint="请按营业执照如实填写">
          <div className="reg-form-grid">
            {item("name", "企业名称", inp(form.name, (s) => set("name", s), "营业执照上的企业全称"), true)}
            {item("creditCode", "统一社会信用代码", inp(form.creditCode, (s) => set("creditCode", s.toUpperCase()), "18 位代码（用于查询审核进度）", { maxLength: 18, onBlur: checkCreditCodeDuplicate }), true)}
            {item("legalPerson", "法定代表人", inp(form.legalPerson, (s) => set("legalPerson", s), "营业执照上的法定代表人"), true)}
            {item("legalPersonIdCard", "法定代表人身份证号", inp(form.legalPersonIdCard, (s) => set("legalPersonIdCard", s.toUpperCase()), "18 位身份证号", { maxLength: 18 }), true)}
            {item("displayName", "联系人姓名", inp(form.displayName, (s) => set("displayName", s), "请输入联系人姓名"), true)}
            {item("phone", "注册手机号", (
              <div className="reg-code-row">
                <input id="reg-temp-phone" className="reg-inp" value={form.phone} placeholder="本人手机号，用于接收注册验证码" maxLength={11} inputMode="numeric" autoComplete="tel"
                  onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} />
                <button type="button" className="reg-btn reg-btn--ghost-sm reg-code-btn" disabled={codeSending || codeCooldown > 0} onClick={sendRegCode}>
                  {codeSending ? "发送中…" : codeCooldown > 0 ? `${codeCooldown}s` : "获取验证码"}
                </button>
              </div>
            ), true)}
            {item("registrationCode", "短信验证码", (
              <div className="reg-code-row">
                <input id="reg-temp-registrationCode" className="reg-inp" value={form.registrationCode} placeholder="6 位验证码" maxLength={6} inputMode="numeric" autoComplete="one-time-code"
                  onChange={(e) => set("registrationCode", e.target.value.replace(/\D/g, ""))} />
                <span className="reg-code-check" data-status={codeStatus} aria-hidden="true">
                  {codeStatus === "checking" ? "…" : codeStatus === "ok" ? <CheckCircle2 size={16} strokeWidth={2.25} /> : codeStatus === "bad" ? <X size={16} strokeWidth={2.25} /> : null}
                </span>
              </div>
            ), true)}
            <PasswordField
              label="登录密码"
              value={form.password}
              onChange={(password) => set("password", password)}
              error={errors.password}
              placeholder="不少于 6 位"
              required
            />
          </div>
          {/* 归属公司：模块底部整行（与正式注册步骤 1 同款） */}
          {item("belongCompanyId", "归属公司", (
            <select
              id="reg-temp-belongCompanyId"
              className="reg-sel"
              value={belongCompanyId}
              onChange={(e) => setBelongCompanyId(e.target.value)}
            >
              <option value="">请选择归属公司（须正确选择，否则影响投标）</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ))}
          <BusinessTagField value={tags} options={tagOptions} onChange={setTags} error={errors.tags} />
        </RegistrationSection>

        <RegisterAgreement value={agreeAgreement} onChange={setAgreeAgreement} />
      </form>
    </RegistrationShell>
  );
}
