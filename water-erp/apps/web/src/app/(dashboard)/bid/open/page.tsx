'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';

export default function BidOpenPage() {
  const [projects, setProjects] = useState<{id:string}[]>([]);
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{id:string}[]>('/bid/projects').then(ps => {
      setProjects(ps);
      if (ps.length) setProjectId(ps[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => { setProject(p); setLoading(false); });
  }, [projectId]);

  // Auto-refresh every 5s during opening
  useEffect(() => {
    if (!projectId || !project || project.stage !== 'OPENING') return;
    const timer = setInterval(() => {
      api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
    }, 5000);
    return () => clearInterval(timer);
  }, [projectId, project?.stage]);

  const decryptLabel: Record<string, string> = { PENDING: '待解密', RUNNING: '解密中', SUCCESS: '解密成功', DANGER: '异常' };
  const decryptColor: Record<string, string> = { PENDING: '#f5a623', RUNNING: '#064ea2', SUCCESS: '#11a874', DANGER: '#e74c3c' };

  if (loading) return <TableSkeleton rows={8} cols={6} />;

  if (!project) return <div className="text-[#5a6d8a] text-center py-20">暂无项目数据</div>;

  const session = project.openingSession;

  // Countdown
  const remaining = session ? Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - Date.now()) / 1000)) : 0;
  const [countdown, setCountdown] = useState(remaining);
  useEffect(() => { setCountdown(remaining); }, [remaining]);
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown > 0]);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#18243a] mb-1">在线开标大厅</h1>
          <p className="text-sm text-[#5a6d8a]">到时自动提取投标文件，提示投标人在线解密，生成开标记录</p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      {session && (
        <div className="bg-gradient-to-r from-[#063f82] to-[#0a7ed3] text-white rounded-xl p-6 mb-4 flex items-center gap-6">
          <div className="text-4xl">⚖️</div>
          <div className="flex-1">
            <h2 className="text-xl font-bold mb-1">{project.name}</h2>
            <p className="text-white/80 text-sm">开标时间：{new Date(project.openTime).toLocaleString('zh-CN')} ｜ 主持人：{session.host} ｜ 监督人：{session.supervisor}</p>
          </div>
          <div className="bg-white/15 rounded-lg p-4 text-center">
            <span className="text-xs text-white/80">状态</span>
            <div className="text-lg font-bold">{session.status}</div>
          </div>
          {countdown > 0 && (
            <div className="bg-red-500/80 rounded-lg p-4 text-center min-w-[80px]">
              <span className="text-xs text-white/80">倒计时</span>
              <div className="text-xl font-bold font-mono">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e8f0fa] p-5 mb-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold text-[#18243a]">投标人在线解密状态</h2>
          {project.stage !== 'OPENING' && (
            <button onClick={async () => { await api.post(`/bid/projects/${projectId}/open`, {}); api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject); }}
              className="px-4 py-2 text-sm bg-[#064ea2] text-white rounded-lg hover:bg-[#0e62d0] transition">启动开标</button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#e8f0fa] text-left text-[#5a6d8a]"><th className="pb-2">投标单位</th><th className="pb-2">投标回执</th><th className="pb-2">密文状态</th><th className="pb-2">解密状态</th><th className="pb-2">确认状态</th><th className="pb-2">操作</th></tr></thead>
          <tbody>{project.suppliers.map(s => (
            <tr key={s.id} className="border-b border-[#e8f0fa]">
              <td className="py-2">{s.supplierName}</td>
              <td className="py-2 text-[#064ea2]">{s.receiptNo}</td>
              <td className="py-2">{s.encryptStatus}</td>
              <td className="py-2"><span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: decryptColor[s.decryptStatus], backgroundColor: decryptColor[s.decryptStatus] + '18' }}>{decryptLabel[s.decryptStatus]}</span></td>
              <td className="py-2 text-[#5a6d8a]">{s.confirmStatus === 'CONFIRMED' ? '已确认' : s.confirmStatus === 'EXCEPTION' ? '异常待处理' : '待确认'}</td>
              <td className="py-2">
                {s.decryptStatus !== 'SUCCESS' && (
                  <button onClick={async () => { await api.post(`/bid/projects/${projectId}/decrypt/${s.id}`, {}); api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject); }}
                    className="px-3 py-1 text-xs text-white bg-[#064ea2] rounded hover:bg-[#0e62d0] transition">解密</button>
                )}
              </td>
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
