import { redirect } from 'next/navigation';

/* 2026-10-30：操作日志并入系统健康页（分区 Tab）——旧路由服务端重定向保持深链兼容
   （仿 registration-review → /admin/accounts 先例） */
export default function OperationLogRedirectPage() {
  redirect('/admin/health?tab=log');
}
