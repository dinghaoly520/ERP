import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/sw-register';
import './globals.css';

// 平板 UA/触摸自动检测已删（2026-10-19，触摸屏笔记本/Chromebook 误判）；2026-10-26 自动改道亦删
//（isTabletMode 等判定移除）——/tablet 与桌面互为直接入口，cookie 仅翻链接文案；进入平板=扫码迁移或登录页链接/直链。
// 勿给可变字体加显式 weight 数组（2026-11-23）：Google CSS API 对离散字重查询现返回同一 woff2 URL×4 份
//（4 字重×4 子集=16 块仅 4 个 URL），Turbopack 字体替换器按 query 查 import map 断言「恰一条」即炸
//——Docker 镜像构建 16 错实录。不传 weight=可变字体轴、URL 唯一；web/mobile 同字体无 weight 恒绿。
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-body',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '在线开评标系统-蜀水云采·智慧水发',
  description: '评标专家独立评审工作台',
  manifest: '/manifest.webmanifest',
  applicationName: '专家评标',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '专家评标',
  },
  icons: {
    icon: [
      { url: '/assets/logo.png', sizes: '192x192', type: 'image/png' },
      { url: '/assets/logo.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/assets/logo.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#064ea2',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={plusJakartaSans.variable}>
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
