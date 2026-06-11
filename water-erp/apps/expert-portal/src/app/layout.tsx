import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import AppShell from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = { title: '专家评审工作站 — 智慧水发ERP', description: '评标专家独立评审工作台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
