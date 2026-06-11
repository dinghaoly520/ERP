'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProject } from '@/lib/types';

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export default function ProjectSelector({ value, onChange }: Props) {
  const [projects, setProjects] = useState<BidProject[]>([]);

  useEffect(() => {
    api.get<BidProject[]>('/bid/projects').then(setProjects).catch(() => {});
  }, []);

  if (projects.length === 0) return null;

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-2 border border-[#e8f0fa] rounded-lg text-sm focus:outline-none focus:border-[#064ea2] bg-white min-w-[280px]"
    >
      {projects.map(p => (
        <option key={p.id} value={p.id}>
          {p.projectCode} — {p.name}
        </option>
      ))}
    </select>
  );
}
