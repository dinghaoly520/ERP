import type { Metadata } from "next";
import { DM_Sans, Plus_Jakarta_Sans, Geist } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "采购中心办公管理系统",
  description: "采购中心部门级办公系统起步版",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={cn("h-full", "antialiased", plusJakartaSans.variable, dmSans.variable, "font-sans", geist.variable)}
    >
      <body className="h-full overflow-hidden">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
