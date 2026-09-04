"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Clock3, Eye, EyeOff, KeyRound, Lock, SearchCheck, ShieldCheck, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth, type LoginResult } from "@/lib/auth-context";
import { authApi } from "@/lib/api/auth";
import { getErrorMessage, validateLoginCredentials } from "@/lib/registration-validation";
import { PasswordResetRequestDialog } from "@/components/auth/password-reset-request-dialog";

/**
 * 品牌蓝 · 新拟态登录卡（lp-* 样式移植自 Vue Login.vue）。
 * 不预填任何演示账号——硬编码真实种子凭证会让访客一键登录他企，属安全事故。
 * ACCOUNT_PENDING → 查询审核进度面板；TEMPORARY_EXPIRED → 邀请码续期面板。
 */
const STATUS_TEXT: Record<string, string> = {
  PENDING: "待审核：您的注册申请正在审核中，请耐心等待。",
  RETURNED: "退回补正：申请被退回，请按原因补充材料后重新提交。",
  APPROVED: "已通过：账号已激活，请使用注册账号登录。",
  DISABLED: "已停用：账号已被停用，如有疑问请联系采购中心。",
  BLACKLIST: "账号已列入不良供应商名单，如有异议请联系采购中心申诉。",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { login, logout, isLoggedIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingInfo, setPendingInfo] = useState<{ code: string } | null>(null);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const passwordResetTriggerRef = useRef<HTMLButtonElement>(null);
  const shouldRestorePasswordResetFocusRef = useRef(false);

  // 注册成功跳转来的（?registered=1）：自动展开审核进度查询
  const [showQuery, setShowQuery] = useState(() => params.get("registered") === "1");
  const [queryCode, setQueryCode] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<{ found: boolean; name?: string | null; status?: string | null; reason?: string | null } | null>(null);

  // 临时供应商过期续期
  const [showReactivate, setShowReactivate] = useState(false);
  const [reactivateCode, setReactivateCode] = useState("");
  const [reactivating, setReactivating] = useState(false);

  const openPasswordResetDialog = () => {
    shouldRestorePasswordResetFocusRef.current = true;
    setShowPasswordReset(true);
    setShowReactivate(false);
    setShowQuery(false);
    setQueryResult(null);
  };

  useEffect(() => {
    if (showPasswordReset || !shouldRestorePasswordResetFocusRef.current) return;
    shouldRestorePasswordResetFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      passwordResetTriggerRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showPasswordReset]);

  useEffect(() => {
    if (params.get("forceLogin") === "1") {
      logout();
      return;
    }
    // 已登录访问 /login → 回工作台（对齐 Vue 路由守卫 guest 分支）
    if (isLoggedIn) router.replace("/dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    const validationError = validateLoginCredentials(username, password);
    if (validationError) { toast.error(validationError); return; }
    setLoading(true);
    try {
      const result: LoginResult = await login(username, password);
      if (result === "ok") {
        router.push("/dashboard");
      } else if (result === "invalid") {
        toast.error("用户名或密码错误");
      } else if (result === "expired") {
        // 临时权限过期：展开续期面板（凭新邀请码），而非仅弹错让用户死锁
        setShowReactivate(true);
      } else if (result === "pending") {
        setPendingInfo({ code: "ACCOUNT_PENDING" });
      }
    } catch {
      toast.error("登录失败，请检查账号密码");
    } finally {
      setLoading(false);
    }
  }

  async function handleQueryStatus() {
    const code = queryCode.trim();
    if (!code) { toast.warning("请输入统一社会信用代码"); return; }
    setQuerying(true);
    setQueryResult(null);
    try {
      setQueryResult(await authApi.getRegisterStatusPublic(code));
    } catch {
      toast.error("查询失败，请稍后重试");
    } finally {
      setQuerying(false);
    }
  }

  async function handleReactivate() {
    const code = reactivateCode.trim();
    if (!code) { toast.warning("请输入新的邀请码"); return; }
    setReactivating(true);
    try {
      await authApi.reactivateTemporary({ username, password, invitationCode: code });
      toast.success("续期成功，请重新登录");
      setShowReactivate(false);
      setReactivateCode("");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "续期失败，请核对邀请码"));
    } finally {
      setReactivating(false);
    }
  }

  return (
    <main className="lp lp--supplier">
      <div className="lp-bg" aria-hidden="true" />

      <div className="lp-brand" aria-label="智慧水发 · 蜀水云采">
        <Image src="/logo.png" alt="" width={54} height={54} className="lp-brand-mark" priority />
        <span className="lp-brand-name">智慧水发 · 蜀水云采</span>
      </div>

      {!showPasswordReset ? (
        <section className="lp-panel" aria-label="登录表单">
        <div className="lp-card">
          <div className="lp-head">
            <div className="lp-brand-word">智慧水发<span className="lp-dot">·</span>蜀水云采</div>
            <div className="lp-divider" aria-hidden="true">◆</div>
            <h1 className="lp-title">供应商门户</h1>
            <p className="lp-subtitle">使用统一社会信用代码登录</p>
          </div>

          <form className="lp-form" onSubmit={handleLogin}>
            <div className="lp-field">
              <label className="lp-label" htmlFor="lp-username">用户名</label>
              <div className="lp-input-wrap">
                <span className="lp-prefix" aria-hidden="true"><User size={17} /></span>
                <input
                  id="lp-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="统一社会信用代码（登录账号）"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="lp-field">
              <label className="lp-label" htmlFor="lp-password">密码</label>
              <div className="lp-input-wrap">
                <span className="lp-prefix" aria-hidden="true"><Lock size={17} /></span>
                <input
                  id="lp-password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lp-eye"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPwd}
                >
                  {showPwd ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>

            <button type="submit" className="lp-primary" disabled={loading}>
              {loading ? "登录中…" : "登 录"}
            </button>
          </form>

          {/* 待审核拦截提示 + 审核进度查询（A4 闭环） */}
          {(pendingInfo || showQuery) && (
            <div className="lp-pending">
              {pendingInfo && (
                <p className="lp-pending__hint">
                  该账号尚未激活（待审核或已停用）。可凭统一社会信用代码查询审核进度：
                </p>
              )}
              <div className="lp-query">
                <input
                  className="lp-query-input"
                  value={queryCode}
                  onChange={(e) => setQueryCode(e.target.value)}
                  placeholder="统一社会信用代码（18 位）"
                  maxLength={18}
                  onKeyDown={(e) => { if (e.key === "Enter") handleQueryStatus(); }}
                />
                <button type="button" className="lp-secondary" disabled={querying} onClick={handleQueryStatus}>
                  {querying ? "查询中…" : "查询进度"}
                </button>
              </div>
              {queryResult && (
                <div className="lp-query__result">
                  {queryResult.found ? (
                    <>
                      <strong>{queryResult.name}</strong>
                      <span>，{STATUS_TEXT[queryResult.status as string] || queryResult.status}</span>
                      {queryResult.reason && <span className="lp-query__reason">原因：{queryResult.reason}</span>}
                    </>
                  ) : (
                    <>未查询到该信用代码对应的注册记录，请核对后重试，或先完成注册。</>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 临时供应商过期续期面板（凭新邀请码延长有效期） */}
          {showReactivate && (
            <div className="lp-pending">
              <p className="lp-pending__hint">临时供应商权限已过期。输入新的邀请码可延长有效期：</p>
              <div className="lp-query">
                <input
                  className="lp-query-input"
                  value={reactivateCode}
                  onChange={(e) => setReactivateCode(e.target.value)}
                  placeholder="请输入新的 8 位邀请码"
                  maxLength={20}
                  onKeyDown={(e) => { if (e.key === "Enter") handleReactivate(); }}
                />
                <button type="button" className="lp-secondary" disabled={reactivating} onClick={handleReactivate}>
                  {reactivating ? "续期中…" : "续期"}
                </button>
              </div>
            </div>
          )}

          <div className="lp-foot">
            <button
              type="button"
              className="lp-foot-pill"
              onClick={() => { setShowQuery(true); setQueryResult(null); }}
            >
              <SearchCheck size={14} strokeWidth={1.9} aria-hidden="true" />
              查询审核进度
            </button>
            <button ref={passwordResetTriggerRef} type="button" className="lp-foot-pill" onClick={openPasswordResetDialog}>
              <KeyRound size={14} strokeWidth={1.9} aria-hidden="true" />
              忘记密码？
            </button>
          </div>

          <section className="lp-onboarding" aria-labelledby="lp-onboarding-title">
            <div className="lp-onboarding-head">
              <h2 id="lp-onboarding-title">首次使用平台？</h2>
              <span>选择适合的注册方式</span>
            </div>
            <div className="lp-register-options">
              <Link href="/register" className="lp-register-option">
                <span className="lp-register-option__icon" aria-hidden="true"><ShieldCheck size={17} strokeWidth={1.8} /></span>
                <span className="lp-register-option__copy">
                  <strong>正式注册</strong>
                  <small>长期合作，完成完整资料入库</small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link href="/register-temporary" className="lp-register-option">
                <span className="lp-register-option__icon" aria-hidden="true"><Clock3 size={17} strokeWidth={1.8} /></span>
                <span className="lp-register-option__copy">
                  <strong>临时注册</strong>
                  <small>已获邀请，凭 8 位邀请码办理</small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
        </section>
      ) : null}
      <PasswordResetRequestDialog
        open={showPasswordReset}
        onClose={() => setShowPasswordReset(false)}
        initialUsername={username}
        returnFocusRef={passwordResetTriggerRef}
      />
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
