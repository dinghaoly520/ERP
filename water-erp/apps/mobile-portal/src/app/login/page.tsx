"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight, Eye, EyeOff, KeyRound, Loader2, MessageSquare, Smartphone } from "lucide-react";
import SplashCursor from "@/components/m/splash-cursor";
import { TrueFocus } from "@/components/m/true-focus";
import { mobileLogin, mobilePasswordLogin, sendMobileLoginCode } from "@/lib/api/auth";
import { clearWebToken } from "@/lib/session-store";

/**
 * 登录页（2026-11-23 用户裁定：手机号+短信验证码登录）——视觉整套保留 2026-11-19 重制版
 * （:3005 LoginExperience 移植：光芒背景 / SplashCursor / 徽标 / 彩色流转标题 / 瓷面输入壳 /
 * 流光落款），登录逻辑换轨：
 * · 19981208777 → 王华董事长、13882199205 → 张宏董事长：短信验证码登录（60s 冷却）
 * · 13368360619 → 固定密码 123456（不走短信）
 * · 名单外手机号：获取验证码即报「该手机号不在登录名单中，无法接收短信验证码」
 * 白名单与账号 find-or-create 在后端（/auth/mobile/*，见 auth.service）。
 */

const loginSplashPalette = ["#7aa8ff", "#f0c676", "#72c7b3"] as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** 固定密码白名单号（不走短信；口令由用户输入） */
const PASSWORD_PHONE = "13368360619";
const PHONE_RE = /^1\d{10}$/;

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** framer-motion useReducedMotion 的零依赖等价（SSR/首帧 false，挂载后对齐系统设置） */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

