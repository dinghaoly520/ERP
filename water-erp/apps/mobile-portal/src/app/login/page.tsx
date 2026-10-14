"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Eye, EyeOff, KeyRound, UserRound } from "lucide-react";
import { login } from "@/lib/api/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!username.trim() || !password) {
      setError("请输入账号与密码");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
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
    <div className="flow-page ambient-grid flex min-h-dvh flex-col items-center justify-center px-5">
      <div className="flow-glow" aria-hidden />
      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-[18px] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(238,244,255,0.86))] shadow-[0_14px_34px_rgba(69,99,158,0.20)]">
            <Image
              src="/procurement-brand-logo.png"
              alt="蜀水云采·智慧水发"
              width={56}
              height={56}
              className="rounded-[13px] object-cover"
              priority
            />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-[0.05em] text-[var(--foreground)]">蜀水云采 · 移动驾驶舱</h1>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">数据库 · 台账 · 进展，随时掌握采购全局</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="neu-card-static relative rounded-[20px] p-5" noValidate>
          <label htmlFor="login-username" className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
            账号
          </label>
          <div className="relative mt-2">
            <UserRound size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              id="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="请输入账号"
              className="m-input h-12 w-full pl-10"
            />
          </div>

          <label htmlFor="login-password" className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
            密码
          </label>
          <div className="relative mt-2">
            <KeyRound size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
              className="m-input h-12 w-full pl-10 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-[var(--muted-foreground)] active:scale-95"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error ? (
            <p className="mt-3 rounded-[10px] border border-[color-mix(in_oklch,var(--danger)_22%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs font-medium text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={loading} className="neu-btn-primary mt-5 h-12 w-full rounded-[14px] text-[15px] font-semibold disabled:opacity-60">
            {loading ? "登录中..." : "登 录"}
          </button>
        </form>
      </div>
    </div>
  );
}
