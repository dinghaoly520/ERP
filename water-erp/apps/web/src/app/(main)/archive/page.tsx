import { redirect } from "next/navigation";

// 归档管理已并入采购台账卡片（2026-09-30）：/archive 独立页删除。
// 历史通知深链 /archive?pmi=<id> 与书签永久重定向并透传，供台账自动开「归档卷」弹窗。
export default async function ArchiveRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ pmi?: string }>;
}) {
  const { pmi } = await searchParams;
  redirect(pmi ? `/procurements?archivePmi=${encodeURIComponent(pmi)}` : "/procurements");
}
