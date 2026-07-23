'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { draftClarification, summarizeClarification } from '@/lib/api/bid';
import type { BidProjectDetail, BidClarification } from '@/lib/types';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { MessageSquare, Plus, AlertTriangle, X, Send, Sparkles, FileText } from 'lucide-react';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { useReportRealtime } from '@/contexts/bid-realtime-context';
import NoProjectGuide from '@/components/no-project-guide';

/** 书面来函（type=question）携带可选附件 —— 共享类型 BidClarification 暂无 fileAssetId 字段，前端按实际响应扩展 */
type WrittenLetter = BidClarification & { fileAssetId?: string };

export default function BidClarificationsPage() {
  const { projectId } = useBidProjectContext();
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<BidClarification[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [issuer, setIssuer] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [clarType, setClarType] = useState('clarification');
  const [submitting, setSubmitting] = useState(false);
  const [replying, setReplying] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [summarizing, setSummarizing] = useState<string | null>(null);

  // P1-F：AI 起草澄清问题候选（填入 textarea，专家改完再发）
  const handleDraft = async () => {
    if (!projectId) return;
    if (!selectedSupplierId) { toast.error('请先选择供应商'); return; }
    setDrafting(true);
    try {
      const res: any = await draftClarification(projectId, selectedSupplierId);
      const drafts: string[] = res?.drafts ?? res?.data?.drafts ?? [];
      if (drafts.length) {
        setQuestion(drafts[0]);
        toast.success(`AI 已起草 ${drafts.length} 条候选，已填入第一条，请审阅修改`);
      } else {
        toast.info('AI 暂无起草建议（该供应商可能无 AI 分析弱点）');
      }
    } catch (e: any) {
      toast.error(e.message || 'AI 起草失败');
    } finally {
      setDrafting(false);
    }
  };

  // P1-F：AI 提炼回复要点 → aiSummary
  const handleSummarize = async (cid: string) => {
    if (!projectId) return;
    setSummarizing(cid);
    try {
      const res: any = await summarizeClarification(projectId, cid);
      const aiSummary: string | undefined = res?.aiSummary ?? res?.data?.aiSummary;
      if (aiSummary) {
        setClarifications(prev => prev.map(c => c.id === cid ? { ...c, aiSummary } : c));
        toast.success('AI 摘要已生成');
      } else {
        toast.info('AI 暂无法生成摘要');
      }
    } catch (e: any) {
      toast.error(e.message || 'AI 摘要失败');
    } finally {
      setSummarizing(null);
    }
  };

  const load = () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<BidProjectDetail>(`/bid/projects/${projectId}`),
      api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`).catch(() => []),
    ])
      .then(([p, cls]) => { setProject(p); setClarifications(cls); })
      .catch((e) => { setError(e?.message || '加载澄清数据失败'); toast.error(e?.message || '加载澄清数据失败'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 实时推送：新澄清 / 供应商回复（事件为轻量预览，直接刷新列表保证一致）
  const { connection, lastEventAt, reconnectNow } = useBidWebSocket(projectId || undefined, {
    onClarificationCreated: (data) => {
      toast.success(`新澄清 · ${data.supplierName}`);
      if (!projectId) return;
      api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`).then(setClarifications).catch(() => {});
    },
    onClarificationReplied: (data) => {
      toast.success(`${data.replier} 回复了澄清`);
      if (!projectId) return;
      api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`).then(setClarifications).catch(() => {});
    },
  });

  useReportRealtime(connection, lastEventAt, reconnectNow);

  const handleReply = async (cid: string) => {
    if (!projectId) return;
    if (!replyText.trim()) { toast.error('请先填写回复内容'); return; }
    setSubmitting(true);
    try {
      await api.patch(`/bid/projects/${projectId}/clarifications/${cid}/reply`, { reply: replyText });
      toast.success('回复已发送');
      setReplying(null); setReplyText(''); load();
    } catch (e: any) { toast.error(e.message || '回复失败'); }
    setSubmitting(false);
  };

  const handleCreate = async () => {
    if (!projectId) return;
    if (!question.trim()) { toast.error('请输入澄清问题'); return; }
    if (!issuer.trim()) { toast.error('请输入发起人'); return; }
    if (!supplierName.trim()) { toast.error('请输入供应商名称'); return; }
    setSubmitting(true);
    try {
      await api.post(`/bid/projects/${projectId}/clarifications`, {
        type: clarType,
        question: question.trim(),
        issuer: issuer.trim(),
        supplierName: supplierName.trim(),
        supplierId: selectedSupplierId || undefined,
      });
      toast.success('澄清已发起');
      setShowForm(false);
      setQuestion('');
      setIssuer('');
      setSupplierName('');
      setSelectedSupplierId('');
      setClarType('clarification');
      const updated = await api.get<BidClarification[]>(`/bid/projects/${projectId}/clarifications`);
      setClarifications(updated);
    } catch (e: any) {
      toast.error(e.message || '发起失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 书面来函：供应商经书面交流渠道提交的 type=question 记录（异步，无实时推送）
  const letters = clarifications.filter((c): c is WrittenLetter => c.type === 'question');

  if (!projectId) return <NoProjectGuide />;
  if (loading) return <TableSkeleton rows={6} cols={4} />;
  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <AlertTriangle size={28} strokeWidth={1.5} className="text-[oklch(0.50_0.18_22)] mb-3" />
      <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">{error}</p>
      <button onClick={load} className="mt-4 px-4 py-2 rounded-xl bg-[#064ea2] text-white text-xs font-bold hover:bg-[#054280] transition">重试</button>
    </div>
  );
  if (!project) return (
    <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">
      暂无项目数据
    </div>
  );
  if (!projectId) return null;

  return (
    <div className="space-y-6">
      {/* Action bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 text-[12px] text-[oklch(0.55_0.01_264)]">
          <MessageSquare size={13} strokeWidth={1.5} />
          项目：{project.projectCode} — {project.name}
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={project?.stage === 'ARCHIVED'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50"
        >
          <Plus size={13} strokeWidth={2} /> 发起澄清
        </button>
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="glass-card glass-card-deeper glass-card-cyan w-full max-w-[520px] rounded-2xl shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[oklch(0.91_0.006_264)]">
              <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
                style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
                发起澄清
              </h2>
              <button onClick={() => setShowForm(false)} className="text-[oklch(0.62_0.008_264)] hover:text-[oklch(0.18_0.012_265)] transition-colors">
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  类型 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <select value={clarType} onChange={e => setClarType(e.target.value)}
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white/65 focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors">
                  <option value="clarification">澄清（招标人发起）</option>
                  <option value="question">答疑（回复供应商提问）</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  发起人 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <input value={issuer} onChange={e => setIssuer(e.target.value)}
                  placeholder="例：评标委员会"
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white/65 focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors placeholder:text-[oklch(0.72_0.008_264)]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  供应商 <span className="text-[oklch(0.50_0.18_22)]">*</span>
                </label>
                <select value={supplierName} onChange={e => {
                    const sel = project.suppliers.find(s => s.supplierName === e.target.value);
                    setSupplierName(e.target.value);
                    setSelectedSupplierId(sel?.supplierId || '');
                  }}
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white/65 focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors">
                  <option value="">选择供应商</option>
                  {project.suppliers.map(s => (
                    <option key={s.id} value={s.supplierName}>{s.supplierName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-wider mb-1.5">
                  <span>澄清问题 <span className="text-[oklch(0.50_0.18_22)]">*</span></span>
                  <button type="button" onClick={handleDraft} disabled={drafting || !selectedSupplierId}
                    className="flex items-center gap-1 text-[11px] font-medium text-[oklch(0.42_0.14_260)] hover:underline disabled:opacity-40 normal-case tracking-normal">
                    <Sparkles size={11} /> {drafting ? '起草中…' : 'AI 起草'}
                  </button>
                </label>
                <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={4}
                  placeholder="请输入需要供应商澄清的问题…"
                  className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white/65 focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors resize-none placeholder:text-[oklch(0.72_0.008_264)]" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[oklch(0.91_0.006_264)] flex items-center justify-end gap-3">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 text-[12px] font-semibold text-[oklch(0.55_0.01_264)] tracking-tight hover:text-[oklch(0.18_0.012_265)] transition-colors">
                取消
              </button>
              <button onClick={handleCreate} disabled={submitting}
                className="flex items-center gap-1.5 px-5 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
                <Send size={13} strokeWidth={2} />
                {submitting ? '发送中…' : '发起澄清'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 书面来函（供应商书面交流来函，type=question） */}
      <div className="glass-card glass-card-blue rounded-2xl">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">
            书面来函
          </h2>
          <p className="mt-1 text-[11px] text-[oklch(0.62_0.008_264)]">
            供应商经书面交流渠道提交的来函（异步，需回复请致电或发起澄清）
          </p>
        </div>
        {letters.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">
            暂无书面来函
          </div>
        ) : (
          <div className="divide-y divide-[oklch(0.94_0.004_264)]">
            {letters.map(c => (
              <div key={c.id} className="px-5 py-3">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="font-medium text-[oklch(0.42_0.14_260)]">{c.supplierName}</span>
                  <span className="text-[oklch(0.62_0.008_264)] font-mono whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleString('zh-CN')}
                  </span>
                  {c.fileAssetId && (
                    /* 受保护下载：不可加 rel="noreferrer"（丢 Referer → portal 识别失败 401，项目既有坑） */
                    <a
                      href={`/api/upload/files/${c.fileAssetId}`}
                      target="_blank"
                      rel="noopener"
                      className="ml-auto text-xs text-blue-600 underline"
                    >
                      附件下载
                    </a>
                  )}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[oklch(0.18_0.012_265)] whitespace-pre-line">{c.question}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clarifications Table */}
      <div className="glass-card glass-card-blue rounded-2xl">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">
            澄清记录
          </h2>
        </div>
        {clarifications.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]" data-mock-row="">
            暂无澄清记录
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">类型</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">发起人</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">供应商</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">问题</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">状态</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">回复</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">时间</th>
                <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {clarifications.map(c => {
                const isReplied = c.reply;
                const isReplying = replying === c.id;
                const statusLabel = c.status || (isReplied ? '已回复' : '待回复');
                const statusColor = statusLabel === '已回复' ? '#11a874' : statusLabel === '已关闭' ? '#6b7280' : '#f5a623';
                return (<Fragment key={c.id}>
                <tr className={`border-b border-[oklch(0.94_0.004_264)] align-top ${isReplied ? '' : 'bg-amber-50/30'}`}>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{
                      color: c.type === 'question' ? '#7c3aed' : '#f5a623',
                      backgroundColor: c.type === 'question' ? '#7c3aed18' : '#f5a62318',
                    }}>{c.type === 'question' ? '答疑' : '澄清'}</span>
                  </td>
                  <td className="px-5 py-3 text-[oklch(0.42_0.14_260)] font-medium">{c.issuer}</td>
                  <td className="px-5 py-3 text-[oklch(0.18_0.012_265)]">{c.supplierName}</td>
                  <td className="px-5 py-3 text-[oklch(0.18_0.012_265)] max-w-[200px]">{c.question}</td>
                  <td className="px-5 py-3">
                    <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: statusColor, backgroundColor: statusColor + '18' }}>{statusLabel}</span>
                  </td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)] max-w-[220px]">
                    {c.reply ? (
                      <div className="space-y-1">
                        <div>{c.reply}</div>
                        {c.aiSummary && (
                          <div className="text-[11px] text-[oklch(0.42_0.14_260)] bg-[oklch(0.96_0.02_260)] rounded px-2 py-1 whitespace-pre-line">
                            <span className="font-semibold">AI 摘要：</span>{c.aiSummary}
                          </div>
                        )}
                      </div>
                    ) : <span className="text-[oklch(0.72_0.008_264)]">—</span>}
                  </td>
                  <td className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)] font-mono whitespace-nowrap">
                    {new Date(c.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-5 py-3">
                    {!isReplied ? (
                      isReplying ? (
                        <span className="text-[11px] text-[oklch(0.55_0.01_264)]">回复中…</span>
                      ) : project?.stage !== 'ARCHIVED' ? (
                        <button onClick={() => { setReplying(c.id); setReplyText(''); }}
                          className="text-[11px] font-semibold text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] transition-colors">
                          回复
                        </button>
                      ) : (
                        <span className="text-[11px] text-[oklch(0.62_0.008_264)]">已归档</span>
                      )
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-[oklch(0.62_0.008_264)]">已回复</span>
                        {isReplied && !c.aiSummary && project?.stage !== 'ARCHIVED' && (
                          <button onClick={() => handleSummarize(c.id)} disabled={summarizing === c.id}
                            className="flex items-center gap-0.5 text-[10px] font-semibold text-[oklch(0.42_0.14_260)] hover:underline disabled:opacity-40">
                            <FileText size={10} /> {summarizing === c.id ? '摘要中…' : 'AI 摘要'}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
                {isReplying && (
                  <tr key={`${c.id}-reply`}>
                    <td colSpan={8} className="bg-[oklch(0.98_0.005_264)] border-b border-[oklch(0.91_0.006_264)]">
                      <div className="px-5 py-3 space-y-3">
                        <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                          placeholder="输入回复内容…" rows={3}
                          className="w-full px-3 py-2 text-[13px] border border-[oklch(0.91_0.006_264)] bg-white/65 focus:outline-none focus:border-[oklch(0.42_0.14_260)] transition-colors placeholder:text-[oklch(0.72_0.008_264)] resize-none" />
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setReplying(null)}
                            className="px-3 py-1.5 text-[11px] font-semibold text-[oklch(0.55_0.01_264)] border border-[oklch(0.91_0.006_264)] rounded hover:bg-[oklch(0.992_0.003_264)] transition">取消</button>
                          <button onClick={() => handleReply(c.id)} disabled={submitting}
                            className="px-4 py-1.5 text-[11px] font-bold text-white bg-[oklch(0.42_0.14_260)] rounded hover:bg-[oklch(0.50_0.16_258)] transition disabled:opacity-50">
                            {submitting ? '发送中…' : '发送回复'}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );})}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
