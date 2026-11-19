"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight, Eye, EyeOff, KeyRound, Loader2, UserRound } from "lucide-react";
import SplashCursor from "@/components/m/splash-cursor";
import { TrueFocus } from "@/components/m/true-focus";
import { login } from "@/lib/api/auth";
import { clearWebToken } from "@/lib/session-store";

/**
 * 登录页（2026-11-19 重制，spec 2026-11-19-mobile-3011-login-3005-style）：
 * 设计整套移植自 :3005 LoginExperience（apps/web/src/components/login/login-experience.tsx）
 * ——光芒背景 / SplashCursor 流体墨迹 / 徽标浮动 / 彩色流转标题 / 流光口号 /
 * 瓷面输入壳 / 瓷面登录钮 / TrueFocus 逐字落款 / 错落上滑入场。
 * 零依赖路线：framer-motion 的入场与浮动改 CSS（globals.css login 段），
 * TrueFocus 为 framer-motion-free 移植版；登录/redirect 逻辑沿用 3011 原口径。
 */

const loginSplashPalette = ["#7aa8ff", "#f0c676", "#72c7b3"] as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /* proxy 闸踢回的非 admin 会话（?denied=1）——挂载后读取，避免 SSR/hydration 不一致 */
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    setDenied(new URLSearchParams(window.location.search).get("denied") === "1");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    /* 门户账号白名单（2026-11-19 用户裁定）：:3011 仅放行 admin 账号——提交前拦，
       不发登录请求（proxy 闸兜 :3005 侧登录复用 cookie 的旁路） */
    if (username.trim() !== "admin") {
      setError("移动驾驶舱仅限管理员账号（admin）登录");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (result.role !== "admin") {
        /* 兜底：admin 账号被改角色的极端情形——清会话留提示，不进门户 */
        clearWebToken();
        setError("该账号无权访问移动驾驶舱");
        return;
      }
      // proxy 鉴权闸带来的回跳参数（深链 query 不丢，同 web 口径）
      const redirect = new URLSearchParams(window.location.search).get("redirect");
      router.replace(redirect && redirect.startsWith("/") ? redirect : "/dashboard");
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

        {/* proxy 闸踢回的非 admin 会话——引导改用 admin 账号（有表单错误时让位给 error） */}
        {denied && !error ? <p className="login-notice mt-6 w-full">当前账号无权访问移动驾驶舱，请使用 admin 账号登录</p> : null}

        <form onSubmit={handleSubmit} className="mx-auto mt-8 flex w-full flex-col items-center gap-[1.05rem]" noValidate>
          <div className="login-rise--2 w-full">
            <label htmlFor="login-username" className="sr-only">
              账号
            </label>
            <div className="login-field-shell">
              <span aria-hidden className="login-field-shell__icon-rail">
                <UserRound size={16} strokeWidth={1.85} className="login-field-shell__icon" />
              </span>
              <input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="输入账号"
                className="login-field-input w-full bg-transparent px-5 pb-4 pl-[3rem] pt-4 text-[16px] text-[color:var(--foreground)] outline-none placeholder:text-[color-mix(in_oklch,var(--muted-foreground)_55%,transparent)]"
              />
              <span aria-hidden className="login-field-shell__line" />
            </div>
          </div>

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

          {error ? (
            <p role="alert" className="login-error w-full">
              {error}
            </p>
          ) : null}

          {/* 按钮不直接挂入场动画（fill both 会压住 :active transform）——外层 wrapper 承载错落上滑 */}
          <div className="login-rise--4 w-full">
            <button
              type="submit"
              aria-label={loading ? "登录中" : "登录"}
              disabled={loading}
              className="login-submit-button inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[20px] text-[15px] font-semibold text-[color:var(--foreground)]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  登录中
                </>
              ) : (
                <>
                  <span className="login-submit-label">登录</span>
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
