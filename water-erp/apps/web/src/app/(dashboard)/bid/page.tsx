'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { BidProject } from '@/lib/types';
import { CardSkeleton, TableSkeleton } from '@/components/skeleton';

export default function BidDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<BidProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<BidProject[]>('/bid/projects').then(ps => { setProjects(ps); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const stageLabel: Record<string, string> = { DOWNLOAD: '文件下载', SUBMIT: '加密投递', OPENING: '在线开标', EVALUATING: '专家评标', ARCHIVED: '资料归档' };
  const stageColor: Record<string, string> = { DOWNLOAD: '#064ea2', SUBMIT: '#064ea2', OPENING: '#f5a623', EVALUATING: '#064ea2', ARCHIVED: '#11a874' };

  const stats = {
    total: projects.length,
    opening: projects.filter(p => p.stage === 'OPENING').length,
    evaluating: projects.filter(p => p.stage === 'EVALUATING').length,
    archived: projects.filter(p => p.stage === 'ARCHIVED').length,
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#18243a]">开评标系统</h1>
          <p className="text-sm text-[#5a6d8a] mt-1">统一入口、多端协同、安全可控、限时开标、独立评审、全程留痕</p>
        </div>
        <button onClick={() => router.push('/bid/open')} className="px-5 py-2 bg-[#064ea2] text-white rounded-lg font-semibold hover:bg-[#0e62d0] transition">进入在线开标大厅</button>
      </div>

      {/* 统计卡片 */}
      {loading ? <CardSkeleton count={4} /> : (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: '项目总数', value: stats.total, color: '#064ea2', bg: '#064ea212' },
            { label: '在线开标', value: stats.opening, color: '#f5a623', bg: '#f5a62312' },
            { label: '专家评标', value: stats.evaluating, color: '#064ea2', bg: '#064ea218' },
            { label: '已归档', value: stats.archived, color: '#11a874', bg: '#11a87412' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-[#e8f0fa] p-5">
              <p className="text-xs text-[#5a6d8a] mb-1">{s.label}</p>
              <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 快速入口 */}
      <div className="flex gap-4 mb-6">
        {[{l:'供应商端',p:'/bid/submit',d:'插件授权、加密投递'},{l:'开标主持端',p:'/bid/open',d:'在线解密、开标记录'},{l:'专家评标端',p:'/bid/evaluate',d:'独立评分、报告确认'},{l:'监督端',p:'/bid/supervise',d:'日志追溯、不可干预'},{l:'归档端',p:'/bid/archive',d:'资料归档、防篡改'}].map(e=>(
          <button key={e.p} onClick={() => router.push(e.p)} className="flex-1 bg-white rounded-xl p-4 border border-[#e8f0fa] hover:shadow-md hover:-translate-y-1 transition text-left">
            <h3 className="font-bold text-[#18243a] mb-1">{e.l}</h3>
            <p className="text-xs text-[#5a6d8a]">{e.d}</p>
          </button>
        ))}
      </div>

      {/* 项目列表 */}
      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5">
        <h2 className="font-bold text-lg text-[#18243a] mb-4">项目状态</h2>
        {loading ? <TableSkeleton rows={3} cols={5} /> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-3">项目编号</th><th className="pb-3">项目名称</th><th className="pb-3">开标时间</th><th className="pb-3">阶段</th><th className="pb-3">风险提示</th></tr></thead>
            <tbody>
              {projects.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-[#5a6d8a]">暂无项目数据</td></tr>
              ) : projects.map(p => (
                <tr key={p.id} className="border-b border-[#e8f0fa] hover:bg-[#f8fbff] cursor-pointer" onClick={() => router.push('/bid/open')}>
                  <td className="py-3 text-[#064ea2] font-semibold">{p.projectCode}</td>
                  <td className="py-3">{p.name}</td>
                  <td className="py-3 text-[#5a6d8a]">{new Date(p.openTime).toLocaleString('zh-CN')}</td>
                  <td className="py-3"><span className="px-2 py-1 rounded text-xs font-semibold" style={{ color: stageColor[p.stage], backgroundColor: stageColor[p.stage] + '18' }}>{stageLabel[p.stage]}</span></td>
                  <td className="py-3 text-[#5a6d8a]">{p.riskNote || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
