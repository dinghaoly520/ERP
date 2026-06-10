'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';

export default function BidSupervisePage() {
  const [project, setProject] = useState<BidProjectDetail | null>(null);

  useEffect(() => {
    api.get<BidProjectDetail[]>('/bid/projects').then(ps => {
      if (ps.length) api.get<BidProjectDetail>(`/bid/projects/${ps[0].id}`).then(setProject);
    });
  }, []);

  if (!project) return <div className="text-[#5a6d8a]">加载中...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-1">监督端</h1>
      <p className="text-sm text-[#5a6d8a] mb-6">可监督、不可干预：查看节点、日志、异常和证据链，不修改评分或敏感文件</p>

      <div className="bg-gradient-to-r from-[#f8fbff] to-[#eef6ff] rounded-xl border border-[#e8f0fa] p-5 mb-4 flex items-center gap-4">
        <div className="text-3xl">👁️</div>
        <div className="flex-1"><h2 className="font-bold text-[#18243a] mb-1">监督权限边界</h2><p className="text-sm text-[#5a6d8a]">监督人员可查看过程、日志和异常，但不具备开标前查看明文、修改评分、替专家提交意见的能力。</p></div>
        <span className="px-3 py-1 bg-red-100 text-red-600 text-xs font-bold rounded">禁止干预评分</span>
      </div>

      <div className="grid grid-cols-[1fr_0.8fr] gap-4 mb-4">
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-4">过程时间线</h2>
          <div className="space-y-4">
            {project.supervisionLogs.map(log => (
              <div key={log.id} className="flex gap-3 items-start">
                <div className="w-2 h-2 rounded-full bg-[#064ea2] mt-2 flex-shrink-0" />
                <div><div className="text-xs text-[#5a6d8a]">{new Date(log.time).toLocaleString('zh-CN')}</div><div className="text-sm">{log.role} · {log.action}（{log.result}）</div></div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
          <h2 className="font-bold text-[#18243a] mb-4">异常事件</h2>
          <div className="bg-[#fff8e8] rounded-lg p-4 text-sm text-[#8a6d3b] mb-3">⚠️ 四川宏达水利工程有限公司解密证书校验失败</div>
          <div className="bg-[#e8f4fd] rounded-lg p-4 text-sm text-[#3a6d8a]">ℹ️ 专家技术评分偏离平均值，已要求填写确认理由</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-[#18243a] mb-3">监督日志</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">时间</th><th className="pb-2">角色</th><th className="pb-2">对象</th><th className="pb-2">操作</th><th className="pb-2">结果</th><th className="pb-2">风险标记</th></tr></thead>
          <tbody>{project.supervisionLogs.map(log => (
            <tr key={log.id} className="border-b border-[#e8f0fa]"><td className="py-2 text-[#5a6d8a]">{new Date(log.time).toLocaleString('zh-CN')}</td><td className="py-2">{log.role}</td><td className="py-2">{log.target}</td><td className="py-2">{log.action}</td><td className="py-2">{log.result}</td><td className="py-2">{log.riskFlag}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
