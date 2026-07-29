'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import { addRecentProject, removeRecentProject } from '@/lib/storage';

export interface BidProjectContextValue {
  projectId: string | null;
  project: BidProjectDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const BidProjectContext = createContext<BidProjectContextValue>({
  projectId: null,
  project: null,
  isLoading: false,
  error: null,
  refetch: () => {},
});

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

  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef<string | undefined>(undefined);

  const fetchProject = useCallback(async (projectId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(data);
      // 写入最近项目
      addRecentProject({
        id: data.id,
        projectCode: data.projectCode || '',
        name: data.name,
      });
    } catch (e: any) {
      if (e?.status === 404) {
        setError('项目不存在或已被删除');
        removeRecentProject(projectId);
      } else {
        setError(e?.message || '加载项目失败');
      }
      setProject(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setProject(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    // 避免重复请求同一个 id
    if (fetchIdRef.current === id && project) return;
    fetchIdRef.current = id;
    fetchProject(id);
  }, [id, fetchProject, project]);

  const refetch = useCallback(() => {
    if (id) fetchProject(id);
  }, [id, fetchProject]);

  return (
    <BidProjectContext.Provider
      value={{
        projectId: id ?? null,
        project,
        isLoading,
        error,
        refetch,
      }}
    >
      {children}
    </BidProjectContext.Provider>
  );
}
