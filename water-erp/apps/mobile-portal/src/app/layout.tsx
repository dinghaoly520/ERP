import type { Metadata, Viewport } from "next";
import { DM_Sans, Plus_Jakarta_Sans, Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const body = Plus_Jakarta_Sans({ variable: "--font-body", subsets: ["latin"] });
const display = DM_Sans({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "移动驾驶舱-蜀水云采·智慧水发",
  description: "采购驾驶舱移动端：数据库、台账、进展",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`h-full antialiased ${body.variable} ${display.variable} ${geist.variable} font-sans`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
