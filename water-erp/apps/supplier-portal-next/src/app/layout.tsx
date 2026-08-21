import type { Metadata } from "next";
import { DM_Sans, Plus_Jakarta_Sans, Geist } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Providers } from "@/components/providers";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "供应商门户-智慧水发·蜀水云采",
  description: "智慧水发·蜀水云采 供应商门户 — 注册入驻、投标、企业档案管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={cn("h-full", "antialiased", plusJakartaSans.variable, dmSans.variable, "font-sans", geist.variable)}
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
