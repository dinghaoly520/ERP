import { redirect } from "next/navigation";

// 密码审批已并入账号管理（2026-08-21 三合一），旧链接重定向
export default function PasswordRequestsPage() {
  redirect("/admin/accounts");
}
