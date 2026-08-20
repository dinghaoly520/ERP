import { redirect } from "next/navigation";

// 根路径 → 工作台（与 Vue 版 router redirect: '/' → '/dashboard' 一致）
export default function RootPage() {
  redirect("/dashboard");
}
