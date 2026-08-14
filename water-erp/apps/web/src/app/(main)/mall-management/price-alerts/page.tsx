import { redirect } from 'next/navigation';

// TODO: 旧 URL 兼容壳，待产品确认后删除（分工 v3 清理审计，2026-08-14）
/** 旧子路由兼容壳：实现已收敛至 /mall-management/catalog?tab=alerts */
export default function PriceAlertsPage() {
  redirect('/mall-management/catalog?tab=alerts');
}
