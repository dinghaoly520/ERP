'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidArchivePage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  const load = () => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  };

  useEffect(() => { load(); }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  const archived = project.archiveItems.filter(a => a.status === 'ARCHIVED').length;
  const rate = Math.round((archived / project.archiveItems.length) * 100);
  const statusLabel: Record<string, string> = { ARCHIVED: '已归档', PENDING_CONFIRM: '待确认', NOT_STARTED: '未开始' };
  const statusColor: Record<string, string> = { ARCHIVED: '#11a874', PENDING_CONFIRM: '#f5a623', NOT_STARTED: '#8a9aaa' };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">归档端</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">开标记录、评分表、澄清记录、评标报告、结果公示统一归档</p>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5 mb-4 flex items-center gap-6">
        <div className="text-4xl">📦</div>
        <div><h2 className="font-bold text-[#18243a]">电子档案编号：ARCH-{project.projectCode}</h2><p className="text-sm text-[#5a6d8a]">防篡改摘要：HASH-CHAIN-20260608-AF39C8E2</p></div>
        <div className="text-center"><div className="text-3xl font-bold text-[#064ea2]">{rate}%</div><div className="text-xs text-[#5a6d8a]">归档完整率</div></div>
        <button onClick={async () => { if(project) { await api.post(`/bid/projects/${project.id}/archive-all`, {}); load(); }}}
          className="px-5 py-2 bg-[#11a874] text-white rounded-lg font-semibold hover:bg-[#0e8f62] transition">一键归档演示</button>
      </div>

      <div className="grid grid-cols-[1.4fr_0.7fr] gap-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">归档资料清单</h2>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">资料名称</th><th className="pb-2">责任端</th><th className="pb-2">状态</th><th className="pb-2">哈希摘要</th></tr></thead>
            <tbody>{project.archiveItems.map(a => (
              <tr key={a.id} className="border-b border-[#e8f0fa]">
                <td className="py-2">{a.name}</td><td className="py-2 text-[#5a6d8a]">{a.ownerRole}</td>
                <td className="py-2"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: statusColor[a.status], backgroundColor: statusColor[a.status] + '18' }}>{statusLabel[a.status]}</span></td>
                <td className="py-2 text-[#5a6d8a] font-mono text-xs">{a.hashDigest || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">缺失提醒</h2>
          {project.archiveItems.filter(a => a.status !== 'ARCHIVED').map(a => (
            <div key={a.id} className="bg-[#fff8e8] rounded-lg p-3 text-sm text-[#8a6d3b] mb-2">⚠️ {a.name}{a.status === 'PENDING_CONFIRM' ? '待确认' : '未开始'}</div>
          ))}
          {project.archiveItems.filter(a => a.status === 'ARCHIVED').length > 0 && (
            <div className="bg-[#e8fff0] rounded-lg p-3 text-sm text-[#0e8f62]">✅ {project.archiveItems.filter(a => a.status === 'ARCHIVED').map(a => a.name).join('、')}已入档</div>
          )}
        </div>
      </div>
    </div>
  );
}
