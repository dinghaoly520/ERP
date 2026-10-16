import { redirect } from 'next/navigation';

/** 供应商域索引：转跳供应商库。查询参数须透传——
 *  加入审批通知深链 /supplier?tab=company-links（2026-10-16）依赖 ?tab= 带到
 *  /supplier/repository 才能拉起审批中心「加入审批」panel。 */
export default async function SupplierIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' && params.tab ? `?tab=${encodeURIComponent(params.tab)}` : '';
  redirect(`/supplier/repository${tab}`);
}
