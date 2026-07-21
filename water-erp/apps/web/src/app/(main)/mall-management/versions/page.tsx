import { redirect } from 'next/navigation';

/** 旧子路由兼容壳：实现已收敛至 /mall-management/catalog?tab=versions */
export default function VersionsPage() {
  redirect('/mall-management/catalog?tab=versions');
}
