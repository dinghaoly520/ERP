import type { Metadata } from "next";
// dev fetch 守护须在登录请求前安装（/api GET 超时自救）
import "@/lib/dev-fetch-guard";
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