export default function LoginPage() {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<"phone" | "sms" | "password">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /* proxy 闸踢回的无权会话（?denied=1）——挂载后读取，避免 SSR/hydration 不一致 */
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    setDenied(new URLSearchParams(window.location.search).get("denied") === "1");
  }, []);

  /* 验证码冷却倒计时（纯客户端计时；服务端 60s 冷却为准，倒计时到 0 才亮重发） */
  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  const phoneValid = PHONE_RE.test(phone.trim());

  function handleRedirect() {
    // proxy 鉴权闸带来的回跳参数（深链 query 不丢，同 web 口径）
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    router.replace(redirect && redirect.startsWith("/") ? redirect : "/dashboard");
  }

  /* 第一步：手机号 → 固定密码号切密码态；其余发短信（后端名单外报「无法接收短信」） */
  async function handlePhoneNext(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!phoneValid) {
      setError("请输入 11 位手机号");
      return;
    }
    setError(null);
    const trimmed = phone.trim();
    if (trimmed === PASSWORD_PHONE) {
      setMode("password");
      return;
    }
    setLoading(true);
    try {
      await sendMobileLoginCode(trimmed);
      setCode("");
      setMode("sms");
      setCountdown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "短信发送失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  /* 重发短信（sms 态内；与首发同端点，冷却由后端 60s 把关） */
  async function handleResend() {
    if (loading || countdown > 0) return;
    setError(null);
    setLoading(true);
    try {
      await sendMobileLoginCode(phone.trim());
      setCountdown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "短信发送失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  /* 第二步：短信码登录 */
  async function handleSmsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!code.trim()) {
      setError("请输入短信验证码");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await mobileLogin(phone.trim(), code.trim());
      if (result.role !== "admin") {
        clearWebToken();
        setError("该账号无权访问移动驾驶舱");
        return;
      }
      handleRedirect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  /* 固定密码登录（13368360619） */
  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!password) {
      setError("请输入密码");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await mobilePasswordLogin(phone.trim(), password);
      if (result.role !== "admin") {
        clearWebToken();
        setError("该账号无权访问移动驾驶舱");
        return;
      }
      handleRedirect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-stage ambient-grid flow-page flex min-h-dvh flex-col items-center justify-center overflow-x-hidden px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8">
      <div aria-hidden className="login-stage__rays">
        <div className="login-stage__ray login-stage__ray--far-left" />
        <div className="login-stage__ray login-stage__ray--left" />
        <div className="login-stage__ray login-stage__ray--center" />
        <div className="login-stage__ray login-stage__ray--right" />
        <div className="login-stage__ray login-stage__ray--far-right" />
      </div>
      <SplashCursor
        SIM_RESOLUTION={128}
        DYE_RESOLUTION={1408}
        DENSITY_DISSIPATION={3.5}
        VELOCITY_DISSIPATION={2}
        PRESSURE={0.1}
        CURL={3}
        SPLAT_RADIUS={0.15}
        SPLAT_FORCE={3000}
        COLOR_UPDATE_SPEED={10}
        COLOR_PALETTE={[...loginSplashPalette]}
      />
      <div aria-hidden className="login-stage__veil" />

      <div className="login-rise relative z-[60] w-full max-w-[430px]">
        <div className="login-rise--1 -mt-6 flex flex-col items-center text-center">
          <div className="login-mark">
            <div className="login-mark__halo login-mark__halo--soft" />
            <div className="login-mark__halo login-mark__halo--rich" />
            <div className="login-mark__ring" />
            <Image
              src="/procurement-brand-logo.png"
              alt="蜀水云采 · 移动驾驶舱"
              width={60}
              height={60}
              className="relative z-10 h-[60px] w-[60px] object-contain"
              priority
            />
          </div>
          <h1 className="login-title login-title--gradient mt-4 text-[clamp(1.55rem,7.2vw,2.3rem)] font-black leading-[1.15] tracking-[0.06em]">
            蜀水云采·专属驾驶舱
          </h1>
          <p className="login-slogan mt-5 text-[0.82rem] tracking-[0.28em]">坚持原则，坚定立场，坚决执行</p>
        </div>

        {/* proxy 闸踢回的无权会话——引导改用授权手机号（有表单错误时让位给 error） */}
        {denied && !error ? <p className="login-notice mt-6 w-full">当前账号无权访问移动驾驶舱，请使用授权手机号登录</p> : null}

        <form
          onSubmit={mode === "sms" ? handleSmsSubmit : mode === "password" ? handlePasswordSubmit : handlePhoneNext}
          className="mx-auto mt-8 flex w-full flex-col items-center gap-[1.05rem]"
          noValidate
        >
          {/* 手机号：三态常驻（sms/password 态只读展示，点「更改」回第一步） */}
          <div className="login-rise--2 w-full">
            <label htmlFor="login-phone" className="sr-only">
              手机号
            </label>
            <div className="login-field-shell">
              <span aria-hidden className="login-field-shell__icon-rail">
                <Smartphone size={16} strokeWidth={1.85} className="login-field-shell__icon" />
              </span>
              <input
                id="login-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                inputMode="numeric"
                autoComplete="tel"
                disabled={mode !== "phone"}
                placeholder="输入手机号"
                className="login-field-input w-full bg-transparent px-5 pb-4 pl-[3rem] pt-4 text-[16px] tracking-[0.02em] text-[color:var(--foreground)] outline-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground)_55%,transparent)] disabled:opacity-70"
              />
              {mode !== "phone" ? (
                <button
                  type="button"
                  onClick={() => { setMode("phone"); setError(null); }}
                  className="login-field-toggle text-[13px] font-semibold"
                >
                  更改
                </button>
              ) : null}
              <span aria-hidden className="login-field-shell__line" />
            </div>
          </div>

          {/* 短信验证码态：验证码输入 + 冷却重发 */}
          {mode === "sms" ? (
            <div className="login-rise--3 w-full">
              <label htmlFor="login-code" className="sr-only">
                短信验证码
              </label>
              <div className="login-field-shell">
                <span aria-hidden className="login-field-shell__icon-rail login-field-shell__icon-rail--accent">
                  <MessageSquare size={16} strokeWidth={1.85} className="login-field-shell__icon" />
                </span>
                <input
                  id="login-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="输入短信验证码"
                  className="login-field-input w-full bg-transparent px-5 pb-4 pl-[3rem] pr-[6.5rem] pt-4 text-[16px] tracking-[0.2em] text-[color:var(--foreground)] outline-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground)_55%,transparent)]"
                />
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={countdown > 0 || loading}
                  aria-label={countdown > 0 ? `${countdown} 秒后可重发验证码` : "重新发送验证码"}
                  className="login-field-toggle w-auto min-w-[5.5rem] text-[13px] font-semibold text-[color:var(--accent)] disabled:text-[color-mix(in_oklch,var(--muted-foreground)_60%,transparent)]"
                >
                  {countdown > 0 ? `${countdown}s 后重发` : "重新发送"}
                </button>
                <span aria-hidden className="login-field-shell__line" />
              </div>
            </div>
          ) : null}

          {/* 固定密码态（13368360619） */}
          {mode === "password" ? (
            <div className="login-rise--3 w-full">
              <label htmlFor="login-password" className="sr-only">
                密码
              </label>
              <div className="login-field-shell">
                <span aria-hidden className="login-field-shell__icon-rail login-field-shell__icon-rail--accent">
                  <KeyRound size={16} strokeWidth={1.85} className="login-field-shell__icon" />
                </span>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="输入密码"
                  className="login-field-input w-full bg-transparent pb-4 pl-[3rem] pr-[3.25rem] pt-4 text-[16px] text-[color:var(--foreground)] outline-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground)_55%,transparent)]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="login-field-toggle"
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={1.85} /> : <Eye size={16} strokeWidth={1.85} />}
                </button>
                <span aria-hidden className="login-field-shell__line" />
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="login-error w-full">
              {error}
            </p>
          ) : null}

          {/* 按钮不直接挂入场动画（fill both 会压住 :active transform）——外层 wrapper 承载错落上滑 */}
          <div className={mode === "phone" ? "login-rise--4 w-full" : "w-full"}>
            <button
              type="submit"
              aria-label={loading ? (mode === "phone" ? "发送中" : "登录中") : mode === "phone" ? "获取验证码" : "登录"}
              disabled={loading}
              className="login-submit-button inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[20px] text-[15px] font-semibold text-[color:var(--foreground)]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  {mode === "phone" ? "发送中" : "登录中"}
                </>
              ) : (
                <>
                  <span className="login-submit-label">{mode === "phone" ? "获取验证码" : "登录"}</span>
                  <span className="login-arrow-badge">
                    <ChevronRight size={14} strokeWidth={2.5} />
                  </span>
                </>
              )}
            </button>
          </div>

          <div className="login-rise--5 login-credit pt-2 text-center">
            {reducedMotion ? (
              <span className="login-credit__static">四川省水利发展集团有限公司　制</span>
            ) : (
              <TrueFocus
                sentence="四|川|省|水|利|发|展|集|团|有|限|公|司| |制"
                separator="|"
                blurAmount={3}
                borderColor="#7aa8ff"
                glowColor="rgba(122, 168, 255, 0.18)"
                animationDuration={0.5}
                pauseBetweenAnimations={1}
              />
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
