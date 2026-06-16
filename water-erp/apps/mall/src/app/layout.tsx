import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import './globals.css';
import { ErrorBoundary, GlobalErrorHandler } from './interactions';
import { MotionConfig } from 'framer-motion';

export const metadata: Metadata = {
  title: '电子商城-智慧水发·蜀水云采',
  description: '四川省水利发展集团集中采购目录价格参考平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ErrorBoundary resetKey="/">
          <GlobalErrorHandler>
            <MotionConfig reducedMotion="user">
              {children}
            </MotionConfig>
          </GlobalErrorHandler>
        </ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
