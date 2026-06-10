'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidSubmitPage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">供应商端</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">企业唯一安全组件、招标文件受控下载、投标文件加密上传与回执</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">招标文件受控下载</h2>
          <div className="bg-[#f8fbff] rounded-lg p-4 text-sm text-[#5a6d8a]">
            <p>文件：{project.projectCode} 招标文件.ofd</p>
            <p>水印：动态水印已嵌入</p>
            <p>哈希：SHA256-A19C8E</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-3">投标文件加密投递</h2>
          <div className="border-2 border-dashed border-[#e8f0fa] rounded-lg p-8 text-center text-[#5a6d8a]">
            <p className="text-lg mb-2">拖拽投标文件到此处</p>
            <p className="text-xs">演示流程：本地签章 → 哈希计算 → 加密上传 → 生成回执</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-[#18243a] mb-3">投标状态</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">投标单位</th><th className="pb-2">投递状态</th><th className="pb-2">加密状态</th><th className="pb-2">回执编号</th></tr></thead>
          <tbody>{project.suppliers.slice(0, 1).map(s => (
            <tr key={s.id} className="border-b border-[#e8f0fa]"><td className="py-2">{s.supplierName}</td><td className="py-2">{s.submitStatus}</td><td className="py-2">{s.encryptStatus}</td><td className="py-2 text-[#064ea2]">{s.receiptNo}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
