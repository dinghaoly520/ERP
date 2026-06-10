import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '智慧水发·招采ERP系统',
  description: '四川水发集团电子化招标采购平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
