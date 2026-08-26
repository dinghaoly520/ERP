'use client';

/**
 * B2: 流标确认对话框——串联 abort + 公告 + 归档为一步流程。
 * 替代原来 onAbort 只打开 AnnouncementPublishWizard 的断链行为。
 */

import { useEffect, useState } from 'react';
import { Ban, Loader2, CheckCircle2, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import { abortBidProject, archiveAll, getNonTenderDeal, registerNonTenderDeal, type NonTenderDealRecord } from '@/lib/api/bid';
import { createAnnouncement } from '@/lib/api/announcement';

type Props = {
  bidProjectId: string;
  projectName: string;
  projectCode: string;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
};

type Step = 'idle' | 'aborting' | 'archiving' | 'done' | 'error';

const NON_TENDER_METHOD_OPTIONS = ['竞争性谈判', '询价', '单一来源'] as const;

export function AbortDialog({ bidProjectId, projectName, projectCode, isOpen, onClose, onChanged }: Props) {
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');

  // C3（A-199）：流标后转非招标方式成交登记
  const [deal, setDeal] = useState<NonTenderDealRecord | null>(null);
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [dealMethod, setDealMethod] = useState<string>('竞争性谈判');
  const [dealWinner, setDealWinner] = useState('');
  const [dealAmount, setDealAmount] = useState('');
  const [dealNote, setDealNote] = useState('');
  const [dealBusy, setDealBusy] = useState(false);
  const [dealError, setDealError] = useState('');

  useEffect(() => {
    if (step === 'done') {
      getNonTenderDeal(bidProjectId).then(setDeal).catch(() => setDeal(null));
    }
  }, [step, bidProjectId]);

  const handleRegisterDeal = async () => {
    setDealBusy(true);
    setDealError('');
    try {
      const r = await registerNonTenderDeal(bidProjectId, {
        method: dealMethod,
        winnerName: dealWinner.trim(),
        dealAmount: dealAmount ? Number(dealAmount) : undefined,
        note: dealNote.trim() || undefined,
      });
      setDeal(r);
      setDealFormOpen(false);
    } catch (e: unknown) {
      setDealError(e instanceof Error ? e.message : '登记失败');
    } finally {
      setDealBusy(false);
    }
  };

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setError('');
    try {
      // Step 1: 流标（ABORTED + riskNote）
      setStep('aborting');
      await abortBidProject(bidProjectId, reason.trim() || undefined);

      // Step 2: 创建流标公告（failed_bid）
      try {
        await createAnnouncement({
          title: `流标公告：${projectName}`,
          content: `项目编号 ${projectCode}（${projectName}）因${reason.trim() || '有效投标不足法定家数'}流标。`,
          type: 'PLATFORM',
          status: 'PUBLISHED',
          relatedProjectCode: projectCode,
        });
      } catch { /* 公告创建失败不阻塞流标+归档 */ }

      // Step 3: 开标归档（scope=opening,终局封存）
      setStep('archiving');
      await archiveAll(bidProjectId, 'opening');

      setStep('done');
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败');
      setStep('error');
    }
  };

  const handleClose = () => {
    setReason('');
    setStep('idle');
    setError('');
    setDeal(null);
    setDealFormOpen(false);
    setDealWinner('');
    setDealAmount('');
    setDealNote('');
    setDealError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="neu-card-static w-full max-w-lg space-y-4 rounded-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--danger)_12%,transparent)]">
            <Ban size={18} className="text-[var(--danger)]" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--foreground)]">确认流标</h3>
            <p className="text-sm text-[var(--muted-foreground)]">{projectName}</p>
          </div>
        </div>

        {step === 'done' ? (
          <div className="space-y-4">
            <div className="exp-alert exp-alert--success flex items-center gap-2">
              <CheckCircle2 size={16} strokeWidth={2} />
              <span className="text-sm font-semibold">流标完成——已发公告并归档</span>
            </div>

            {/* C3（A-199）：转非招标方式成交登记 */}
            {deal ? (
              <div className="space-y-1 rounded-xl bg-[var(--surface)] p-3 text-xs text-[var(--muted-foreground)]">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
                  <ArrowRightLeft size={13} /> 已转非招标方式成交
                </div>
                <p>{deal.method} · 成交供应商：{deal.winnerName}{deal.dealAmount ? ` · 成交金额：￥${Number(deal.dealAmount).toLocaleString('zh-CN')}` : ''}</p>
                <p>登记时间：{new Date(deal.recordedAt).toLocaleString('zh-CN', { hour12: false })}（已入归档链）</p>
              </div>
            ) : dealFormOpen ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
                  <ArrowRightLeft size={14} /> 转非招标方式成交登记
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={dealMethod} onChange={e => setDealMethod(e.target.value)}
                    className="workbench-input text-sm">
                    {NON_TENDER_METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input value={dealWinner} onChange={e => setDealWinner(e.target.value)} placeholder="成交供应商名称"
                    className="workbench-input text-sm" />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input value={dealAmount} onChange={e => setDealAmount(e.target.value)} placeholder="成交金额（元，可空）"
                    inputMode="decimal" className="workbench-input text-sm" />
                  <span className="self-center text-xs text-[var(--muted-foreground)]">元</span>
                </div>
                <input value={dealNote} onChange={e => setDealNote(e.target.value)} placeholder="备注（可空）"
                  className="workbench-input text-sm" />
                {dealError && <p className="text-xs text-[var(--danger)]">{dealError}</p>}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setDealFormOpen(false)} className="neu-btn-soft flex-1" disabled={dealBusy}>取消</button>
                  <button type="button" onClick={handleRegisterDeal} className="neu-btn-primary flex-1" disabled={dealBusy || !dealWinner.trim()}>
                    {dealBusy ? <Loader2 size={14} className="animate-spin" /> : '登记成交'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setDealFormOpen(true)} className="neu-btn-soft w-full">
                <ArrowRightLeft size={14} /> 转非招标方式成交登记（竞争性谈判/询价/单一来源）
              </button>
            )}

            <button type="button" onClick={handleClose} className="neu-btn-primary w-full">关闭</button>
          </div>
        ) : step === 'error' ? (
          <div className="space-y-4">
            <div className="exp-alert exp-alert--danger flex items-center gap-2">
              <AlertTriangle size={16} strokeWidth={2} />
              <span className="text-sm">{error}</span>
            </div>
            <button type="button" onClick={() => setStep('idle')} className="neu-btn-soft w-full">重试</button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-[var(--foreground)]">流标原因</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="请填写流标原因（如：有效投标不足 3 家、出现重大违法违规情形等）"
                rows={3}
                className="w-full resize-none rounded-xl border border-[color-mix(in_oklch,var(--foreground)_12%,transparent)] bg-[var(--surface)] p-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="exp-alert exp-alert--info !p-3 text-xs text-[var(--muted-foreground)]">
              确认后将依次执行：① 项目置为流标 → ② 发布流标公告 → ③ 开标归档（终局封存，不可逆）
            </div>

            {(step === 'aborting' || step === 'archiving') && (
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Loader2 size={14} className="animate-spin" />
                {step === 'aborting' ? '正在执行流标+发布公告…' : '正在归档…'}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={handleClose} className="neu-btn-soft flex-1">取消</button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={step !== 'idle'}
                className="neu-btn-soft is-danger flex-1"
              >
                确认流标
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
