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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get<BidProject[]>('/bid/projects')
      .then(p => { setProjects(p); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <select disabled className="px-3 py-2 border border-[#fecaca] rounded-lg text-sm text-[#e74c3c] bg-[#fef2f2] min-w-[280px] cursor-not-allowed">
        <option>项目列表加载失败</option>
      </select>
    );
  }
  if (projects.length === 0) {
    return (
      <select disabled className="px-3 py-2 border border-[#e8f0fa] rounded-lg text-sm text-[oklch(0.62_0.008_264)] bg-white min-w-[280px] cursor-not-allowed">
        <option>加载项目中…</option>
      </select>
    );
  }

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