'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function useBidProject<T>(projectId: string, opts?: { pollIntervalMs?: number; enabled?: boolean }) {
  const [project, setProject] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    api.get<T>(`/bid/projects/${projectId}`)
      .then(p => setProject(p))
      .catch((e: any) => {
        if (e?.status !== 401) toast.error(e?.message || '加载项目详情失败');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [projectId]);

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (opts?.pollIntervalMs && opts?.enabled !== false) {
      intervalRef.current = setInterval(load, opts.pollIntervalMs);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [projectId, opts?.pollIntervalMs, opts?.enabled]);

  return { project, loading, reload: load };
}
