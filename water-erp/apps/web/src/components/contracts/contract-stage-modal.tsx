'use client';

/**
 * C2/C3/C4（GB/T 43711 7.5.4/7.6/7.5.4.4）：项目管理·合同阶段结构化管理。
 * 状态流：草拟 →（一致性校验）→ 内审 → 签署 → 履行台账 → 验收办结（自动履行结果公告）+ 保证金退还登记。
 * 替代原"合同阶段仅上传文件"的纯文本口径——合同编号/金额快照仍写 PMI 概览卡，此处管全流程。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ScrollText, Plus, Send, CheckCircle2, FileSignature, Megaphone, FileText, PackageCheck, Ban, Coins, Loader2 } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { StatusBadge } from '@/components/workbench';
import {
  listContractsByProject, createContract, runContractConsistency, submitContractReview, reviewContract,
  signContract, publishContractNotice, generateContractDraftDocx, addContractFulfillment,
  updateContractFulfillment, acceptContract, terminateContract, listBondReturns, markSupplierBondReturned,
  CONTRACT_STATUS_LABEL, FULFILLMENT_LABEL, type Contract, type BondReturnRow,
} from '@/lib/api/contract';

interface Props {
  open: boolean;
  onClose: () => void;
  item: { id: string; projectCode: string; awardedSupplier?: string | null; contractAmount?: number | string | null };
  onUpdated?: () => void;
}

const STATUS_TONE: Record<string, 'gray' | 'orange' | 'green' | 'blue' | 'red'> = {
  drafting: 'gray', internal_review: 'orange', signed: 'green', performing: 'blue', accepted: 'green', terminated: 'red',
};

export function ContractStageModal({ open, onClose, item, onUpdated }: Props) {
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ supplierName: '', amount: '', signDeadline: '' });

  const load = useCallback(() => {
    listContractsByProject({ projectManagementItemId: item.id })
      .then(setContracts)
      .catch(() => setContracts([]));
  }, [item.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); load(); onUpdated?.(); }
    catch (e: any) { toast.error(e?.message || '操作失败'); }
    finally { setBusy(false); }
  };

  const handleCreate = () => {
    if (!form.supplierName.trim()) { toast.error('请填写成交供应商'); return; }
    setBusy(true);
    createContract({
      projectCode: item.projectCode,
      projectManagementItemId: item.id,
      supplierName: form.supplierName.trim(),
      amount: form.amount ? Number(form.amount) : undefined,
      signDeadline: form.signDeadline || undefined,
    })
      .then(() => { toast.success('合同已创建（草拟）'); setCreating(false); setForm({ supplierName: '', amount: '', signDeadline: '' }); load(); })
      .catch((e: any) => toast.error(e?.message || '创建失败'))
      .finally(() => setBusy(false));
  };

  return (
    <Modal open={open} onClose={onClose} title="合同订立与履行" description="GB/T 43711 7.5.4/7.6 —— 订立（一致性校验→内审→签署→合同公告）· 履行台账 · 验收办结" size="xl">
      {/* ── 新建入口 ── */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--muted-foreground)]">项目编号 {item.projectCode}</span>
        {!creating ? (
          <button onClick={() => setCreating(true)} disabled={busy} className="neu-btn-primary !h-[30px] !px-3 !text-xs"><Plus size={13} /> 新建合同</button>
        ) : (
          <button onClick={() => setCreating(false)} className="neu-btn-soft !h-[30px] !px-3 !text-xs">取消</button>
        )}
      </div>

      {creating && (
        <div className="mb-4 rounded-[12px] bg-[var(--surface)] p-4 space-y-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">成交供应商</span>
              <input value={form.supplierName} onChange={e => setForm({ ...form, supplierName: e.target.value })}
                defaultValue={item.awardedSupplier ?? undefined} key={item.awardedSupplier}
                placeholder="默认取定标结果" className="neu-input !h-[32px] !text-xs" />
            </label>
            <label className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">合同金额（元）</span>
              <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="neu-input !h-[32px] !text-xs" />
            </label>
            <label className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">签约时限</span>
              <input type="date" value={form.signDeadline} onChange={e => setForm({ ...form, signDeadline: e.target.value })} className="neu-input !h-[32px] !text-xs" />
            </label>
          </div>
          <div className="flex justify-end">
            <button onClick={handleCreate} disabled={busy} className="neu-btn-primary !h-[30px] !px-3 !text-xs">{busy ? <Loader2 size={13} className="animate-spin" /> : null} 创建草拟合同</button>
          </div>
        </div>
      )}

      {contracts === null ? (
        <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">加载中…</div>
      ) : contracts.length === 0 ? (
        <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">暂无合同——点击右上角「新建合同」从定标结果发起订立</div>
      ) : (
        <div className="space-y-4 max-h-[62vh] overflow-y-auto pr-1">
          {contracts.map(c => (
            <div key={c.id} className="rounded-[14px] bg-[var(--surface)] p-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge tone={STATUS_TONE[c.status] ?? 'gray'}>{CONTRACT_STATUS_LABEL[c.status] ?? c.status}</StatusBadge>
                <span className="font-mono text-[0.72rem] font-bold text-[var(--accent-strong)]">{c.contractCode}</span>
                <span className="text-[0.72rem] font-bold">{c.supplierName}</span>
                {c.amount != null && <span className="text-[0.72rem] font-black tabular-nums text-[var(--success)]">¥{Number(c.amount).toLocaleString('zh-CN')}</span>}
                {c.signedAt && <span className="text-[0.62rem] text-[var(--muted-foreground)]">签署于 {new Date(c.signedAt).toLocaleDateString('zh-CN')}</span>}
              </div>

              {/* 一致性校验结果 */}
              {c.consistencyResult && (
                <div className={`mt-2 rounded-[8px] px-3 py-2 text-[0.7rem] ${c.consistencyResult.consistent ? 'bg-[var(--accent-soft)]/20' : 'bg-red-50/70'}`}>
                  {c.consistencyResult.manualConfirm
                    ? '一致性：线下成交，无线上成交记录可比对——人工确认留痕'
                    : c.consistencyResult.consistent
                      ? `一致性：通过（比对源 ${c.consistencyResult.source === 'evaluation' ? '评审结果' : c.consistencyResult.source === 'award_letter' ? '成交通知书' : '成交公告'}）`
                      : `一致性：不一致——${c.consistencyResult.issues.map(i => `${i.field === 'supplier' ? '供应商' : '金额'}应为 ${i.expected}，实为 ${i.actual}`).join('；')}`}
                </div>
              )}
              {c.reviewNote && <div className="mt-2 rounded-[8px] bg-[var(--warning)]/10 px-3 py-2 text-[0.7rem]">内审意见：{c.reviewNote}</div>}

              {/* 状态动作条 */}
              <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                {c.status === 'drafting' && (
                  <>
                    <button onClick={() => act(() => runContractConsistency(c.id), '一致性校验完成')} disabled={busy} className="neu-btn-soft !h-[26px] !px-2.5 !text-[11px]"><Send size={11} /> 一致性校验</button>
                    <button onClick={() => act(() => generateContractDraftDocx(c.id), '合同草稿 DOCX 已生成')} disabled={busy} className="neu-btn-soft !h-[26px] !px-2.5 !text-[11px]"><FileText size={11} /> 生成草稿</button>
                    <button onClick={() => act(() => submitContractReview(c.id), '已提交内审')} disabled={busy} className="neu-btn-soft !h-[26px] !px-2.5 !text-[11px]"><Send size={11} /> 提交内审</button>
                  </>
                )}
                {c.status === 'internal_review' && (
                  <>
                    <button onClick={() => act(() => reviewContract(c.id, { approved: true }), '内审通过，可登记签署')} disabled={busy} className="neu-btn-primary !h-[26px] !px-2.5 !text-[11px]"><CheckCircle2 size={11} /> 内审通过</button>
                    <button onClick={() => { const note = prompt('驳回意见（必填）：'); if (!note) return; act(() => reviewContract(c.id, { approved: false, note }), '已驳回回草拟'); }} disabled={busy} className="neu-btn-soft !h-[26px] !px-2.5 !text-[11px]">驳回</button>
                  </>
                )}
                {(c.status === 'internal_review' || c.status === 'signed') && (
                  <button onClick={() => act(() => signContract(c.id, {}), '已登记签署')} disabled={busy} className="neu-btn-soft !h-[26px] !px-2.5 !text-[11px]"><FileSignature size={11} /> 登记签署</button>
                )}
                {['signed', 'performing', 'accepted'].includes(c.status) && (
                  <button onClick={() => act(() => publishContractNotice(c.id), '合同公告已发布（幂等）')} disabled={busy} className="neu-btn-soft !h-[26px] !px-2.5 !text-[11px]"><Megaphone size={11} /> 合同公告</button>
                )}
                {['signed', 'performing'].includes(c.status) && (
                  <button onClick={() => { const note = prompt('验收情况说明：') ?? ''; if (note === '') return; act(() => acceptContract(c.id, { note }), '验收办结，履行结果公告已发布'); }} disabled={busy} className="neu-btn-primary !h-[26px] !px-2.5 !text-[11px]"><PackageCheck size={11} /> 验收办结</button>
                )}
                {!['terminated', 'accepted'].includes(c.status) && (
                  <button onClick={() => { const reason = prompt('终止理由（必填）：'); if (!reason) return; act(() => terminateContract(c.id, reason), '合同已终止'); }} disabled={busy} className="neu-btn-soft is-danger !h-[26px] !px-2.5 !text-[11px]"><Ban size={11} /> 终止</button>
                )}
                {/* C4（A-105）：保证金逐家退还——中标人/未中标人分别登记（实施条例第57条） */}
                {c.projectId && ['signed', 'performing', 'accepted'].includes(c.status) && (
                  <BondReturnBlock projectId={c.projectId} busy={busy} act={act} />
                )}
              </div>

              {/* C3 履行台账 */}
              {['signed', 'performing', 'accepted', 'terminated'].includes(c.status) && (
                <div className="mt-3 border-t" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.14)' }}>
                  <div className="flex items-center justify-between mt-2 mb-1.5">
                    <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">履行台账（交付/付款/验收）</span>
                    {['signed', 'performing'].includes(c.status) && (
                      <button onClick={() => {
                        const type = prompt('节点类型：delivery 交付 / payment 付款 / acceptance 验收', 'delivery');
                        if (!type || !['delivery', 'payment', 'acceptance'].includes(type)) return;
                        const title = prompt('节点名称（如 首批设备到货）：');
                        if (!title) return;
                        act(() => addContractFulfillment(c.id, { type, title }), '履行节点已登记');
                      }} disabled={busy} className="neu-btn-xs !text-[10px]"><Plus size={10} /> 登记节点</button>
                    )}
                  </div>
                  {c.fulfillments.length === 0 ? (
                    <p className="text-[0.68rem] text-[var(--muted-foreground)]">暂无履行节点</p>
                  ) : (
                    <div className="space-y-1.5">
                      {c.fulfillments.map(f => (
                        <div key={f.id} className="flex items-center gap-2 text-[0.7rem]">
                          <StatusBadge tone={f.status === 'done' ? 'green' : f.status === 'exception' ? 'red' : 'gray'}>
                            {f.status === 'done' ? '完成' : f.status === 'exception' ? '异常' : '待办'}
                          </StatusBadge>
                          <span className="font-semibold text-[var(--accent)]">{FULFILLMENT_LABEL[f.type] ?? f.type}</span>
                          <span className="truncate max-w-[180px]">{f.title}</span>
                          {f.amount != null && <span className="tabular-nums text-[var(--success)]">¥{Number(f.amount).toLocaleString('zh-CN')}</span>}
                          {f.doneDate && <span className="text-[var(--muted-foreground)]">{new Date(f.doneDate).toLocaleDateString('zh-CN')}</span>}
                          {f.status === 'pending' && ['signed', 'performing'].includes(c.status) && (
                            <button onClick={() => act(() => updateContractFulfillment(c.id, f.id, { status: 'done' }), '节点已完成')} disabled={busy} className="neu-btn-xs !h-[20px] !px-1.5 !text-[10px] ml-auto">完成</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** C4（A-105）：保证金逐家退还区——花名册行 × 唱标状态 × 退还态，逐家登记（替代原项目级双按钮；实施条例第57条） */
function BondReturnBlock({ projectId, busy, act }: {
  projectId: string;
  busy: boolean;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [data, setData] = useState<{ bondRequired: boolean; rows: BondReturnRow[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    listBondReturns(projectId)
      .then(d => { setData(d); setFailed(false); })
      .catch(() => setFailed(true));
  }, [projectId]);

  useEffect(() => { setData(null); setFailed(false); load(); }, [load]);

  const run = (fn: () => Promise<unknown>, ok: string) => { act(fn, ok).then(load); };

  return (
    <div className="w-full mt-2 border-t pt-2" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.14)' }}>
      <div className="flex items-center gap-1 mb-1.5 text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
        <Coins size={12} /> 保证金退还（逐家·实施条例第57条）
      </div>
      {data === null ? (
        failed ? (
          <div className="flex items-center gap-2 text-[0.7rem] text-red-600">
            保证金清单加载失败
            <button onClick={load} className="neu-btn-xs !text-[10px]">重试</button>
          </div>
        ) : (
          <p className="text-[0.68rem] text-[var(--muted-foreground)]">加载中…</p>
        )
      ) : !data.bondRequired ? (
        <p className="text-[0.68rem] text-[var(--muted-foreground)]">该项目未要求响应担保</p>
      ) : data.rows.length === 0 ? (
        <p className="text-[0.68rem] text-[var(--muted-foreground)]">无投标人花名册</p>
      ) : (
        <div className="space-y-1.5">
          {data.rows.map(r => (
            <div key={r.supplierName} className="flex items-center gap-2 flex-wrap text-[0.7rem]">
              <span className="font-semibold truncate max-w-[200px]">{r.supplierName}</span>
              {r.isWinner && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[0.6rem] font-bold text-amber-700">中标</span>}
              <span className="text-[var(--muted-foreground)]">唱标：{r.bondStatus ?? '—'}</span>
              {r.bondReturnReason ? (
                <span className="text-red-600">不予退还：{r.bondReturnReason}</span>
              ) : r.bondReturnedAt ? (
                <span className="text-[var(--success)]">已退还 {new Date(r.bondReturnedAt).toLocaleDateString('zh-CN')}</span>
              ) : (
                <span className="text-[var(--muted-foreground)]">未登记</span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                {!r.bondReturnedAt && (
                  <button onClick={() => run(() => markSupplierBondReturned(projectId, { supplierName: r.supplierName, returned: true }), `已登记退还：${r.supplierName}`)} disabled={busy} className="neu-btn-soft !h-[26px] !px-2.5 !text-[11px]"><Coins size={11} /> 退还</button>
                )}
                {!r.bondReturnReason && (
                  <button onClick={() => { const reason = prompt('不予退还理由（7.5.3.3 情形，必填）：'); if (!reason?.trim()) return; run(() => markSupplierBondReturned(projectId, { supplierName: r.supplierName, returned: false, reason: reason.trim() }), `已登记不予退还：${r.supplierName}`); }} disabled={busy} className="neu-btn-soft is-danger !h-[26px] !px-2.5 !text-[11px]">不退</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
