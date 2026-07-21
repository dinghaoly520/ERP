import { redirect } from 'next/navigation';

/** 旧子路由兼容壳：KPI/浏览能力已在 /mall-management/catalog 的 page-hero 与各页签中，避免重复 */
export default function CentralCatalogPage() {
  redirect('/mall-management/catalog');
}
