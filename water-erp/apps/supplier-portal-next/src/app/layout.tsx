import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import "./globals.css";
import { Providers } from "@/components/providers";

const BG_POOL = ["login-bg-1.jpg", "login-bg-2.jpg", "login-bg-3.jpg"];
const BG_COOKIE = "supplier_bg";

export const metadata: Metadata = {
  title: "供应商门户-蜀水云采·智慧水发",
  description: "蜀水云采·智慧水发 供应商门户 — 注册入驻、投标、企业档案管理",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // proxy 写入的随机背景 cookie（首次访问游客页时确定）：SSR 首帧即最终图，无切换闪烁。
  // 通过 CSS 变量注入，.lp-bg / .reg-bg 用 var(--login-bg) 承载；bg-3 时 html 挂 .bg-panel-left 让面板左移。
  let bg = BG_POOL[0];
  try {
    const store = await cookies();
    const v = store.get(BG_COOKIE)?.value;
    if (v && BG_POOL.includes(v)) bg = v;
  } catch {
    /* 无 cookie 时用默认图 */
  }
  return (
    <html
      lang="zh-CN"
      className={`h-full antialiased font-sans${bg === "login-bg-3.jpg" ? " bg-panel-left" : ""}`}
      style={{ "--login-bg": `url('/${bg}')` } as React.CSSProperties}
    >
      <body className="h-full overflow-hidden">
        <Providers>
          {/* cgzxui 水彩光晕（web 设计系统 .flow-glow）作为玻璃面板背后漂移的色彩层 */}
          <div className="app-root">
            <div className="flow-glow" aria-hidden />
            <div className="app-root__content h-full">{children}</div>
          </div>
        </Providers>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
