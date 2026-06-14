'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface SlimProject {
  id: string;
}

export function useBidProjects() {
  const [projectIds, setProjectIds] = useState<SlimProject[]>([]);
  const [firstId, setFirstId] = useState('');

  useEffect(() => {
    api.get<SlimProject[]>('/bid/projects')
      .then(ps => {
        setProjectIds(ps);
        if (ps.length) setFirstId(ps[0].id);
      })
      .catch(() => {});
  }, []);

  return { projectIds, firstId };
}
