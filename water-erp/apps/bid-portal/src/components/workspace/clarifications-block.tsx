'use client';

/**
 * 澄清答疑区块——:3007 项目工作区「评标管理」tab（分工 v3 自 :3005 迁回现场）。
 * 澄清/答疑记录表、发起澄清、内联回复、AI 起草候选问题、AI 摘要、书面来函（含受保护附件下载）。
 * 实时性由父组件的 socket 刷新驱动（project 变化时重拉列表）。
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, CheckCircle2, FileSignature, FileText, MessageSquare, Plus, Send, Sparkles, X } from 'lucide-react';
import {
  createClarification,
  draftClarification,
  listClarifications,
  registerOfflineReply,
  replyClarification,
  summarizeClarification,
  verifyClarificationReply,
  type BidClarificationInfo,
} from '@/lib/api/evaluation';
import type { BidProjectDetail } from '@/lib/types';

type Props = {
  bidProjectId: string;
  detail: BidProjectDetail | null;
  onChanged: () => void;
  /** 远程澄清事件信号（页级 WS onClarificationCreated/Replied/onReconnected 递增）——变化即重拉列表 */
  refreshSignal?: number;
};

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export function ClarificationsBlock({ bidProjectId, detail, onChanged, refreshSignal }: Props) {
  const [items, setItems] = useState<BidClarificationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  // 发起表单
  const [showForm, setShowForm] = useState(false);
  const [clarType, setClarType] = useState('clarification');
  const [issuer, setIssuer] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [question, setQuestion] = useState('');
  const [drafting, setDrafting] = useState(false);

  // 回复
  const [replying, setReplying] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [summarizing, setSummarizing] = useState<string | null>(null);

  // A-143：离线答复登记模态 + 核验中标记
  const [offlineFor, setOfflineFor] = useState<string | null>(null);
  const [offlineReply, setOfflineReply] = useState('');
  const [offlineReason, setOfflineReason] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), 2800);
  };

  const load = useCallback(() => {
    setLoading(true);
    listClarifications(bidProjectId)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [bidProjectId]);

  // 按项目挂载拉取；增量刷新有两条：本块内发起/回复成功后 handler 直接 load()，
  // 远程事件（专家发起 / 供应商回复 / 断线重连补偿）经 refreshSignal 触发重拉（2026-08-14 现场协同实时化）
  useEffect(() => { load(); }, [load, refreshSignal]);

  if (!detail) return null;
  const stage = detail.stage;
  if (stage !== 'OPENING' && stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;
  const archived = stage === 'ARCHIVED';

  /* ── AI 起草候选问题（填入输入框，人工审阅后再发）── */
  async function handleDraft() {
    if (!selectedSupplierId) { showToast('请先选择供应商', 'err'); return; }
    setDrafting(true);
    try {
      const res = await draftClarification(bidProjectId, selectedSupplierId);
      if (res.drafts.length > 0) {
        setQuestion(res.drafts[0]);
        showToast(`AI 已起草 ${res.drafts.length} 条候选，已填入第一条，请审阅修改`);
      } else {
        showToast('AI 暂无起草建议（该供应商可能无 AI 分析弱点）');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'AI 起草失败', 'err');
    } finally {
      setDrafting(false);
    }
  }

  /* ── AI 提炼回复要点 ── */
  async function handleSummarize(cid: string) {
    setSummarizing(cid);
    try {
      const res = await summarizeClarification(bidProjectId, cid);
      if (res.aiSummary) {
        setItems(prev => prev.map(c => (c.id === cid ? { ...c, aiSummary: res.aiSummary } : c)));
        showToast('AI 摘要已生成');
      } else {
        showToast('AI 暂无法生成摘要');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'AI 摘要失败', 'err');
    } finally {
      setSummarizing(null);
    }
  }

  async function handleCreate() {
    if (!question.trim()) { showToast('请输入澄清问题', 'err'); return; }
    if (!issuer.trim()) { showToast('请输入发起人', 'err'); return; }
    if (!supplierName.trim()) { showToast('请选择供应商', 'err'); return; }
    setBusy(true);
    try {
      await createClarification(bidProjectId, {
        type: clarType,
        question: question.trim(),
        issuer: issuer.trim(),
        supplierName: supplierName.trim(),
        supplierId: selectedSupplierId || undefined,
      });
      showToast('澄清已发起');
      setShowForm(false);
      setQuestion(''); setIssuer(''); setSupplierName(''); setSelectedSupplierId(''); setClarType('clarification');
      load();
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '发起失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function handleReply(cid: string) {
    if (!replyText.trim()) { showToast('请先填写回复内容', 'err'); return; }
    setBusy(true);
    try {
      await replyClarification(bidProjectId, cid, { reply: replyText.trim() });
      showToast('回复已发送');
      setReplying(null); setReplyText('');
      load();
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '回复失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  /* ── A-143：离线答复登记（降级通道：供应商线下书面/电话答复后的留痕）── */
  async function handleOfflineRegister(cid: string) {
    if (!offlineReply.trim() || !offlineReason.trim()) { showToast('答复内容与离线缘由均必填', 'err'); return; }
    setBusy(true);
    try {
      await registerOfflineReply(bidProjectId, cid, { reply: offlineReply.trim(), offlineReason: offlineReason.trim() });
      showToast('已登记离线答复');
      setOfflineFor(null); setOfflineReply(''); setOfflineReason('');
      load(); onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '登记失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  /* ── A-143：核验供应商在线答复签名 ── */
  async function handleVerify(cid: string) {
    setVerifying(cid);
    try {
      const res = await verifyClarificationReply(bidProjectId, cid);
      if (res.valid) showToast(`签名有效 · 证书 ${res.certSn.slice(-8)}（${res.bindingStatus}）`);
      else showToast(`签名核验未通过（证书状态 ${res.bindingStatus}）`, 'err');
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '核验失败', 'err');
    } finally {
      setVerifying(null);
    }
  }

  // 书面来函：供应商经书面交流渠道提交的 type=question 记录
  const letters = items.filter(c => c.type === 'question');

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
            style={{ background: 'color-mix(in oklch, var(--warning) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
          >
            <MessageSquare size={15} className="text-[var(--warning)]" />
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">澄清答疑</h3>
        </div>
        {!archived && (
          <button type="button" onClick={() => setShowForm(true)} className="neu-btn-primary !h-[32px] !text-xs">
            <Plus size={13} /> 发起澄清
          </button>
        )}
      </div>

      {feedback && (
        <div
          className="mb-3 flex items-center gap-2 rounded-[12px] px-3.5 py-2.5 text-xs font-semibold"
          style={{
            background: feedback.tone === 'ok' ? 'color-mix(in oklch, var(--success) 10%, transparent)' : 'color-mix(in oklch, var(--danger) 10%, transparent)',
            color: feedback.tone === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {feedback.tone === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {feedback.text}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载澄清数据…</div>
      ) : (
        <div className="space-y-3">
          {/* 书面来函 */}
          <div className="rounded-[14px]" style={{ border: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
            <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.1)', background: 'oklch(0.975 0.012 258 / 0.5)' }}>
              <span className="text-[11px] font-bold text-[var(--foreground)]">书面来函</span>
              <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">供应商经书面交流渠道提交（异步；需回复请致电或发起澄清）</span>
            </div>
            {letters.length === 0 ? (
              <div className="px-3.5 py-6 text-center text-xs text-[var(--muted-foreground)]">暂无书面来函</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.1)' }}>
                {letters.map(c => (
                  <div key={c.id} className="px-3.5 py-2.5" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.1)' }}>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-semibold text-[var(--accent-strong)]">{c.supplierName}</span>
                      <span className="tabular-nums text-[var(--muted-foreground)]">{formatTime(c.createdAt)}</span>
                      {c.fileAssetId && (
                        /* 受保护下载：不可加 rel="noreferrer"（丢 Referer → portal 识别失败 401） */
                        <a
                          href={`/api/upload/files/${c.fileAssetId}`}
                          target="_blank"
                          rel="noopener"
                          className="ml-auto text-[11px] font-semibold text-[var(--accent)] underline"
                        >
                          附件下载
                        </a>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs leading-5 text-[var(--foreground)]">{c.question}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 澄清记录表 */}
          <div className="overflow-hidden rounded-[14px]" style={{ border: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]" style={{ background: 'oklch(0.975 0.012 258 / 0.5)' }}>
                  <th className="px-3.5 py-2">类型</th>
                  <th className="px-3.5 py-2">发起人</th>
                  <th className="px-3.5 py-2">供应商</th>
                  <th className="px-3.5 py-2">问题</th>
                  <th className="px-3.5 py-2">状态</th>
                  <th className="px-3.5 py-2">回复</th>
                  <th className="px-3.5 py-2">时间</th>
                  <th className="px-3.5 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={8} className="px-3.5 py-6 text-center text-[var(--muted-foreground)]">暂无澄清记录</td></tr>
                ) : (
                  items.map(c => {
                    const isReplied = !!c.reply;
                    const isReplying = replying === c.id;
                    const statusLabel = c.status || (isReplied ? '已回复' : '待回复');
                    const statusColor =
                      statusLabel === '已回复' ? 'var(--success)' : statusLabel === '已关闭' ? 'var(--muted-foreground)' : 'var(--warning)';
                    return (
                      <Fragment key={c.id}>
                        <tr style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)', background: isReplied ? undefined : 'color-mix(in oklch, var(--warning) 4%, transparent)' }} className="align-top">
                          <td className="px-3.5 py-2.5">
                            <span
                              className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{
                                color: c.type === 'question' ? 'var(--accent)' : 'var(--warning)',
                                background: c.type === 'question' ? 'color-mix(in oklch, var(--accent) 10%, transparent)' : 'color-mix(in oklch, var(--warning) 12%, transparent)',
                              }}
                            >
                              {c.type === 'question' ? '答疑' : '澄清'}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 font-medium text-[var(--accent-strong)]">{c.issuer}</td>
                          <td className="px-3.5 py-2.5 text-[var(--foreground)]">{c.supplierName}</td>
                          <td className="max-w-[200px] px-3.5 py-2.5 text-[var(--foreground)]">{c.question}</td>
                          <td className="px-3.5 py-2.5">
                            <span
                              className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ color: statusColor, background: `color-mix(in oklch, ${statusColor} 12%, transparent)` }}
                            >
                              {statusLabel}
                            </span>
                          </td>
                          <td className="max-w-[220px] px-3.5 py-2.5 text-[var(--muted-foreground)]">
                            {c.reply ? (
                              <div className="space-y-1">
                                <div>{c.reply}</div>
                                {c.replyAttachmentIds?.length ? (
                                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                                    {c.replyAttachmentIds.map(a => (
                                      /* 受保护下载禁用 noreferrer（丢 Referer → 401） */
                                      <a key={a.fileAssetId} href={`/api/upload/files/${a.fileAssetId}`} target="_blank" rel="noopener"
                                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]"
                                        style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)' }}>
                                        <FileSignature size={10} /> {a.name}
                                      </a>
                                    ))}
                                  </div>
                                ) : null}
                                {c.replyChannel === 'online' && c.replySignature && (
                                  <div className="text-[10px] text-[var(--muted-foreground)]">
                                    电子签名 {c.replySignature.algorithm ?? 'SM2/SM3'} · 证书 {c.replySignature.certSn?.slice(-8)} · 验签 {formatTime(c.replySignature.verifiedAt ?? null)}
                                  </div>
                                )}
                                {c.replyChannel === 'offline' && c.replyOfflineReason && (
                                  <div className="text-[10px] text-[var(--muted-foreground)]">离线登记缘由：{c.replyOfflineReason}</div>
                                )}
                                {c.aiSummary && (
                                  <div className="whitespace-pre-line rounded-[8px] px-2 py-1 text-[10px] text-[var(--accent-strong)]" style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)' }}>
                                    <span className="font-bold">AI 摘要：</span>{c.aiSummary}
                                  </div>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 tabular-nums text-[10px] text-[var(--muted-foreground)]">{formatTime(c.createdAt)}</td>
                          <td className="px-3.5 py-2.5">
                            {!isReplied ? (
                              archived ? (
                                <span className="text-[10px] text-[var(--muted-foreground)]">已归档</span>
                              ) : c.type === 'question' ? (
                                isReplying ? (
                                  <span className="text-[10px] text-[var(--muted-foreground)]">回复中…</span>
                                ) : (
                                  <button type="button" onClick={() => { setReplying(c.id); setReplyText(''); }} className="neu-btn-soft !h-[26px] !px-2 !text-[11px]">回复</button>
                                )
                              ) : (
                                /* A-143：澄清答复归供应商门户；主持端仅离线登记降级通道 */
                                <button type="button" onClick={() => { setOfflineFor(c.id); setOfflineReply(''); setOfflineReason(''); }} className="neu-btn-soft !h-[26px] !px-2 !text-[11px]">离线登记</button>
                              )
                            ) : (
                              <div className="flex flex-col items-start gap-1">
                                <span className="text-[10px] text-[var(--muted-foreground)]">
                                  {c.replyChannel === 'online' ? '在线签名' : c.replyChannel === 'offline' ? '离线登记' : '已回复'}
                                </span>
                                {c.replyChannel === 'online' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleVerify(c.id)}
                                    disabled={verifying === c.id}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-40"
                                  >
                                    <BadgeCheck size={10} /> {verifying === c.id ? '核验中…' : '核验签名'}
                                  </button>
                                )}
                                {!c.aiSummary && !archived && (
                                  <button
                                    type="button"
                                    onClick={() => void handleSummarize(c.id)}
                                    disabled={summarizing === c.id}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-40"
                                  >
                                    <FileText size={10} /> {summarizing === c.id ? '摘要中…' : 'AI 摘要'}
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                        {isReplying && (
                          <tr key={`${c.id}-reply`}>
                            <td colSpan={8} className="px-3.5 py-3" style={{ background: 'oklch(0.975 0.012 258 / 0.5)', borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)' }}>
                              <div className="space-y-2">
                                <textarea
                                  value={replyText}
                                  onChange={e => setReplyText(e.target.value)}
                                  placeholder="输入回复内容…"
                                  rows={3}
                                  className="workbench-input w-full !text-xs resize-none"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <button type="button" onClick={() => setReplying(null)} className="neu-btn-soft !h-[30px] !text-[11px]">取消</button>
                                  <button type="button" onClick={() => void handleReply(c.id)} disabled={busy} className="neu-btn-primary !h-[30px] !text-[11px]">
                                    <Send size={12} /> {busy ? '发送中…' : '发送回复'}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 发起澄清对话框 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}>
          <div className="w-full max-w-[520px] rounded-[20px]" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <h2 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">发起澄清</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3.5 px-6 py-5">
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">类型</label>
                <select value={clarType} onChange={e => setClarType(e.target.value)} className="workbench-input w-full">
                  <option value="clarification">澄清（招标人发起）</option>
                  <option value="question">答疑（回复供应商提问）</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">发起人</label>
                <input value={issuer} onChange={e => setIssuer(e.target.value)} placeholder="例：评标委员会" className="workbench-input w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">供应商</label>
                <select
                  value={selectedSupplierId}
                  onChange={e => {
                    // F3：澄清供应商契约 = BidSupplier.id（行 id）——专家端校验、AI 起草
                    // （bidSupplierId）、后端落库转换全按行 id；同名供应商也不会错行
                    const sel = detail.suppliers.find(s => s.id === e.target.value);
                    setSelectedSupplierId(e.target.value);
                    setSupplierName(sel?.supplierName ?? '');
                  }}
                  className="workbench-input w-full"
                >
                  <option value="">选择供应商</option>
                  {detail.suppliers.filter(s => s.bidValidity !== 'invalid').map(s => (
                    <option key={s.id} value={s.id}>{s.supplierName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                  <span>澄清问题</span>
                  <button
                    type="button"
                    onClick={() => void handleDraft()}
                    disabled={drafting || !selectedSupplierId}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold normal-case tracking-normal text-[var(--accent)] hover:underline disabled:opacity-40"
                  >
                    <Sparkles size={11} /> {drafting ? '起草中…' : 'AI 起草'}
                  </button>
                </label>
                <textarea
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  rows={4}
                  placeholder="请输入需要供应商澄清的问题…"
                  className="workbench-input w-full resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <button type="button" onClick={() => setShowForm(false)} className="neu-btn-soft !h-[36px] !text-xs">取消</button>
              <button type="button" onClick={() => void handleCreate()} disabled={busy} className="neu-btn-primary !h-[36px] !text-xs">
                <Send size={13} /> {busy ? '发送中…' : '发起澄清'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* A-143：离线答复登记对话框（降级通道） */}
      {offlineFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}>
          <div className="w-full max-w-[480px] rounded-[20px]" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <h2 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">离线答复登记</h2>
              <button type="button" onClick={() => setOfflineFor(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3.5 px-6 py-5">
              <p className="text-[11px] leading-5 text-[var(--muted-foreground)]">
                评标澄清的在线答复已由供应商经门户电子签名提交；此处仅登记供应商经书面/电话等线下途径作出的答复（降级留痕，无电子签名）。
              </p>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">线下答复内容</label>
                <textarea value={offlineReply} onChange={e => setOfflineReply(e.target.value)} rows={3} className="workbench-input w-full resize-none" placeholder="录入供应商线下答复原文…" />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">离线缘由（必填）</label>
                <input value={offlineReason} onChange={e => setOfflineReason(e.target.value)} className="workbench-input w-full" placeholder="例：供应商书面来函，扫描件另存" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <button type="button" onClick={() => setOfflineFor(null)} className="neu-btn-soft !h-[36px] !text-xs">取消</button>
              <button type="button" onClick={() => void handleOfflineRegister(offlineFor)} disabled={busy} className="neu-btn-primary !h-[36px] !text-xs">
                {busy ? '登记中…' : '确认登记'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
