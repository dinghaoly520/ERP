'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface SlimProject {
  id: string;
}

export function useBidProjects() {
  const [projects, setProjects] = useState<SlimProject[]>([]);
  const [projectId, setProjectId] = useState('');

  useEffect(() => {
    api.get<SlimProject[]>('/bid/projects')
      .then(ps => {
        setProjects(ps);
        if (ps.length && !projectId) setProjectId(ps[0].id);
      })
      .catch((e: any) => {
        if (e?.status !== 401) toast.error(e?.message || '加载项目列表失败');
      });
  }, []);

  return { projects, projectId, setProjectId };
}
