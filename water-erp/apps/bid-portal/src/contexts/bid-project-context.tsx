'use client';

import { createContext, useContext, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

/**
 * 项目工作区路由上下文——仅派生 projectId（路由参数 [id] 优先，旧 ?id= 查询兜底）。
 * O1（2026-08-28）：删除 provider 内的项目详情拉取——工作区页（page.tsx）本就自持唯一
 * 显示源并全量拉取，provider 的副本仅被 ScoreStandardView 作 propsProject 回退消费
 * （实际恒有 props），留着只会在挂载时多发一次 GET /bid/projects/:id。
 */

export interface BidProjectContextValue {
  projectId: string | null;
}

const BidProjectContext = createContext<BidProjectContextValue>({ projectId: null });

export function useBidProjectContext() {
  return useContext(BidProjectContext);
}

export function BidProjectProvider({ children }: { children: React.ReactNode }) {
  // useSearchParams 需要 Suspense 边界（否则预渲染报错、且客户端导航不触发重算）
  return (
    <Suspense fallback={null}>
      <BidProjectProviderInner>{children}</BidProjectProviderInner>
    </Suspense>
  );
}

function BidProjectProviderInner({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const searchParams = useSearchParams();
  // 项目工作区经路由参数 [id] 指定项目（useParams 全响应式）
  const id = (params?.id as string | undefined) ?? (searchParams.get('id') ?? undefined);

  return <BidProjectContext.Provider value={{ projectId: id ?? null }}>{children}</BidProjectContext.Provider>;
}
