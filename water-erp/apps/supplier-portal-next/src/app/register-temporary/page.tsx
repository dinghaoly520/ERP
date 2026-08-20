"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { Key, Building2, FileText, UserRound, Phone, Lock, View } from "lucide-react";
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
  const [form, setForm] = useState({ invitationCode: "", name: "", creditCode: "", displayName: "", phone: "", password: "" });
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
    if (!form.displayName.trim()) e.displayName = "请输入联系人姓名";
    if (!form.phone.trim()) e.phone = "请输入手机号";
    else if (!/^1\d{10}$/.test(form.phone.trim())) e.phone = "手机号格式不正确";
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
        displayName: form.displayName.trim(),
        phone: form.phone.trim(),
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

  const field = (label: string, prop: string, icon: React.ReactNode, input: React.ReactNode, extra?: React.ReactNode) => (
    <div className={`lp-field${errors[prop] ? " has-err" : ""}`}>
      <label className="lp-label">{label}</label>
      <div className="lp-input-wrap">
        <span className="lp-prefix">{icon}</span>
        {input}
      </div>
      {inviteState(prop)}
      {errors[prop] && <span className="lp-err-text">{errors[prop]}</span>}
      {extra}
    </div>
  );

  function inviteState(prop: string) {
    if (prop !== "invitationCode") return null;
    if (inviteVerified) return <div className="lp-invite-ok">邀请码有效，有效期 {validityDays} 天，至 {expiresAt} 到期</div>;
    if (inviteError) return <div className="lp-invite-err">{verifying ? "校验中…" : inviteError}</div>;
    return null;
  }

  const canSubmit = inviteVerified && !submitting;

  return (
    <main className="lp lp--supplier lp--reg">
      <div className="lp-bg" aria-hidden="true" />

      <div className="lp-brand" aria-label="智慧水发 · 蜀水云采">
        <Image src="/logo.png" alt="" width={54} height={54} className="lp-brand-mark" priority />
        <span className="lp-brand-name">智慧水发 · 蜀水云采</span>
      </div>

      <section className="lp-panel lp-panel--reg" aria-label="临时供应商注册">
        <div className="lp-card lp-card--reg">
          <div className="lp-head">
            <div className="lp-brand-word">智慧水发<span className="lp-dot">·</span>蜀水云采</div>
            <div className="lp-divider" aria-hidden="true">◆</div>
            <h1 className="lp-title">临时供应商注册</h1>
            <p className="lp-sub">凭邀请码快速注册，审核通过后即可在有效期内使用</p>
          </div>

          <form className="lp-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            {field("邀请码", "invitationCode", <Key size={17} />,
              <input value={form.invitationCode} placeholder="请输入 8 位邀请码（输完自动校验）"
                onChange={(e) => set("invitationCode", e.target.value)} />)}
            {field("企业名称", "name", <Building2 size={17} />,
              <input value={form.name} placeholder="营业执照上的企业全称" onChange={(e) => set("name", e.target.value)} />)}
            {field("统一社会信用代码", "creditCode", <FileText size={17} />,
              <input value={form.creditCode} placeholder="18 位代码（用于查询审核进度）" maxLength={18}
                onChange={(e) => set("creditCode", e.target.value)} onBlur={checkCreditCodeDuplicate} />)}
            {field("联系人姓名", "displayName", <UserRound size={17} />,
              <input value={form.displayName} placeholder="请输入联系人姓名" onChange={(e) => set("displayName", e.target.value)} />)}
            {field("手机号", "phone", <Phone size={17} />,
              <input value={form.phone} placeholder="11 位手机号" maxLength={11} onChange={(e) => set("phone", e.target.value)} />)}
            {field("登录密码", "password", <Lock size={17} />,
              <>
                <input type={showPwd ? "text" : "password"} value={form.password} placeholder="不少于 6 位"
                  autoComplete="new-password" onChange={(e) => set("password", e.target.value)} />
                <button type="button" className="lp-eye" tabIndex={-1} onClick={() => setShowPwd((v) => !v)} aria-label="显示密码">
                  {showPwd ? <EyeOff size={16} /> : <View size={16} />}
                </button>
              </>)}

            <RegisterAgreement value={agreeAgreement} onChange={setAgreeAgreement} />

            <button type="submit" className="lp-primary" disabled={!canSubmit}>
              {submitting ? "提交中…" : "提交注册申请"}
            </button>
          </form>

          <div className="lp-foot">
            <Link href="/register" className="lp-foot-link">改为正式注册供应商</Link>
            <span className="lp-foot-sep">|</span>
            <Link href="/login" className="lp-foot-link">已有账号 · 直接登录</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
