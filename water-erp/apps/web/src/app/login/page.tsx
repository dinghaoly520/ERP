import type { Metadata } from "next";
import { LoginExperience } from "@/components/login/login-experience";

export const metadata: Metadata = {
  title: "安全登录 | 采购中心办公管理系统",
  description: "采购中心管理驾驶舱登录入口",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const params = await searchParams;
  return <LoginExperience redirectTo={params.redirect ?? null} />;
}
