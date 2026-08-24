import { redirect } from "next/navigation";

// 注册审核已并入账号管理（2026-08-21 三合一），旧链接重定向
export default function RegistrationReviewPage() {
  redirect("/admin/accounts");
}
