'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { recommendSuppliers, getClassifications } from '@/lib/api/supplier';
import type { SupplierRecommendation, SupplierSelectionResult } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import { Sparkles, Wand2, Copy, Download, X, Plus, FileSearch } from 'lucide-react';
import { PageHero, SectionCard } from '@/components/workbench';
import { Building2 } from 'lucide-react';

const scoreColor = (s: number) => (s >= 85 ? '#11a874' : s >= 70 ? '#064ea2' : s >= 55 ? '#f5a623' : '#e74c3c');

const EXAMPLES = [
  '某水库大坝安全监测与水利信息化系统建设，需具备水利工程勘测设计及相关资质',
  '办公区物业服务及保洁，需具备物业管理资质',
  '年度财务审计与资产评估服务',
  '信息化系统开发与内控平台建设',
];

export default function SupplierSelectionPage() {
  const router = useRouter();
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [requirement, setRequirement] = useState('');
  const [classificationId, setClassificationId] = useState('');
  const [maxCount, setMaxCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SupplierSelectionResult | null>(null);

  const [shortlist, setShortlist] = useState<Map<string, SupplierRecommendation>>(new Map());

  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); }, []);

  const run = async () => {
    if (!requirement.trim()) { setError('请先描述采购需求'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      const res = await recommendSuppliers({ requirement: requirement.trim(), classificationId: classificationId || undefined, maxCount });
      setResult(res);
      if (res.recommendations.length === 0) setError('未找到匹配的候选供应商，请调整需求描述或分类');
    } catch (e: any) {
      setError(e?.message || '智能推荐失败，请稍后重试');
    }
    setLoading(false);
  };

  const toggleShortlist = (r: SupplierRecommendation) => {
    setShortlist(prev => {
      const next = new Map(prev);
      if (next.has(r.supplierId)) next.delete(r.supplierId);
      else next.set(r.supplierId, r);
      return next;
    });
  };

  const buildExportText = () =>
    [...shortlist.values()]
      .map((r, i) => {
        const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
        return `${i + 1}. ${r.name}\n   分类：${r.classification || '—'}\n   联系人：${contact?.name || '—'} ${contact?.phone || ''}\n   匹配度：${r.matchScore}`;
      })
      .join('\n\n');

  const copyList = async () => {
    if (shortlist.size === 0) return;
    try { await navigator.clipboard.writeText(buildExportText()); alert('候选名单已复制到剪贴板'); }
    catch { alert('复制失败，请手动选择'); }
  };
  const downloadList = () => {
    if (shortlist.size === 0) return;
    const blob = new Blob([buildExportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `供应商候选名单_${new Date().toISOString().slice(0, 10)}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHero eyebrow="供应商管理中心" title="供应商选取" description="基于供应商库和分类信息辅助采购项目供应商选择。" tone="green" icon={<Building2 size={14} />} />

      <div className="mb-6">
        <div className="mb-2 inline-flex rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1 text-xs font-semibold text-[#064ea2]">供应商管理中心</div>
        <h1 className="text-2xl font-bold text-[#0f2f57] flex items-center gap-2"><Sparkles size={22} className="text-[#064ea2]" />供应商智能选取</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">输入采购需求，AI 从供应商库中智能匹配并推荐最合适的候选供应商</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左：需求输入 + 结果 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 需求输入卡片 */}
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5">
            <h2 className="font-bold text-[#18243a] mb-3">采购需求</h2>
            <textarea
              value={requirement}
              onChange={e => setRequirement(e.target.value)}
              placeholder="描述您的采购需求，例如：某水库大坝安全监测自动化系统建设，需具备水利工程勘测设计甲级资质……"
              className="w-full px-3 py-2.5 border border-[#e5ecf4] rounded-lg text-sm h-28 resize-none focus:outline-none focus:border-[#064ea2] mb-3"
            />
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <select value={classificationId} onChange={e => setClassificationId(e.target.value)} className="px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]">
                <option value="">全部分类（AI 自动匹配）</option>
                {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex items-center gap-2 text-sm text-[#5a6d8a]">
                推荐数量
                <select value={maxCount} onChange={e => setMaxCount(Number(e.target.value))} className="px-2 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]">
                  {[5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n} 家</option>)}
                </select>
              </div>
              <button
                onClick={run}
                disabled={loading}
                className="ml-auto inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg disabled:opacity-60 transition"
              >
                <Wand2 size={15} />{loading ? '智能匹配中...' : '智能推荐'}
              </button>
            </div>
            {/* 示例 */}
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => setRequirement(ex)} className="text-xs text-[#064ea2] bg-[#eff6ff] hover:bg-[#dbeafe] rounded-full px-3 py-1 transition">{ex}</button>
              ))}
            </div>
          </div>

          {/* 错误 */}
          {error && <div className="rounded-xl border border-[#fca5a5] bg-[#fef2f2] px-4 py-3 text-sm text-[#c0392b]">{error}</div>}

          {/* 加载中 */}
          {loading && (
            <div className="bg-white rounded-2xl border border-[#e5ecf4] p-10 text-center">
              <div className="inline-flex items-center gap-2 text-[#064ea2] font-semibold">
                <span className="h-2 w-2 rounded-full bg-[#064ea2] animate-pulse" />
                AI 正在分析需求并从供应商库中匹配候选……
              </div>
              <p className="text-xs text-[#5a6d8a] mt-2">推理模型需要一定时间，请稍候</p>
            </div>
          )}

          {/* 结果 */}
          {result && !loading && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#e5ecf4] bg-white p-5">
                <div className="flex items-center gap-2 mb-2">
                  <FileSearch size={16} className="text-[#064ea2]" />
                  <h2 className="font-bold text-[#18243a]">智能推荐结果</h2>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold ${result.engine === 'deepseek' ? 'bg-[#ede9fe] text-[#7c3aed]' : 'bg-[#f1f5f9] text-[#5a6d8a]'}`}>
                    {result.engine === 'deepseek' ? `AI · ${result.model}` : '规则引擎'}
                  </span>
                </div>
                <p className="text-sm text-[#5a6d8a] leading-relaxed">{result.summary}</p>
                <p className="text-xs text-[#5a6d8a] mt-2">从 {result.candidatePool} 家候选中推荐 {result.recommendations.length} 家</p>
              </div>

              {result.recommendations.map((r, idx) => {
                const inList = shortlist.has(r.supplierId);
                const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                return (
                  <div key={r.supplierId} className="rounded-2xl border border-[#e5ecf4] bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 h-9 w-9 rounded-full bg-[#064ea2] text-white flex items-center justify-center text-sm font-bold">{idx + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2]" onClick={() => router.push(`/supplier/${r.supplierId}`)}>{r.name}</span>
                          {r.classification && <span className="text-xs text-[#064ea2] bg-[#eff6ff] rounded-full px-2 py-0.5">{r.classification}</span>}
                          {r.enterpriseType && <span className="text-xs text-[#5a6d8a]">{r.enterpriseType}</span>}
                        </div>
                        {/* 匹配度 */}
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 h-2 rounded-full bg-[#f1f5f9] overflow-hidden max-w-[240px]">
                            <div className="h-full rounded-full" style={{ width: `${r.matchScore}%`, backgroundColor: scoreColor(r.matchScore) }} />
                          </div>
                          <strong className="text-sm" style={{ color: scoreColor(r.matchScore) }}>{r.matchScore}</strong>
                          <span className="text-xs text-[#5a6d8a]">匹配度</span>
                        </div>
                        <p className="text-sm text-[#5a6d8a] mt-2 leading-relaxed">{r.reason}</p>
                        {contact && <p className="text-xs text-[#5a6d8a] mt-1.5">联系人：{contact.name} · {contact.phone}</p>}
                      </div>
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button onClick={() => router.push(`/supplier/${r.supplierId}`)} className="px-3 py-1 text-xs text-[#064ea2] border border-[#e5ecf4] rounded-lg hover:bg-[#f0f6ff] transition">详情</button>
                        <button onClick={() => toggleShortlist(r)} className={`inline-flex items-center justify-center gap-1 px-3 py-1 text-xs rounded-lg transition ${inList ? 'text-white bg-[#11a874] hover:bg-[#0e8c5f]' : 'text-[#064ea2] border border-[#e5ecf4] hover:bg-[#f0f6ff]'}`}>
                          {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入候选</>}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 右：候选名单 */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 sticky top-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-[#18243a]">候选名单 <span className="text-sm font-normal text-[#5a6d8a]">({shortlist.size})</span></h2>
              {shortlist.size > 0 && (
                <div className="flex gap-1">
                  <button onClick={copyList} title="复制" className="p-1.5 text-[#064ea2] hover:bg-[#f0f6ff] rounded-lg transition"><Copy size={15} /></button>
                  <button onClick={downloadList} title="导出" className="p-1.5 text-[#064ea2] hover:bg-[#f0f6ff] rounded-lg transition"><Download size={15} /></button>
                </div>
              )}
            </div>

            {shortlist.size === 0 ? (
              <p className="text-sm text-[#5a6d8a] py-8 text-center">点击推荐结果的「加入候选」<br />生成邀请名单</p>
            ) : (
              <div className="space-y-2">
                {[...shortlist.values()].map(r => {
                  const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                  return (
                    <div key={r.supplierId} className="rounded-lg border border-[#e5ecf4] p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[#18243a] truncate">{r.name}</span>
                        <button onClick={() => toggleShortlist(r)} className="text-[#5a6d8a] hover:text-[#e74c3c] flex-shrink-0"><X size={14} /></button>
                      </div>
                      <div className="text-xs text-[#5a6d8a] mt-0.5">{contact ? `${contact.name} · ${contact.phone}` : '无联系人'}</div>
                    </div>
                  );
                })}
                <button onClick={() => setShortlist(new Map())} className="w-full mt-2 text-xs text-[#5a6d8a] hover:text-[#e74c3c] transition">清空名单</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
