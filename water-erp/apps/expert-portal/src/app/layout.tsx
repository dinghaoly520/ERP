import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/sw-register';
import './globals.css';

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
          {`(function(){
            if (document.cookie.indexOf('device_mode=') !== -1) return;
            var ua = navigator.userAgent;
            var uaTablet = /iPad|PlayBook|Kindle|Silk|KFAPWI|Tablet|CrOS/i.test(ua);
            var androidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
            var touchTablet = navigator.maxTouchPoints > 1 && !/Mobile/i.test(ua);
            var isTablet = uaTablet || androidTablet || touchTablet;
            if (!isTablet) return;
            if (location.pathname === '/tablet' || location.pathname.indexOf('/tablet/') === 0 || location.pathname === '/login') return;
            document.cookie = 'device_mode=tablet;path=/;max-age=604800;SameSite=Lax';
            location.replace('/tablet');
          })()`}
        </Script>
        {children}
        <Toaster position="top-right" richColors closeButton />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
