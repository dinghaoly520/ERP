'use client';

/**
 * 供应商审批（2026-09-29 窗口化）：审批中心已改为浮窗（右上角/供应商库「审批」按钮触发，
 * 宿主在 app-shell 的全局按钮）。本路由保留为深链薄壳——进入即拉起审批中心窗口，关闭回供应商库。
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SupplierApprovalEntryPage() {
  const router = useRouter();
  useEffect(() => {
    window.dispatchEvent(new Event('open-review-center'));
    router.replace('/supplier/repository');
  }, [router]);
  return (
    <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">
      正在打开供应商审批中心…
    </div>
  );
}
