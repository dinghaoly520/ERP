'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidEvaluatePage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [activeSupplier, setActiveSupplier] = useState('');

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(p => { setProject(p); setActiveSupplier(p.suppliers[0]?.supplierName || ''); });
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  const totalScore = project.scoreItems.reduce((sum, item) => sum + Number(item.maxScore), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">专家评标端</h1>
      <p className="text-sm text-[#5a6d8a] mb-4">身份核验、保密承诺、回避确认后进入独立评审</p>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-4 mb-4">
        <div className="flex gap-8 text-sm">
          {['身份核验 ✓', '保密承诺 ✓', '回避确认 ✓', '评标纪律 ✓'].map(s => <span key={s} className="text-[#11a874] font-semibold">{s}</span>)}
        </div>
      </div>

      <div className="grid grid-cols-[260px_1fr_360px] gap-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-4">
          <h2 className="font-bold text-sm text-[#18243a] mb-3">投标单位</h2>
          {project.suppliers.map(s => (
            <button key={s.id} onClick={() => setActiveSupplier(s.supplierName)}
              className={`block w-full text-left p-3 rounded-lg mb-2 text-sm border transition ${activeSupplier === s.supplierName ? 'border-[#064ea2] bg-[#eef6ff]' : 'border-[#e8f0fa] hover:border-[#b8d4f5]'}`}>
              <div className="font-semibold">{s.supplierName}</div>
              <div className="text-xs text-[#5a6d8a] mt-1">{s.encryptStatus}</div>
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <div className="flex justify-between items-center mb-4"><h2 className="font-bold text-[#18243a]">文件与响应摘要</h2><span className="text-sm text-[#064ea2] font-semibold">{activeSupplier}</span></div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {['资格文件：已提交', '技术响应：完整', '商务报价：有效区间'].map(t => {
              const [label, val] = t.split('：');
              return <div key={t} className="bg-[#f8fbff] rounded-lg p-4 text-sm"><div className="font-semibold text-[#18243a]">{label}</div><div className="text-[#5a6d8a] mt-1">{val}</div></div>;
            })}
          </div>
          {project.clarifications.length > 0 && (
            <div className="bg-[#fff8e8] rounded-lg p-4">
              <h3 className="font-bold text-sm mb-2">澄清说明</h3>
              {project.clarifications.map(c => <p key={c.id} className="text-sm text-[#5a6d8a]">{c.question} —— {c.status}：{c.reply}</p>)}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <div className="flex justify-between items-center mb-4"><h2 className="font-bold text-[#18243a]">评分表</h2><span className="text-xs text-[#11a874] font-semibold">本人独立评分</span></div>
          {project.scoreItems.map(item => (
            <div key={item.id} className="border-b border-[#e8f0fa] py-3">
              <div className="flex justify-between text-sm text-[#5a6d8a] mb-1"><strong>{item.name}</strong><span>{item.maxScore > 0 ? `满分 ${item.maxScore}` : '通过'}</span></div>
            </div>
          ))}
          <div className="py-3 text-[#18243a]">总分满分：<strong className="text-xl text-[#064ea2]">{totalScore}</strong></div>
        </div>
      </div>
    </div>
  );
}
