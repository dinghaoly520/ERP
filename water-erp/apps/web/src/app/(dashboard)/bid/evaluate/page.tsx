'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';

export default function BidEvaluatePage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSupplier, setActiveSupplier] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});

  useEffect(() => {
    api.get<{id:string}[]>('/bid/projects').then(ps => {
      if (ps.length) setProjectId(ps[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => {
      setProject(p);
      setActiveSupplier(p.suppliers[0]?.supplierName || '');
      setLoading(false);
    });
  }, [projectId]);

  const reload = () => {
    if (!projectId) return;
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
  };

  const handleSignIn = async (expertId: string) => {
    await api.patch(`/bid/projects/${projectId}`, { stage: project?.stage });
    toast.success('签到成功');
    reload();
  };

  const handleSubmitScore = async (scoreItemId: string, expertId: string) => {
    const scoreVal = scores[`${expertId}-${scoreItemId}`];
    if (!scoreVal || Number(scoreVal) < 0) { toast.error('请填写有效分数'); return; }
    try {
      await api.post(`/bid/projects/${projectId}/scores`, { expertId, scoreItemId, score: Number(scoreVal) });
      toast.success('评分已提交');
      setScores(prev => { const n = { ...prev }; delete n[`${expertId}-${scoreItemId}`]; return n; });
      reload();
    } catch { toast.error('提交失败'); }
  };

  if (loading) return <TableSkeleton rows={8} cols={6} />;
  if (!project) return <div className="text-[#5a6d8a] text-center py-20">暂无项目数据</div>;

  const experts = project.experts;
  const currentExpert = experts.length > 0 ? experts[0] : null;
  const totalMax = project.scoreItems.reduce((sum, item) => sum + Number(item.maxScore), 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#18243a] mb-1">专家评标端</h1>
          <p className="text-sm text-[#5a6d8a]">身份核验、保密承诺、回避确认后进入独立评审</p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

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
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-[#18243a]">文件与响应摘要</h2>
            <span className="text-sm text-[#064ea2] font-semibold">{activeSupplier}</span>
          </div>
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
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-bold text-[#18243a]">评分表</h2>
            {currentExpert && (
              <div className="flex gap-2">
                {!currentExpert.signedIn && (
                  <button onClick={() => handleSignIn(currentExpert.id)} className="px-3 py-1 text-xs text-white bg-[#064ea2] rounded hover:bg-[#0e62d0]">签到</button>
                )}
                {!currentExpert.avoidanceConfirmed && currentExpert.signedIn && (
                  <button onClick={async () => { await api.patch(`/bid/projects/${projectId}`, {}); toast.success('回避确认完成'); reload(); }}
                    className="px-3 py-1 text-xs text-white bg-[#f5a623] rounded hover:bg-[#d9921e]">确认回避</button>
                )}
                <span className="text-xs text-[#5a6d8a]">{currentExpert.expertName}</span>
              </div>
            )}
          </div>
          {currentExpert && project.scoreItems.map(item => (
            <div key={item.id} className="border-b border-[#e8f0fa] py-3">
              <div className="flex justify-between items-center text-sm text-[#5a6d8a] mb-2">
                <strong>{item.name}</strong>
                <span>{item.maxScore > 0 ? `满分 ${item.maxScore}` : '通过'}</span>
              </div>
              {item.maxScore > 0 && currentExpert.signedIn && currentExpert.avoidanceConfirmed && (
                <div className="flex gap-2">
                  <input
                    type="number" min={0} max={Number(item.maxScore)} step={0.5}
                    placeholder="打分"
                    value={scores[`${currentExpert.id}-${item.id}`] || ''}
                    onChange={e => setScores(prev => ({ ...prev, [`${currentExpert.id}-${item.id}`]: e.target.value }))}
                    className="flex-1 px-2 py-1 border border-[#e8f0fa] rounded text-sm focus:outline-none focus:border-[#064ea2]"
                  />
                  <button
                    onClick={() => handleSubmitScore(item.id, currentExpert.id)}
                    className="px-3 py-1 text-xs text-white bg-[#11a874] rounded hover:bg-[#0e8c5f] transition"
                  >提交</button>
                </div>
              )}
            </div>
          ))}
          <div className="py-3 text-[#18243a]">总分满分：<strong className="text-xl text-[#064ea2]">{totalMax}</strong></div>
        </div>
      </div>
    </div>
  );
}
