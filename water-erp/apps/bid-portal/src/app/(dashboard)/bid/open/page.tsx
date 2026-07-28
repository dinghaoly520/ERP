'use client';

/** 兼容重定向：旧直达链接 /bid/open?id=<id> → 项目工作区 open tab。 */

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TableSkeleton } from '@/components/skeleton';

function RedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('id');
    router.replace(id ? `/bid/project/${id}?tab=open` : '/bid');
  }, [router, searchParams]);
  return <TableSkeleton rows={6} cols={6} />;
}

export default function BidOpenRedirectPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} cols={6} />}>
      <RedirectInner />
    </Suspense>
  );
}
