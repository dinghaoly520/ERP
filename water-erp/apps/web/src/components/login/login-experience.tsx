"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { startTransition, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ArrowRight,
  KeyRound,
  LifeBuoy,
  Loader2,
  UserRound,
} from "lucide-react";
import SplashCursor from "@/components/SplashCursor";
import TrueFocus from "@/components/TrueFocus";
import { ForgotPasswordDialog } from "@/components/login/forgot-password-dialog";
import { LoginErrorDialog } from "@/components/login/login-error-dialog";
import { login } from "@/lib/api/auth";
import { fetchUserSettings } from "@/lib/api/user-settings";
import { getPostLoginDestination, getHomePageRoute } from "@/lib/login/login-routing";
import { beginTenderWriteSession, createTenderWriteSessionId } from "@/lib/tender-write/storage";

type LoginFormValues = {
  username: string;
  password: string;
  remember: boolean;
};

const easeOutQuint = [0.22, 1, 0.36, 1] as const;
const loginSplashPalette = ["#7aa8ff", "#f0c676", "#72c7b3"] as const;

type LoginExperienceProps = {
  redirectTo?: string | null;
};

export function LoginExperience({ redirectTo }: LoginExperienceProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showForgotPasswordDialog, setShowForgotPasswordDialog] =
    useState(false);
  const [loginErrorMessage, setLoginErrorMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isValid },
  } = useForm<LoginFormValues>({
    mode: "onChange",
    defaultValues: {
      username: "",
      password: "",
      remember: true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    const username = values.username.trim();
    const password = values.password;
    let hasValidationError = false;

    clearErrors();
    setLoginErrorMessage(null);

    if (username.length < 2) {
      setError("username", {
        type: "manual",
        message: "请输入用户名",
      });
      hasValidationError = true;
    }

    if (password.length < 6) {
      setError("password", {
        type: "manual",
        message: "请输入至少 6 位密码",
      });
      hasValidationError = true;
    }

    if (hasValidationError) {
      return;
    }

    setSubmitting(true);

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      const result = await login({
        username,
        password,
      });
      beginTenderWriteSession(createTenderWriteSessionId());

      // Prefer the redirect param from the middleware (where user was trying to go),
      // falling back to the role-based default destination.
      const destination = redirectTo ?? getPostLoginDestination(result.role, result.username);

      startTransition(() => {
        router.push(destination);
      });
    } catch (error) {
      setLoginErrorMessage(
        error instanceof Error ? error.message : "登录失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="login-stage ambient-grid flex h-full items-center justify-center overflow-hidden px-6 py-6 sm:px-8">
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
        COLOR_PALETTE={loginSplashPalette}
      />
      <div className="login-stage__veil" />

      <motion.div
        initial={reducedMotion ? undefined : { opacity: 0, y: 24 }}
        animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.82, ease: easeOutQuint }}
        className="relative z-[60] w-full max-w-[500px]"
      >
        <motion.div
          initial={reducedMotion ? undefined : { opacity: 0, y: 16 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.72, delay: 0.08, ease: easeOutQuint }}
          className="-mt-6 flex flex-col items-center text-center sm:-mt-9"
        >
          <motion.div
            animate={
              reducedMotion
                ? undefined
                : {
                    y: [0, -10, 0, 4, 0],
                    rotate: [0, -2, 0, 2, 0],
                    scale: [1, 1.06, 1, 1.03, 1],
                  }
            }
            transition={{
              duration: 8.2,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
            className="login-mark"
          >
            <div className="login-mark__halo login-mark__halo--soft" />
            <div className="login-mark__halo login-mark__halo--rich" />
            <div className="login-mark__ring" />
            <Image
              src="/procurement-brand-logo.png"
              alt="智慧水发 · 采购中心"
              width={60}
              height={60}
              className="relative z-10 h-[60px] w-[60px] object-contain"
              priority
            />
          </motion.div>
          <h1 className="login-title mt-4 max-w-[16.5rem] font-[family-name:var(--font-display)] text-[clamp(1.78rem,4.8vw,2.42rem)] font-semibold leading-[1.1] tracking-[-0.065em] text-[color:var(--foreground)] sm:max-w-none">
            智慧水发 · <span className="whitespace-nowrap">采购中心</span>
          </h1>
          <p className="login-slogan mt-5 text-[0.82rem] tracking-[0.28em]">
            坚持原则，坚定立场，坚决执行
          </p>
        </motion.div>

        <motion.form
          initial={reducedMotion ? undefined : { opacity: 0, y: 18 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.78, delay: 0.16, ease: easeOutQuint }}
          className="mx-auto mt-8 flex w-full max-w-[430px] flex-col items-center gap-[1.05rem]"
          onSubmit={onSubmit}
        >
          <motion.div
            initial={reducedMotion ? undefined : { opacity: 0, y: 14 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.66, delay: 0.22, ease: easeOutQuint }}
            className="w-full"
          >
            <div className="w-full">
              <label htmlFor="username" className="sr-only">
                用户名
              </label>
              <div className="login-field-shell">
                <span aria-hidden className="login-field-shell__icon-rail">
                  <UserRound
                    size={16}
                    strokeWidth={1.85}
                    className="login-field-shell__icon"
                  />
                </span>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  placeholder="输入账号"
                  className="login-field-input w-full bg-transparent px-5 pb-4 pl-[3rem] pt-4 text-[15px] text-[color:var(--foreground)] outline-none placeholder:text-[color:rgba(92,112,148,0.46)]"
                  {...register("username")}
                />
                <span aria-hidden className="login-field-shell__line" />
              </div>
              {errors.username ? (
                <p className="pt-2 text-xs text-[color:var(--danger)]">
                  {errors.username.message}
                </p>
              ) : null}
            </div>
          </motion.div>

          <motion.div
            initial={reducedMotion ? undefined : { opacity: 0, y: 14 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.66, delay: 0.3, ease: easeOutQuint }}
            className="w-full"
          >
            <div className="w-full">
              <label htmlFor="password" className="sr-only">
                密码
              </label>
              <div className="login-field-shell">
                <span
                  aria-hidden
                  className="login-field-shell__icon-rail login-field-shell__icon-rail--accent"
                >
                  <KeyRound
                    size={16}
                    strokeWidth={1.85}
                    className="login-field-shell__icon"
                  />
                </span>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="输入密码"
                  className="login-field-input w-full bg-transparent px-5 pb-4 pl-[3rem] pt-4 text-[15px] text-[color:var(--foreground)] outline-none placeholder:text-[color:rgba(92,112,148,0.46)]"
                  {...register("password")}
                />
                <span aria-hidden className="login-field-shell__line" />
              </div>
              {errors.password ? (
                <p className="pt-2 text-xs text-[color:var(--danger)]">
                  {errors.password.message}
                </p>
              ) : null}
            </div>
          </motion.div>

          <motion.div
            initial={reducedMotion ? undefined : { opacity: 0, y: 14 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.66, delay: 0.38, ease: easeOutQuint }}
            className="w-full pt-1"
          >
            <div className="login-action-strip">
              <label className="login-remember inline-flex min-w-0 flex-1 items-center gap-3 text-sm font-medium text-[color:var(--muted-foreground)]">
                <input
                  type="checkbox"
                  className="login-remember__checkbox"
                  {...register("remember")}
                />
                <span className="truncate">记住密码</span>
              </label>
              <button
                type="button"
                onClick={() => setShowForgotPasswordDialog(true)}
                className="login-utility-button inline-flex items-center justify-end gap-2 font-medium text-[color:var(--muted-foreground)]"
              >
                忘记密码
                <LifeBuoy size={14} strokeWidth={1.9} className="opacity-80" />
              </button>
            </div>
          </motion.div>

          <motion.button
            initial={reducedMotion ? undefined : { opacity: 0, y: 14 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.66, delay: 0.46, ease: easeOutQuint }}
            type="submit"
            aria-label={submitting ? "登录中" : "登录"}
            disabled={!isValid || submitting}
            whileHover={reducedMotion ? undefined : { y: -2, scale: 1.02 }}
            whileTap={reducedMotion ? undefined : { scale: 0.98 }}
            className="login-submit-button inline-flex w-full self-center items-center justify-center gap-2 rounded-[20px] px-6 py-4 text-sm font-semibold text-[color:var(--foreground)] transition-opacity duration-200 hover:opacity-96 disabled:cursor-not-allowed disabled:opacity-36"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                登录中
              </>
            ) : (
              <>
                <span className="login-submit-label">登录</span>
                <ArrowRight size={16} className="opacity-80" />
              </>
            )}
          </motion.button>

          <motion.div
            initial={reducedMotion ? undefined : { opacity: 0, y: 12 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.62, delay: 0.54, ease: easeOutQuint }}
            className="login-credit pt-2 text-center"
          >
            {reducedMotion ? (
              <span className="login-credit__static">水电科研院 制</span>
            ) : (
              <TrueFocus
                sentence="水|电|科|研|院|制"
                separator="|"
                manualMode={false}
                blurAmount={3}
                borderColor="#7aa8ff"
                glowColor="rgba(122, 168, 255, 0.18)"
                animationDuration={0.5}
                pauseBetweenAnimations={1}
              />
            )}
          </motion.div>
        </motion.form>
      </motion.div>

      <ForgotPasswordDialog
        isOpen={showForgotPasswordDialog}
        onClose={() => setShowForgotPasswordDialog(false)}
      />
      <LoginErrorDialog
        isOpen={Boolean(loginErrorMessage)}
        message={loginErrorMessage ?? ""}
        onClose={() => setLoginErrorMessage(null)}
      />
    </div>
  );
}
