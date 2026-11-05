import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = { title: '信息门户-蜀水云采·智慧水发', description: '四川省水利发展集团有限公司电子招标采购平台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 2026-11-05 修复：移除 Google Fonts 外链——fonts.googleapis.com 大陆不可达时 render-blocking，
            首屏白屏直至超时；Manrope 全项目零引用，Noto Serif SC 在 globals.css 已有本地宋体 fallback 链 */}
      </head>
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
