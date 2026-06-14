'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { listBidProjects, previewExtraction, confirmExtraction, listSpecialties } from '@/lib/api/expert';
import type { BidProjectOption, ExtractionPreview } from '@/lib/api/expert';
import { Dices, Sparkles, ShieldCheck, AlertTriangle, Check } from 'lucide-react';
import { PageHero, SectionCard } from '@/components/workbench';
import { UsersRound } from 'lucide-react';

const scoreColor = (s: number) => (s >= 85 ? '#11a874' : s >= 70 ? '#7c3aed' : s >= 55 ? '#f5a623' : '#e74c3c');
const modeBtn = (active: boolean) =>
  active
    ? 'flex-1 px-2 py-2 text-xs font-semibold transition bg-[#7c3aed] text-white'
    : 'flex-1 px-2 py-2 text-xs font-semibold transition text-[#5a6d8a] hover:bg-[#f8fafc]';

export default function ExpertExtractPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get('projectId') || '');
  const [totalNeeded, setTotalNeeded] = useState(3);
  const [alternatives, setAlternatives] = useState(2);
  const [mode, setMode] = useState<'weighted' | 'fair'>('weighted');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ExtractionPreview | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    listBidProjects().then(setProjects).catch(() => {});
    listSpecialties().then(setSpecialties).catch(() => {});
  }, []);

  const run = async () => {
    if (!projectId) { setError('请选择招标项目'); return; }
    setError(''); setLoading(true); setPreview(null); setDone(false);
    try {
      const res = await previewExtraction({ projectId, totalNeeded, alternatives, mode });
      setPreview(res);
    } catch (e: any) { setError(e?.message || '抽取失败'); }
    setLoading(false);
  };

  const confirm = async () => {
    if (!preview || !projectId) return;
    setConfirming(true);
    try {
      const experts = preview.selected.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty }));
      if (experts.length === 0) { setError('没有可确认的正选专家'); setConfirming(false); return; }
      await confirmExtraction({ projectId, experts });
      setDone(true);
    } catch (e: any) { setError(e?.message || '确认失败'); }
    setConfirming(false);
  };

  const selectedProject = projects.find(p => p.id === projectId);

  return (
    <div>
      <PageHero eyebrow="专家管理中心" title="专家抽取" description="围绕项目评审需求完成专家抽取和分配。" tone="purple" icon={<UsersRound size={14} />} />

      <div className="mb-6">
        <div className="mb-2 inline-flex rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-1 text-xs font-semibold text-[#7c3aed]">专家管理中心</div>
        <h1 className="text-2xl font-bold text-[#0f2f57] flex items-center gap-2"><Dices size={22} className="text-[#7c3aed]" />专家抽取</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">AI 分析项目需求并组建评标专家组；中选结果由随机层决定，保证公平合规</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* 配置 */}
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5">
            <h2 className="font-bold text-[#18243a] mb-3">抽取配置</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">招标项目 *</label>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]">
                  <option value="">请选择项目</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.projectCode}）</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">抽取人数</label>
                  <select value={totalNeeded} onChange={e => setTotalNeeded(Number(e.target.value))} className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]">
                    {[1, 2, 3, 5, 7, 9].map(n => <option key={n} value={n}>{n} 名</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">候补人数</label>
                  <select value={alternatives} onChange={e => setAlternatives(Number(e.target.value))} className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]">
                    {[0, 1, 2, 3, 5].map(n => <option key={n} value={n}>{n} 名</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">抽取模式</label>
                  <div className="flex rounded-lg border border-[#e5ecf4] overflow-hidden">
                    <button onClick={() => setMode('weighted')} className={modeBtn(mode === 'weighted')}>智能加权</button>
                    <button onClick={() => setMode('fair')} className={modeBtn(mode === 'fair')}>公平随机</button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#5a6d8a]">
                {mode === 'weighted'
                  ? '智能加权：AI 匹配度作为权重，高相关专家中选概率更高（仍含随机性）。'
                  : '公平随机：合规候选池内纯随机抽取，完全合规。'}
              </p>
              <button onClick={run} disabled={loading || !projectId} className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded-lg disabled:opacity-60 transition">
                <Sparkles size={15} />{loading ? 'AI 分析抽取中...' : '智能抽取'}
              </button>
            </div>
          </div>

          {error && <div className="rounded-xl border border-[#fca5a5] bg-[#fef2f2] px-4 py-3 text-sm text-[#c0392b]">{error}</div>}

          {loading && (
            <div className="bg-white rounded-2xl border border-[#e5ecf4] p-10 text-center">
              <div className="inline-flex items-center gap-2 text-[#7c3aed] font-semibold"><span className="h-2 w-2 rounded-full bg-[#7c3aed] animate-pulse" />AI 正在分析项目需求并抽取专家组…</div>
              <p className="text-xs text-[#5a6d8a] mt-2">含合规过滤（供应商回避）与随机抽取</p>
            </div>
          )}

          {/* 结果 */}
          {preview && !loading && !done && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#e5ecf4] bg-white p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={16} className="text-[#7c3aed]" />
                  <h2 className="font-bold text-[#18243a]">AI 评审组分析</h2>
                  <span className={'ml-auto text-xs px-2 py-0.5 rounded-full font-semibold ' + (preview.engine === 'deepseek' ? 'bg-[#ede9fe] text-[#7c3aed]' : 'bg-[#f1f5f9] text-[#5a6d8a]')}>
                    {preview.engine === 'deepseek' ? 'AI · ' + preview.model : '规则引擎'}
                  </span>
                </div>
                <p className="text-sm text-[#5a6d8a] leading-relaxed">{preview.analysis}</p>
                {preview.requiredSpecialties.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {preview.requiredSpecialties.map(q => (
                      <span key={q.specialty} className="text-xs bg-[#f5f3ff] text-[#7c3aed] rounded-full px-3 py-1 font-medium" title={q.reason}>{q.specialty} × {q.count}</span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-[#5a6d8a] mt-2">合规候选池 {preview.eligiblePool} 人 · 模式 {mode === 'weighted' ? '智能加权' : '公平随机'}</p>
              </div>

              {preview.shortages.length > 0 && (
                <div className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e] flex items-start gap-2">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <div>
                    {preview.shortages.map(s => <div key={s.specialty}>{s.specialty}：需 {s.needed} 人，仅 {s.available} 人可用</div>)}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-bold text-[#18243a] mb-3">正选专家组（{preview.selected.length}）</h3>
                {preview.selected.length === 0 ? (
                  <p className="text-sm text-[#5a6d8a] bg-white rounded-xl border border-[#e5ecf4] p-6 text-center">合规候选不足，请调整专业配额或先录入更多专家</p>
                ) : (
                  <div className="space-y-3">
                    {preview.selected.map((s, idx) => (
                      <div key={s.userId} className="rounded-2xl border border-[#e5ecf4] bg-white p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 h-9 w-9 rounded-full bg-[#7c3aed] text-white flex items-center justify-center text-sm font-bold">{idx + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-[#18243a] cursor-pointer hover:text-[#7c3aed]" onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span>
                              <span className="text-xs text-[#7c3aed] bg-[#f5f3ff] rounded-full px-2 py-0.5">{s.specialty}</span>
                              {s.title && <span className="text-xs text-[#5a6d8a]">{s.title}</span>}
                              {s.employer && <span className="text-xs text-[#5a6d8a]">{s.employer}</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <div className="flex-1 h-2 rounded-full bg-[#f1f5f9] overflow-hidden max-w-[200px]">
                                <div className="h-full rounded-full" style={{ width: s.matchScore + '%', backgroundColor: scoreColor(s.matchScore) }} />
                              </div>
                              <strong className="text-sm" style={{ color: scoreColor(s.matchScore) }}>{s.matchScore}</strong>
                              <span className="text-xs text-[#5a6d8a]">匹配度</span>
                            </div>
                            <p className="text-sm text-[#5a6d8a] mt-2">{s.reason}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {preview.alternatives.length > 0 && (
                <div>
                  <h3 className="font-bold text-[#18243a] mb-3">候补（{preview.alternatives.length}）</h3>
                  <div className="space-y-2">
                    {preview.alternatives.map(s => (
                      <div key={s.userId} className="rounded-lg border border-dashed border-[#e5ecf4] bg-[#f8fafc] px-4 py-2.5 flex items-center justify-between">
                        <div>
                          <span className="text-sm font-semibold text-[#18243a]">{s.name}</span>
                          <span className="ml-2 text-xs text-[#7c3aed]">{s.specialty}</span>
                        </div>
                        <span className="text-xs font-bold" style={{ color: scoreColor(s.matchScore) }}>{s.matchScore}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview.selected.length > 0 && (
                <button onClick={confirm} disabled={confirming} className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-[#11a874] hover:bg-[#0e8c5f] rounded-lg disabled:opacity-60 transition">
                  <Check size={16} />{confirming ? '确认中...' : '确认组建专家组（' + preview.selected.length + ' 人）'}
                </button>
              )}
            </div>
          )}

          {done && (
            <div className="rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] p-8 text-center">
              <ShieldCheck size={40} className="mx-auto text-[#11a874] mb-3" />
              <h3 className="text-lg font-bold text-[#18243a] mb-1">专家组已组建</h3>
              <p className="text-sm text-[#5a6d8a] mb-4">已为「{selectedProject?.name}」分配 {preview?.selected.length} 位评审专家，专家可在专家端签到履职</p>
              <button onClick={() => router.push('/expert/repository')} className="px-5 py-2 text-sm font-semibold text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded-lg transition">返回专家库</button>
            </div>
          )}
        </div>

        {/* 说明 */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 sticky top-0">
            <h2 className="font-bold text-[#18243a] mb-3">抽取规则</h2>
            <ol className="space-y-2.5 text-sm text-[#5a6d8a]">
              <li className="flex gap-2"><span className="text-[#7c3aed] font-bold">1.</span> 合规过滤：仅"可用"专家，且工作单位与项目参与供应商无关联（供应商回避）</li>
              <li className="flex gap-2"><span className="text-[#7c3aed] font-bold">2.</span> AI 分析：DeepSeek 评估项目所需专业构成与每位专家的语义匹配度</li>
              <li className="flex gap-2"><span className="text-[#7c3aed] font-bold">3.</span> 随机抽取：AI 只影响概率与候选池，"谁中选"由随机层决定，保证公平合规</li>
              <li className="flex gap-2"><span className="text-[#7c3aed] font-bold">4.</span> 确认后建立专家-项目分配（BidExpert），专家即可在专家端签到评审</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
