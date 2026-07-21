import { redirect } from 'next/navigation';

/** 旧子路由兼容壳：实现（含逐字段校验）已收敛至 /mall-management/catalog?tab=entry */
export default function PriceEntryPage() {
  redirect('/mall-management/catalog?tab=entry');
}
