"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { Building2, FileText, Key, Lock, MapPin, Phone, UserRound, View } from "lucide-react";
import { toast } from "sonner";
import { authApi } from "@/lib/api/auth";
import { RegisterAgreement } from "@/components/register-agreement";

const EyeOff = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/** 临时供应商注册（凭邀请码，输满 8 位自动校验 + 协议勾选 + 信用代码查重） */
export default function RegisterTemporaryPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    invitationCode: "", name: "", creditCode: "",
    legalPerson: "", legalPersonIdCard: "", registeredAddress: "", region: "",
    displayName: "", phone: "", email: "", password: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [verifying, setVerifying] = useState(false);
  const [inviteVerified, setInviteVerified] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [validityDays, setValidityDays] = useState(0);
  const [expiresAt, setExpiresAt] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [agreeAgreement, setAgreeAgreement] = useState(false);
  const [creditCodeDuplicate, setCreditCodeDuplicate] = useState(false);

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
    if (!form.legalPerson.trim()) e.legalPerson = "请输入法定代表人姓名";
    if (!form.legalPersonIdCard.trim()) e.legalPersonIdCard = "请输入法定代表人身份证号";
    else if (!/^\d{17}[\dXx]$/.test(form.legalPersonIdCard.trim())) e.legalPersonIdCard = "身份证号须为 18 位";
    if (!form.displayName.trim()) e.displayName = "请输入联系人姓名";
    if (!form.phone.trim()) e.phone = "请输入手机号";
    else if (!/^1\d{10}$/.test(form.phone.trim())) e.phone = "手机号格式不正确";
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "邮箱格式不正确";
    if (!form.password) e.password = "请输入密码";
    else if (form.password.length < 6) e.password = "密码不少于 6 位";
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

  /** reg-* 体系表单项（与正式注册同款：reg-item + reg-inp 内凹 + 行内错误） */
  const field = (label: string, prop: string, input: React.ReactNode, required = false) => (
    <div className={`reg-item${errors[prop] ? " has-error" : ""}`}>
      <label className="reg-label">
        {label}{required && <i style={{ color: "var(--danger)", fontStyle: "normal" }}> *</i>}
      </label>
      {input}
      {inviteState(prop)}
      {errors[prop] && <span className="reg-error-text">{errors[prop]}</span>}
    </div>
  );
  const inp = (v: string, k: keyof typeof form, ph: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="reg-inp" value={v} placeholder={ph} onChange={(e) => set(k, e.target.value)} {...extra} />
  );

  function inviteState(prop: string) {
    if (prop !== "invitationCode") return null;
    if (inviteVerified) return <div className="lp-invite-ok">邀请码有效，有效期 {validityDays} 天，至 {expiresAt} 到期</div>;
    if (inviteError) return <div className="lp-invite-err">{verifying ? "校验中…" : inviteError}</div>;
    return null;
  }

  const canSubmit = inviteVerified && !submitting;

  return (
    <main className="reg reg--supplier">
      <div className="reg-bg" aria-hidden="true" />

      <div className="reg-brand" aria-label="智慧水发 · 蜀水云采">
        <Image src="/logo.png" alt="" width={54} height={54} className="reg-brand-mark" priority />
        <span className="reg-brand-name">智慧水发 · 蜀水云采</span>
      </div>

      <section className="reg-panel" aria-label="临时供应商注册">
        <div className="reg-card">
          <div className="reg-head">
            <div className="reg-brand-word">智慧水发<span className="reg-dot">·</span>蜀水云采</div>
            <div className="reg-divider" aria-hidden="true">◆</div>
            <h1 className="reg-title">临时供应商注册</h1>
            <p className="reg-sub">凭邀请码快速注册 · 审核通过后在有效期内参与投标 · 登录用户名为统一社会信用代码</p>
          </div>

          <div className="reg-body">
            <form className="reg-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              {/* ═══ 邀请凭证 ═══ */}
              <div className="reg-subsec">
                <h3>邀请凭证</h3>
                <span className="reg-hint">输满 8 位自动校验有效期</span>
              </div>
              <div className="reg-form-grid">
                {field("邀请码", "invitationCode",
                  <input className="reg-inp reg-invite-input" value={form.invitationCode}
                    placeholder="请输入 8 位邀请码" onChange={(e) => set("invitationCode", e.target.value)} />, true)}
              </div>

              {/* ═══ 企业信息 ═══ */}
              <div className="reg-subsec">
                <h3>企业信息</h3>
                <span className="reg-hint">登录用户名 = 统一社会信用代码</span>
              </div>
              <div className="reg-form-grid">
                {field("企业名称", "name", inp(form.name, "name", "营业执照上的企业全称"), true)}
                {field("统一社会信用代码（登录账号）", "creditCode", inp(form.creditCode, "creditCode", "18 位代码，即登录用户名", { maxLength: 18, onBlur: checkCreditCodeDuplicate }), true)}
                {field("所属行政区域", "region", inp(form.region, "region", "如：四川省/宜宾市/叙州区"))}
                {field("注册地址", "registeredAddress", inp(form.registeredAddress, "registeredAddress", "营业执照登记地址"))}
              </div>

              {/* ═══ 法定代表人 ═══ */}
              <div className="reg-subsec"><h3>法定代表人</h3></div>
              <div className="reg-form-grid">
                {field("法人姓名", "legalPerson", inp(form.legalPerson, "legalPerson", "法定代表人姓名"), true)}
                {field("法人身份证号", "legalPersonIdCard", inp(form.legalPersonIdCard, "legalPersonIdCard", "18 位身份证号", { maxLength: 18 }), true)}
              </div>

              {/* ═══ 联系人 ═══ */}
              <div className="reg-subsec"><h3>联系人</h3></div>
              <div className="reg-form-grid">
                {field("联系人姓名", "displayName", inp(form.displayName, "displayName", "请输入联系人姓名"), true)}
                {field("手机号", "phone", inp(form.phone, "phone", "11 位手机号", { maxLength: 11 }), true)}
                {field("邮箱", "email", inp(form.email, "email", "选填，用于接收通知"))}
                {field("登录密码", "password",
                  <div className="pwd-iw">
                    <input className="pwd-inp" type={showPwd ? "text" : "password"} value={form.password}
                      placeholder="不少于 6 位，字母 + 数字" autoComplete="new-password"
                      onChange={(e) => set("password", e.target.value)} />
                    <button type="button" className={`pwd-eye${showPwd ? " on" : ""}`} tabIndex={-1}
                      onClick={() => setShowPwd((v) => !v)} aria-label="显示密码">
                      {showPwd ? <EyeOff size={15} /> : <View size={15} />}
                    </button>
                  </div>, true)}
              </div>

              <RegisterAgreement value={agreeAgreement} onChange={setAgreeAgreement} />

              <button type="submit" className="reg-btn reg-btn--primary reg-submit-btn" disabled={!canSubmit}>
                {submitting ? "提交中…" : "提交注册申请"}
              </button>
            </form>
          </div>

          <div className="reg-foot">
            想转为正式供应商？<Link href="/register">正式注册</Link>
            <span className="reg-foot-sep">|</span>
            <Link href="/login">已有账号 · 直接登录</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
