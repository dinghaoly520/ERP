import { redirect } from 'next/navigation';

/** 旧子路由兼容壳：实现（富审批表单）已收敛至 /mall-management/catalog?tab=approval */
export default function PriceApprovalPage() {
  redirect('/mall-management/catalog?tab=approval');
}
