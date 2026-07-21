import { redirect } from 'next/navigation';

/** 旧子路由兼容壳：实现已收敛至 /mall-management/catalog?tab=tree */
export default function CategoryTreePage() {
  redirect('/mall-management/catalog?tab=tree');
}
