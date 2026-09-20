import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import SplashCursor from '@/components/splash-cursor';
import './globals.css';

export const metadata: Metadata = {
  title: '蜀水云采·智慧水发',
  description: '蜀水云采·智慧水发 — 集团全域智能数据洞察、业务分析与协同操作平台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Toaster position="top-center" richColors closeButton />
        <SplashCursor />
      </body>
    </html>
  );
}
