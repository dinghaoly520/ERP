'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidOpenPage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  const session = project.openingSession;
  const decryptLabel: Record<string, string> = { PENDING: '待解密', RUNNING: '解密中', SUCCESS: '解密成功', DANGER: '异常' };
  const decryptColor: Record<string, string> = { PENDING: '#f5a623', RUNNING: '#064ea2', SUCCESS: '#11a874', DANGER: '#e74c3c' };

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">在线开标大厅</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">到时自动提取投标文件，提示投标人在线解密，生成开标记录</p>

      {session && (
        <div className="bg-gradient-to-r from-[#063f82] to-[#0a7ed3] text-white rounded-xl p-6 mb-4 flex items-center gap-6">
          <div className="text-4xl">⚖️</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold mb-1">{project.name}</h2>
            <p className="text-white/80 text-sm">开标时间：{new Date(project.openTime).toLocaleString('zh-CN')} ｜ 主持人：{session.host} ｜ 监督人：{session.supervisor}</p>
          </div>
          <div className="bg-white/15 rounded-lg p-4 text-center"><span className="text-xs text-white/80">状态</span><div className="text-lg font-bold">{session.status}</div></div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5 mb-4">
        <h2 className="font-bold text-[#18243a] mb-3">投标人在线解密状态</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">投标单位</th><th className="pb-2">投标回执</th><th className="pb-2">密文状态</th><th className="pb-2">解密状态</th><th className="pb-2">确认状态</th></tr></thead>
          <tbody>{project.suppliers.map(s => (
            <tr key={s.id} className="border-b border-[#e8f0fa]">
              <td className="py-2">{s.supplierName}</td>
              <td className="py-2 text-[#064ea2]">{s.receiptNo}</td>
              <td className="py-2">{s.encryptStatus}</td>
              <td className="py-2"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: decryptColor[s.decryptStatus], backgroundColor: decryptColor[s.decryptStatus] + '18' }}>{decryptLabel[s.decryptStatus]}</span></td>
              <td className="py-2 text-[#5a6d8a]">{s.confirmStatus === 'CONFIRMED' ? '已确认' : s.confirmStatus === 'EXCEPTION' ? '异常待处理' : '待确认'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-[#18243a] mb-3">开标记录</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">供应商</th><th className="pb-2">报价</th><th className="pb-2">工期</th><th className="pb-2">质量</th><th className="pb-2">保证金</th><th className="pb-2">确认</th></tr></thead>
          <tbody>{project.openingRecords.map((r, i) => (
            <tr key={i} className="border-b border-[#e8f0fa]"><td className="py-2">{r.supplierName}</td><td className="py-2 font-semibold">{r.amount}</td><td className="py-2">{r.period}</td><td className="py-2">{r.qualityTarget}</td><td className="py-2">{r.bondStatus}</td><td className="py-2">{r.confirmStatus}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
