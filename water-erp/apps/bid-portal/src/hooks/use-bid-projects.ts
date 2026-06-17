'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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
      .catch(() => {});
  }, []);

  return { projects, projectId, setProjectId };
}
