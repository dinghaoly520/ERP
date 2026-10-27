import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/sw-register';
import './globals.css';

// 平板 UA/触摸自动检测已删（2026-10-19）：maxTouchPoints 兜底命中触摸屏笔记本、CrOS 命中
// Chromebook，误判写 7 天 device_mode cookie 把台式机锁进平板模式。2026-10-26 自动改道亦删
//（proxy isTabletMode/平板隔离/X-Forwarded-Device 头判定移除）——/tablet 与桌面路由互为直接
// 入口，cookie 仅翻转登录页链接文案；进入平板 = 扫码迁移（/tablet/claim）或登录页链接/直链。
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
