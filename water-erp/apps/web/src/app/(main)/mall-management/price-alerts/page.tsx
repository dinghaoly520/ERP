import { redirect } from 'next/navigation';

/** 旧子路由兼容壳：实现已收敛至 /mall-management/catalog?tab=alerts */
export default function PriceAlertsPage() {
  redirect('/mall-management/catalog?tab=alerts');
}
