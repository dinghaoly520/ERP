import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { TABLET_UA_RE, ANDROID_RE, MOBILE_RE } from '@/lib/device';
import './globals.css';

/**
 * 客户端先行分流脚本（正则源取自 @/lib/device，与 proxy.ts / login 共用一份定义）。
 * 逐项等价：uaTablet || androidTablet || touchTablet（maxTouchPoints 兜底 iPadOS 13+ 伪装 Mac UA）。
 */
const TABLET_DETECT_SCRIPT = `(function(){
  if (document.cookie.indexOf('device_mode=') !== -1) return;
  var ua = navigator.userAgent;
  var uaTablet = /${TABLET_UA_RE.source}/i.test(ua);
  var androidTablet = /${ANDROID_RE.source}/i.test(ua) && !/${MOBILE_RE.source}/i.test(ua);
  var touchTablet = navigator.maxTouchPoints > 1 && !/${MOBILE_RE.source}/i.test(ua);
  var isTablet = uaTablet || androidTablet || touchTablet;
  if (!isTablet) return;
  if (location.pathname === '/tablet' || location.pathname.indexOf('/tablet/') === 0 || location.pathname === '/login' || location.pathname.indexOf('/invitation') === 0 || location.pathname.indexOf('/rsvp') === 0) return;
  document.cookie = 'device_mode=tablet;path=/;max-age=604800;SameSite=Lax';
  location.replace('/tablet');
})()`;

export const metadata: Metadata = {
  title: '在线开评标系统-智慧水发·蜀水云采',
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
    <html lang="zh-CN">
      <body>
        {/* iPadOS 13+ 伪装 Mac UA，中间件无法识别 → 客户端检测先行分流。
            beforeInteractive 确保 React hydrate 之前执行，避免桌面仪表盘闪烁。 */}
        <Script id="tablet-detect" strategy="beforeInteractive">
          {TABLET_DETECT_SCRIPT}
        </Script>
        {children}
        <Toaster position="top-right" richColors closeButton />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
