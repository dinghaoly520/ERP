'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { ExpertProjectDetail, DecryptedDocuments, AssistData, EvaluationReport } from '@/lib/types';

type Step = 'verify' | 'documents' | 'assist' | 'scoring' | 'report';
const STEPS: { key: Step; label: string; icon: string }[] = [
  { key: 'verify', label: '身份核验', icon: '🔐' },
  { key: 'documents', label: '标书获取', icon: '📄' },
  { key: 'assist', label: '辅助评标', icon: '🤖' },
  { key: 'scoring', label: '专家打分', icon: '📝' },
  { key: 'report', label: '评审报告', icon: '📊' },
];

const CATEGORY_LABEL: Record<string, string> = {
  QUALIFICATION: '资格审查', RESPONSIVE: '响应性评审', BUSINESS: '商务评审', TECHNICAL: '技术评审', PRICE: '价格评审',
};
const CATEGORY_COLOR: Record<string, string> = {
  QUALIFICATION: '#064ea2', RESPONSIVE: '#8b5cf6', BUSINESS: '#f5a623', TECHNICAL: '#11a874', PRICE: '#e74c3c',
};

export default function ExpertEvaluatePage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ExpertProjectDetail | null>(null);
  const [step, setStep] = useState<Step>('verify');
  const [activeSupplier, setActiveSupplier] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 标书获取
  const [documents, setDocuments] = useState<DecryptedDocuments | null>(null);

  // 辅助评标
  const [assistData, setAssistData] = useState<AssistData | null>(null);

  // 评分
  const [scores, setScores] = useState<Record<string, { score: number; reason: string }>>({});
  const [scoringSupplier, setScoringSupplier] = useState('');

  // 评审报告
  const [report, setReport] = useState<EvaluationReport | null>(null);

  // 身份核验状态
  const [confidentialityAgreed, setConfidentialityAgreed] = useState(false);
  const [disciplineAgreed, setDisciplineAgreed] = useState(false);

  const loadProject = useCallback(() => {
    setLoading(true);
    api.get<ExpertProjectDetail>(`/expert/projects/${projectId}`)
      .then(p => {
        setProject(p);
        if (p.suppliers.length > 0) {
          setActiveSupplier(p.suppliers[0].id);
          setScoringSupplier(p.suppliers[0].supplierName);
        }
        // 预填已有评分
        const existing: Record<string, { score: number; reason: string }> = {};
        p.myScores.forEach(s => {
          existing[s.scoreItemId] = { score: Number(s.score), reason: s.reason || '' };
        });
        setScores(existing);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const expert = project?.myExpertRecord;

  /* ── 身份核验 ── */
  const handleSignIn = async () => {
    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/sign-in`, {});
      loadProject();
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  };

  const handleAvoidance = async () => {
    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/avoidance`, {});
      loadProject();
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  };

  /* ── 标书获取 ── */
  const loadDocuments = async (supplierId: string) => {
    try {
      const data = await api.get<DecryptedDocuments>(`/expert/projects/${projectId}/documents/${supplierId}`);
      setDocuments(data);
    } catch (e: any) { alert(e.message); }
  };

  /* ── 辅助评标 ── */
  const loadAssist = async (supplierId: string) => {
    try {
      const data = await api.get<AssistData>(`/expert/projects/${projectId}/assist/${supplierId}`);
      setAssistData(data);
    } catch (e: any) { alert(e.message); }
  };

  useEffect(() => {
    if (step === 'documents' && activeSupplier) loadDocuments(activeSupplier);
    if (step === 'assist' && activeSupplier) loadAssist(activeSupplier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeSupplier]);

  /* ── 提交评分 ── */
  const handleSubmitScores = async () => {
    if (!project || !scoringSupplier) return;
    const items = project.scoreItems.map(si => ({
      scoreItemId: si.id,
      score: scores[si.id]?.score ?? 0,
      reason: scores[si.id]?.reason ?? '',
    }));
    const hasZero = items.some(i => i.score === 0);
    if (hasZero && !confirm('部分评分项得分为0，确定提交吗？')) return;

    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/scores`, { items, supplierName: scoringSupplier });
      loadProject();
      alert('评分提交成功！');
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  };

  /* ── 评审报告 ── */
  const loadReport = async () => {
    try {
      const data = await api.get<EvaluationReport>(`/expert/projects/${projectId}/report`);
      setReport(data);
    } catch (e: any) { alert(e.message); }
  };

  useEffect(() => { if (step === 'report') loadReport(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const handleConfirmReport = async () => {
    setBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/report/confirm`, { comment: '确认完成评审' });
      loadProject();
      alert('评审报告已确认！');
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  };

  if (loading || !project) return <div className="flex items-center justify-center h-64 text-[#5a6d8a]">加载中...</div>;

  const decryptLabel: Record<string, string> = { PENDING: '待解密', RUNNING: '解密中', SUCCESS: '已解密', DANGER: '异常' };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/expert/projects')} className="text-[#5a6d8a] hover:text-[#064ea2] transition">← 返回</button>
          <div className="w-px h-6 bg-[#e8f0fa]" />
          <h1 className="text-xl font-bold text-[#18243a]">{project.name}</h1>
          <span className="text-sm text-[#5a6d8a]">{project.projectCode}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#5a6d8a]">评审进度</span>
          <div className="w-40 h-2 bg-[#f0f4f8] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#064ea2] to-[#39a8ff] rounded-full transition-all duration-500"
              style={{ width: `${expert?.progress ?? 0}%` }} />
          </div>
          <span className="text-sm font-bold text-[#064ea2]">{expert?.progress ?? 0}%</span>
        </div>
      </div>

      {/* 步骤指示器 */}
      <div className="bg-white rounded-xl border border-[#e8f0fa] p-4 mb-4 flex-shrink-0">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <button onClick={() => setStep(s.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-semibold ${step === s.key ? 'bg-[#064ea2] text-white shadow-md' : 'text-[#5a6d8a] hover:bg-[#f8fbff]'}`}>
                <span>{s.icon}</span>{s.label}
              </button>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-[#e8f0fa] mx-2" />}
            </div>
          ))}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
        {/* 左侧 - 供应商列表 */}
        <div className="w-56 flex-shrink-0 bg-white rounded-xl border border-[#e8f0fa] overflow-y-auto">
          <div className="p-4 border-b border-[#e8f0fa]">
            <h3 className="font-bold text-sm text-[#18243a]">投标单位</h3>
            <p className="text-xs text-[#5a6d8a] mt-1">{project.suppliers.length} 家</p>
          </div>
          <div className="p-2">
            {project.suppliers.map(s => (
              <button key={s.id} onClick={() => { setActiveSupplier(s.id); setScoringSupplier(s.supplierName); }}
                className={`w-full text-left p-3 rounded-lg mb-1 text-sm transition-all ${activeSupplier === s.id ? 'bg-[#eef6ff] border border-[#b8d4f5]' : 'hover:bg-[#f8fbff] border border-transparent'}`}>
                <div className="font-semibold text-[#18243a] truncate">{s.supplierName}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.decryptStatus === 'SUCCESS' ? 'bg-[#11a874]' : s.decryptStatus === 'DANGER' ? 'bg-[#e74c3c]' : 'bg-[#f5a623]'}`} />
                  <span className="text-xs text-[#5a6d8a]">{decryptLabel[s.decryptStatus] || s.decryptStatus}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 右侧 - 主内容 */}
        <div className="flex-1 bg-white rounded-xl border border-[#e8f0fa] overflow-y-auto">
          {/* ====== 身份核验 ====== */}
          {step === 'verify' && (
            <div className="p-6 max-w-3xl mx-auto">
              <h2 className="text-xl font-bold text-[#18243a] mb-6">身份核验与承诺确认</h2>

              {/* 核验步骤 */}
              <div className="space-y-4 mb-6">
                {[
                  { label: '身份核验', desc: '确认您的专家身份信息', done: !!expert?.signedIn, action: !expert?.signedIn ? handleSignIn : undefined },
                  { label: '保密承诺', desc: '承诺不泄露评标过程中获取的信息', done: confidentialityAgreed, action: undefined },
                  { label: '回避确认', desc: '确认与投标单位无利益关系', done: !!expert?.avoidanceConfirmed, action: expert?.signedIn && !expert?.avoidanceConfirmed ? handleAvoidance : undefined },
                  { label: '评标纪律', desc: '遵守独立评审原则', done: disciplineAgreed, action: undefined },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${item.done ? 'bg-[#f0faf5] border-[#b8e8d0]' : 'bg-white border-[#e8f0fa]'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${item.done ? 'bg-[#11a874] text-white' : 'bg-[#f0f4f8] text-[#5a6d8a]'}`}>
                      {item.done ? '✓' : i + 1}
                    </div>
                    <div className="flex-1">
                      <h3 className={`font-bold ${item.done ? 'text-[#11a874]' : 'text-[#18243a]'}`}>{item.label}</h3>
                      <p className="text-sm text-[#5a6d8a]">{item.desc}</p>
                    </div>
                    {item.action && (
                      <button onClick={item.action} disabled={busy}
                        className="px-4 py-2 bg-[#064ea2] text-white text-sm rounded-lg hover:bg-[#0e62d0] transition disabled:opacity-50">
                        确认
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* 保密承诺书 */}
              <div className="bg-[#f8fbff] rounded-xl border border-[#e8f0fa] p-6 mb-4">
                <h3 className="font-bold text-[#18243a] mb-3">📋 保密承诺书</h3>
                <p className="text-sm text-[#5a6d8a] leading-relaxed mb-4">
                  本人作为本项目评审专家，郑重承诺：在评标过程中严格遵守保密规定，不向任何第三方泄露评标过程中获取的投标文件内容、评审意见及其他相关信息。如有违反，愿意承担相应法律责任。
                </p>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={confidentialityAgreed} onChange={e => setConfidentialityAgreed(e.target.checked)}
                    className="w-4 h-4 rounded border-[#b8d4f5] text-[#064ea2] focus:ring-[#064ea2]" />
                  <span className="text-sm text-[#18243a] font-semibold">本人已阅读并同意以上保密承诺</span>
                </label>
              </div>

              {/* 评标纪律 */}
              <div className="bg-[#f8fbff] rounded-xl border border-[#e8f0fa] p-6">
                <h3 className="font-bold text-[#18243a] mb-3">⚖️ 评标纪律承诺</h3>
                <ul className="space-y-2 text-sm text-[#5a6d8a] mb-4">
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>严格按照招标文件规定的评审标准和方法进行评审</li>
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>独立评审，不与其他专家串通或私下交流评审意见</li>
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>客观公正，不带任何偏见和个人倾向</li>
                  <li className="flex items-start gap-2"><span className="text-[#064ea2]">•</span>对评审过程和结果保密，不向任何人透露</li>
                </ul>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={disciplineAgreed} onChange={e => setDisciplineAgreed(e.target.checked)}
                    className="w-4 h-4 rounded border-[#b8d4f5] text-[#064ea2] focus:ring-[#064ea2]" />
                  <span className="text-sm text-[#18243a] font-semibold">本人已阅读并同意遵守以上评标纪律</span>
                </label>
              </div>

              {confidentialityAgreed && disciplineAgreed && expert?.signedIn && expert?.avoidanceConfirmed && (
                <div className="mt-4 p-4 bg-[#e8f8f0] rounded-xl border border-[#b8e8d0] flex items-center gap-3">
                  <span className="text-2xl">✅</span>
                  <div>
                    <h3 className="font-bold text-[#11a874]">核验完成</h3>
                    <p className="text-sm text-[#5a6d8a]">您已完成身份核验，可以开始评审工作</p>
                  </div>
                  <button onClick={() => setStep('documents')}
                    className="ml-auto px-5 py-2 bg-[#11a874] text-white rounded-lg font-semibold hover:bg-[#0f9e6a] transition text-sm">
                    进入标书获取 →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ====== 标书获取 ====== */}
          {step === 'documents' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[#18243a]">标书解密与获取</h2>
                  <p className="text-sm text-[#5a6d8a] mt-1">查看已解密的投标文件，支持在线预览和下载</p>
                </div>
                <span className="text-xs bg-[#eef6ff] text-[#064ea2] px-3 py-1.5 rounded-lg font-semibold">
                  当前供应商：{project.suppliers.find(s => s.id === activeSupplier)?.supplierName || '请选择'}
                </span>
              </div>

              {documents ? (
                <>
                  {/* 解密状态 */}
                  <div className={`flex items-center gap-3 p-4 rounded-xl mb-6 ${documents.canView ? 'bg-[#e8f8f0] border border-[#b8e8d0]' : 'bg-[#fff8e8] border border-[#fde68a]'}`}>
                    <span className="text-xl">{documents.canView ? '🔓' : '🔒'}</span>
                    <div>
                      <h3 className={`font-bold ${documents.canView ? 'text-[#11a874]' : 'text-[#f5a623]'}`}>
                        {documents.canView ? '标书已解密' : '标书尚未解密'}
                      </h3>
                      <p className="text-sm text-[#5a6d8a]">
                        {documents.canView ? '您可以查看和下载该供应商的投标文件' : '请等待开标主持端完成解密操作'}
                      </p>
                    </div>
                  </div>

                  {/* 文件列表 */}
                  {documents.canView && (
                    <div className="grid grid-cols-2 gap-4">
                      {documents.documents.map((doc, i) => (
                        <div key={i} className="flex items-center gap-4 p-4 bg-[#f8fbff] rounded-xl border border-[#e8f0fa] hover:shadow-md transition-all">
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#39a8ff] flex items-center justify-center text-white text-xs font-bold">
                            {doc.type}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-[#18243a] truncate">{doc.name}</h4>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-xs text-[#5a6d8a]">{doc.size}</span>
                              <span className="text-xs text-[#11a874] font-semibold">{doc.status}</span>
                            </div>
                          </div>
                          <button className="px-3 py-1.5 bg-[#064ea2] text-white text-xs rounded-lg hover:bg-[#0e62d0] transition">
                            📥 下载
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-[#5a6d8a]">
                  <div className="text-4xl mb-3">📄</div>
                  <p>请先在左侧选择一个投标单位查看标书</p>
                </div>
              )}
            </div>
          )}

          {/* ====== 辅助评标 ====== */}
          {step === 'assist' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[#18243a]">AI 辅助评标</h2>
                  <p className="text-sm text-[#5a6d8a] mt-1">智能符合性检查、风险分析与评分建议（仅供参考）</p>
                </div>
                <span className="text-xs bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg font-semibold">
                  当前供应商：{project.suppliers.find(s => s.id === activeSupplier)?.supplierName || '请选择'}
                </span>
              </div>

              {assistData ? (
                <div className="space-y-6">
                  {/* 符合性检查 */}
                  <div className="bg-[#f8fbff] rounded-xl border border-[#e8f0fa] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-[#18243a]">✅ 符合性检查</h3>
                      <span className={`text-sm font-semibold px-3 py-1 rounded-full ${assistData.complianceCheck.overall === '符合' ? 'bg-[#e8f8f0] text-[#11a874]' : 'bg-[#fff3e0] text-[#f5a623]'}`}>
                        综合结果：{assistData.complianceCheck.overall}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {assistData.complianceCheck.items.map((item, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-[#e8f0fa]">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs text-white ${item.status === 'pass' ? 'bg-[#11a874]' : 'bg-[#e74c3c]'}`}>
                            {item.status === 'pass' ? '✓' : '✗'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[#18243a]">{item.name}</div>
                            <div className="text-xs text-[#5a6d8a] truncate">{item.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 风险分析 */}
                  <div className="bg-[#f8fbff] rounded-xl border border-[#e8f0fa] p-5">
                    <h3 className="font-bold text-[#18243a] mb-4">⚠️ 风险分析</h3>
                    <div className="space-y-3">
                      {assistData.riskAnalysis.map((risk, i) => (
                        <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${risk.level === 'success' ? 'bg-[#f0faf5] border-[#b8e8d0]' : risk.level === 'warning' ? 'bg-[#fff8e8] border-[#fde68a]' : 'bg-[#eef6ff] border-[#b8d4f5]'}`}>
                          <span className="text-lg">{risk.level === 'success' ? '✅' : risk.level === 'warning' ? '⚠️' : 'ℹ️'}</span>
                          <div>
                            <span className="text-xs font-semibold text-[#5a6d8a] bg-white px-2 py-0.5 rounded mr-2">{risk.category}</span>
                            <span className="text-sm text-[#18243a]">{risk.content}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 评分建议 */}
                  <div className="bg-[#f8fbff] rounded-xl border border-[#e8f0fa] p-5">
                    <h3 className="font-bold text-[#18243a] mb-4">💡 评分建议</h3>
                    <div className="grid grid-cols-3 gap-4">
                      {assistData.scoreSuggestion.map((sug, i) => (
                        <div key={i} className="bg-white rounded-lg p-4 border border-[#e8f0fa]">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ color: CATEGORY_COLOR[sug.category], backgroundColor: CATEGORY_COLOR[sug.category] + '18' }}>
                              {CATEGORY_LABEL[sug.category] || sug.category}
                            </span>
                            <span className="text-xs text-[#5a6d8a]">{sug.name}</span>
                          </div>
                          <div className="text-2xl font-bold text-[#064ea2] mb-1">{sug.suggestedScore}</div>
                          <p className="text-xs text-[#5a6d8a]">{sug.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 关注要点 */}
                  <div className="bg-gradient-to-br from-[#f8fbff] to-[#eef6ff] rounded-xl border border-[#e8f0fa] p-5">
                    <h3 className="font-bold text-[#18243a] mb-3">🔑 评审关注要点</h3>
                    <ul className="space-y-2">
                      {assistData.keyPoints.map((point, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[#18243a]">
                          <span className="text-[#064ea2] mt-0.5 font-bold">{i + 1}.</span>{point}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-[#5a6d8a]">
                  <div className="text-4xl mb-3">🤖</div>
                  <p>请先在左侧选择一个投标单位查看辅助评标数据</p>
                </div>
              )}
            </div>
          )}

          {/* ====== 专家打分 ====== */}
          {step === 'scoring' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[#18243a]">专家独立打分</h2>
                  <p className="text-sm text-[#5a6d8a] mt-1">请根据您的专业判断，对每个评分项进行客观评分</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-[#5a6d8a]">评分对象：</label>
                  <select value={scoringSupplier} onChange={e => setScoringSupplier(e.target.value)}
                    className="text-sm border border-[#e8f0fa] rounded-lg px-3 py-2 bg-white focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none">
                    {project.suppliers.map(s => <option key={s.id} value={s.supplierName}>{s.supplierName}</option>)}
                  </select>
                </div>
              </div>

              {/* 按类别分组显示评分项 */}
              {(() => {
                const grouped: Record<string, typeof project.scoreItems> = {};
                project.scoreItems.forEach(si => {
                  if (!grouped[si.category]) grouped[si.category] = [];
                  grouped[si.category].push(si);
                });

                let categoryTotal = 0;
                let categoryScored = 0;

                return (
                  <div className="space-y-6">
                    {Object.entries(grouped).map(([category, items]) => {
                      const catTotal = items.reduce((s, i) => s + Number(i.maxScore), 0);
                      const catScored = items.reduce((s, i) => s + (scores[i.id]?.score ?? 0), 0);
                      return (
                        <div key={category} className="bg-[#f8fbff] rounded-xl border border-[#e8f0fa] overflow-hidden">
                          <div className="flex items-center justify-between p-4 border-b border-[#e8f0fa]" style={{ borderLeft: `4px solid ${CATEGORY_COLOR[category] || '#064ea2'}` }}>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{ color: CATEGORY_COLOR[category] || '#064ea2', backgroundColor: (CATEGORY_COLOR[category] || '#064ea2') + '18' }}>
                                {CATEGORY_LABEL[category] || category}
                              </span>
                              <span className="text-sm text-[#5a6d8a]">{items.length} 项</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-[#5a6d8a]">得分</span>
                              <span className="text-lg font-bold" style={{ color: CATEGORY_COLOR[category] || '#064ea2' }}>{catScored}</span>
                              <span className="text-sm text-[#5a6d8a]">/ {catTotal}</span>
                            </div>
                          </div>
                          <div className="p-4 space-y-4">
                            {items.map(item => {
                              const val = scores[item.id];
                              const currentScore = val?.score ?? 0;
                              const max = Number(item.maxScore);
                              const pct = max > 0 ? (currentScore / max) * 100 : 0;
                              return (
                                <div key={item.id} className="bg-white rounded-lg p-4 border border-[#e8f0fa]">
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="font-semibold text-[#18243a]">{item.name}</h4>
                                    <span className="text-sm text-[#5a6d8a]">满分 {max}</span>
                                  </div>
                                  <div className="flex items-center gap-4 mb-3">
                                    <input type="range" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [item.id]: { ...prev[item.id], score: parseFloat(e.target.value), reason: prev[item.id]?.reason || '' } }))}
                                      className="flex-1 h-2 bg-[#f0f4f8] rounded-full appearance-none cursor-pointer accent-[#064ea2]"
                                      style={{ background: `linear-gradient(to right, ${CATEGORY_COLOR[category] || '#064ea2'} ${pct}%, #f0f4f8 ${pct}%)` }} />
                                    <input type="number" min={0} max={max} step={0.5} value={currentScore}
                                      onChange={e => setScores(prev => ({ ...prev, [item.id]: { ...prev[item.id], score: Math.min(parseFloat(e.target.value) || 0, max), reason: prev[item.id]?.reason || '' } }))}
                                      className="w-20 text-center border border-[#e8f0fa] rounded-lg px-2 py-1.5 text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none" />
                                  </div>
                                  <textarea placeholder="评分理由（必填）" value={val?.reason || ''}
                                    onChange={e => setScores(prev => ({ ...prev, [item.id]: { score: prev[item.id]?.score ?? 0, reason: e.target.value } }))}
                                    className="w-full border border-[#e8f0fa] rounded-lg px-3 py-2 text-sm text-[#18243a] placeholder-[#b8c8d8] resize-none h-16 focus:border-[#064ea2] focus:ring-1 focus:ring-[#064ea2] outline-none" />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* 汇总 */}
                    <div className="bg-white rounded-xl border border-[#e8f0fa] p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg text-[#18243a]">评分汇总 — {scoringSupplier}</h3>
                        <div className="text-right">
                          <div className="text-3xl font-bold text-[#064ea2]">
                            {project.scoreItems.reduce((s, si) => s + (scores[si.id]?.score ?? 0), 0)}
                          </div>
                          <div className="text-sm text-[#5a6d8a]">
                            满分 {project.scoreItems.reduce((s, si) => s + Number(si.maxScore), 0)}
                          </div>
                        </div>
                      </div>
                      <button onClick={handleSubmitScores} disabled={busy}
                        className="w-full py-3 bg-[#064ea2] text-white rounded-lg font-bold text-sm hover:bg-[#0e62d0] transition disabled:opacity-50">
                        {busy ? '提交中...' : `提交 ${scoringSupplier} 的评分`}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ====== 评审报告 ====== */}
          {step === 'report' && (
            <div className="p-6 max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-[#18243a]">评审报告</h2>
                  <p className="text-sm text-[#5a6d8a] mt-1">查看您的评审结果汇总，确认后不可修改</p>
                </div>
                {report?.canConfirm && (
                  <button onClick={handleConfirmReport} disabled={busy}
                    className="px-6 py-2.5 bg-[#11a874] text-white rounded-lg font-semibold hover:bg-[#0f9e6a] transition disabled:opacity-50">
                    {busy ? '确认中...' : '✓ 确认评审报告'}
                  </button>
                )}
              </div>

              {report ? (
                <div className="space-y-6">
                  {/* 报告头 */}
                  <div className="bg-gradient-to-r from-[#042a58] to-[#064ea2] text-white rounded-xl p-6">
                    <h3 className="text-xl font-bold mb-2">{report.projectName}</h3>
                    <div className="flex items-center gap-6 text-sm text-white/80">
                      <span>项目编号：{report.projectCode}</span>
                      <span>评审专家：{report.expertName}</span>
                      <span>完成度：{report.expertProgress}%</span>
                    </div>
                  </div>

                  {/* 供应商评分汇总 */}
                  {report.supplierScores.map((ss, i) => (
                    <div key={i} className="bg-white rounded-xl border border-[#e8f0fa] overflow-hidden">
                      <div className="flex items-center justify-between p-5 border-b border-[#e8f0fa]">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#39a8ff] flex items-center justify-center text-white font-bold text-sm">
                            {i + 1}
                          </div>
                          <h3 className="font-bold text-[#18243a]">{ss.supplierName}</h3>
                          {ss.completed && <span className="text-xs bg-[#e8f8f0] text-[#11a874] px-2 py-0.5 rounded font-semibold">评分完整</span>}
                        </div>
                        <div className="text-2xl font-bold text-[#064ea2]">{ss.totalScore} <span className="text-sm text-[#5a6d8a] font-normal">分</span></div>
                      </div>
                      {Object.entries(ss.categoryScores).length > 0 && (
                        <div className="p-5 grid grid-cols-3 gap-3">
                          {Object.entries(ss.categoryScores).map(([cat, data]) => (
                            <div key={cat} className="bg-[#f8fbff] rounded-lg p-3" style={{ borderLeft: `3px solid ${CATEGORY_COLOR[cat] || '#064ea2'}` }}>
                              <div className="text-xs font-semibold mb-1" style={{ color: CATEGORY_COLOR[cat] || '#064ea2' }}>{CATEGORY_LABEL[cat] || cat}</div>
                              <div className="text-lg font-bold text-[#18243a]">{data.total} <span className="text-xs text-[#5a6d8a] font-normal">/ {data.max}</span></div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {!report.canConfirm && (
                    <div className="bg-[#fff8e8] rounded-xl border border-[#fde68a] p-4 flex items-center gap-3">
                      <span className="text-xl">⚠️</span>
                      <p className="text-sm text-[#f5a623]">请先完成所有供应商的评分后再确认报告</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-[#5a6d8a]">加载报告数据...</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
