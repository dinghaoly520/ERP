import { redirect } from 'next/navigation';

/** 旧子路由兼容壳：实现已收敛至 /mall-management/catalog?tab=logs */
export default function CatalogLogsPage() {
  redirect('/mall-management/catalog?tab=logs');
}
