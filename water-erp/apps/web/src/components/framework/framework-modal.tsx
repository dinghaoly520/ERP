'use client';

/**
 * B4（GB/T 43711 附录 D）：框架协议两阶段管理（登记制）。
 * :3005 项目管理详情头部「框架协议」入口——一阶段发起/入围登记/生效（D.2.6 校验+协议 DOCX），
 * 二阶段订单登记（复用合同域），增补/退出/价格调整/终止。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Layers, Plus, CheckCircle2, ShoppingCart, LogOut, TrendingUp, Ban, Loader2 } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { StatusBadge } from '@/components/workbench';
import {
  listFrameworkAgreements, createFrameworkAgreement, addFaEntries, activateFrameworkAgreement,
  secondStageOrder, exitFaEntry, adjustFaPriceRule, terminateFrameworkAgreement,
  FA_STATUS_LABEL, FA_VARIANT_LABEL, FA_ENTRY_MODE_LABEL, type FrameworkAgreement,
} from '@/lib/api/framework';

const STATUS_TONE: Record<string, 'gray' | 'orange' | 'green' | 'red'> = {
  drafting: 'gray', entry: 'orange', active: 'green', expired: 'gray', terminated: 'red',
};

export function FrameworkModal({ open, onClose, projectManagementItemId }: { open: boolean; onClose: () => void; projectManagementItemId?: string }) {
  const [items, setItems] = useState<FrameworkAgreement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', entryMode: 'closed', variant: 'supplier_price', validFrom: '', validUntil: '', priceFormula: '', secondStageRule: '' });

  const load = useCallback(() => {
    listFrameworkAgreements().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); load(); }
    catch (e: any) { toast.error(e?.message || '操作失败'); }
    finally { setBusy(false); }
  };

  const handleCreate = () => {
    if (!form.title.trim() || !form.validFrom || !form.validUntil) { toast.error('请填写名称与有效期起止'); return; }
    setBusy(true);
    createFrameworkAgreement({
      title: form.title.trim(),
      entryMode: form.entryMode,
      variant: form.variant,
      projectManagementItemId,
      validFrom: form.validFrom,
      validUntil: form.validUntil,
      priceRule: form.variant !== 'supplier_only' && form.priceFormula.trim() ? { formula: form.priceFormula.trim() } : undefined,
      secondStageRule: form.secondStageRule.trim() || undefined,
    })
      .then(() => { toast.success('框架协议已创建（入围登记中）'); setCreating(false); setForm({ title: '', entryMode: 'closed', variant: 'supplier_price', validFrom: '', validUntil: '', priceFormula: '', secondStageRule: '' }); load(); })
      .catch((e: any) => toast.error(e?.message || '创建失败'))
      .finally(() => setBusy(false));
  };

  return (
    <Modal open={open} onClose={onClose} title="框架协议采购（两阶段）" description="GB/T 43711 附录 D —— 一阶段入围（D.2.6 校验）→ 生效 → 二阶段订单（复用合同域）→ 变更/退出" size="xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--muted-foreground)]">登记制：竞争/资格审查过程线下或既有流程完成，结果在此登记</span>
        {!creating ? (
          <button onClick={() => setCreating(true)} disabled={busy} className="neu-btn-primary !h-[30px] !px-3 !text-xs"><Plus size={13} /> 发起框架协议</button>
        ) : (
          <button onClick={() => setCreating(false)} className="neu-btn-soft !h-[30px] !px-3 !text-xs">取消</button>
        )}
      </div>

      {creating && (
        <div className="mb-4 rounded-[12px] bg-[var(--surface)] p-4 space-y-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">协议名称</span>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="如：2026年度钢材框架协议" className="neu-input !h-[32px] !text-xs" />
            </label>
            <label className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">入围方式（D.2.1）</span>
              <select value={form.entryMode} onChange={e => setForm({ ...form, entryMode: e.target.value })} className="neu-input !h-[32px] !text-xs">
                <option value="closed">封闭式竞争入围（含价格）</option>
                <option value="open">开放式资格审查（无价格，期内可申请）</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">实施类型（表 D.1）</span>
              <select value={form.variant} onChange={e => setForm({ ...form, variant: e.target.value })} className="neu-input !h-[32px] !text-xs">
                <option value="supplier_only">定商</option>
                <option value="supplier_price">定商定价</option>
                <option value="supplier_price_qty">定商定价定量</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">有效期起</span>
              <input type="date" value={form.validFrom} onChange={e => setForm({ ...form, validFrom: e.target.value })} className="neu-input !h-[32px] !text-xs" />
            </label>
            <label className="space-y-1">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">有效期止</span>
              <input type="date" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} className="neu-input !h-[32px] !text-xs" />
            </label>
            {form.variant !== 'supplier_only' && (
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">计价规则/基准价格</span>
                <input value={form.priceFormula} onChange={e => setForm({ ...form, priceFormula: e.target.value })} placeholder="如：以 mysteel 网价下浮 5%" className="neu-input !h-[32px] !text-xs" />
              </label>
            )}
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">第二阶段成交规则（D.2.4，选填）</span>
              <input value={form.secondStageRule} onChange={e => setForm({ ...form, secondStageRule: e.target.value })} placeholder="如：按需求批次直接选定；或二次询比" className="neu-input !h-[32px] !text-xs" />
            </label>
          </div>
          <div className="flex justify-end">
            <button onClick={handleCreate} disabled={busy} className="neu-btn-primary !h-[30px] !px-3 !text-xs">{busy ? <Loader2 size={13} className="animate-spin" /> : null} 创建</button>
          </div>
        </div>
      )}

      {items === null ? (
        <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">加载中…</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">暂无框架协议——点击右上角「发起框架协议」</div>
      ) : (
        <div className="space-y-4 max-h-[62vh] overflow-y-auto pr-1">
          {items.map(fa => (
            <div key={fa.id} className="rounded-[14px] bg-[var(--surface)] p-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge tone={STATUS_TONE[fa.status] ?? 'gray'}>{FA_STATUS_LABEL[fa.status] ?? fa.status}</StatusBadge>
                <span className="font-mono text-[0.72rem] font-bold text-[var(--accent-strong)]">{fa.faCode}</span>
                <span className="text-[0.75rem] font-bold">{fa.title}</span>
                <span className="text-[0.62rem] text-[var(--muted-foreground)]">
                  {FA_ENTRY_MODE_LABEL[fa.entryMode]} · {FA_VARIANT_LABEL[fa.variant]} · 有效期至 {new Date(fa.validUntil).toLocaleDateString('zh-CN')}
                </span>
              </div>

              {fa.eliminationCheck && (
                <div className="mt-2 rounded-[8px] px-3 py-2 text-[0.7rem] bg-[var(--accent-soft)]/20">
                  D.2.6：{fa.eliminationCheck.detail}
                  {fa.eliminationCheck.overrideReason && <span className="text-[var(--danger)]">（放行理由：{fa.eliminationCheck.overrideReason}）</span>}
                </div>
              )}

              {/* 入围名单 */}
              <div className="mt-3 border-t" style={{ borderColor: 'oklch(0.6 0.04 258 / 0.14)' }}>
                <div className="flex items-center justify-between mt-2 mb-1.5">
                  <span className="text-[0.65rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">入围供应商（{fa.entries.filter(e => e.status !== 'exited').length}）</span>
                  {(fa.status === 'entry' || fa.status === 'active') && (
                    <div className="flex gap-1.5">
                      <button onClick={() => {
                        const names = prompt('登记入围供应商（逗号分隔，一阶段结果或增补 D.3.4.1）：');
                        if (!names?.trim()) return;
                        act(() => addFaEntries(fa.id, names.split(/[,，、]/).map(s => s.trim()).filter(Boolean).map(supplierName => ({ supplierName }))), '入围已登记');
                      }} disabled={busy} className="neu-btn-xs !text-[10px]"><Plus size={10} /> 登记入围</button>
                      {fa.status === 'entry' && (
                        <button onClick={() => {
                          const participants = prompt('一阶段价格竞争参与供应商数（D.2.6 校验用）：', String(fa.entries.length)) ?? '';
                          act(() => activateFrameworkAgreement(fa.id, { participants: Number(participants) || fa.entries.length }), '协议已生效，协议 DOCX 已生成');
                        }} disabled={busy} className="neu-btn-primary !h-[22px] !px-2 !text-[10px]"><CheckCircle2 size={10} /> 一阶段完成生效</button>
                      )}
                    </div>
                  )}
                </div>
                {fa.entries.length === 0 ? (
                  <p className="text-[0.68rem] text-[var(--muted-foreground)]">暂无入围登记</p>
                ) : (
                  <div className="space-y-1">
                    {fa.entries.map(e => (
                      <div key={e.id} className="flex items-center gap-2 text-[0.72rem]">
                        <StatusBadge tone={e.status === 'exited' ? 'red' : e.status === 'supplemented' ? 'orange' : 'green'}>
                          {e.status === 'exited' ? '已退出' : e.status === 'supplemented' ? '增补' : '在册'}
                        </StatusBadge>
                        <span className={e.status === 'exited' ? 'line-through text-[var(--muted-foreground)]' : 'font-semibold'}>{e.supplierName}</span>
                        {e.shareRatio != null && <span className="tabular-nums text-[var(--muted-foreground)]">占比 {Number(e.shareRatio)}%</span>}
                        {e.status !== 'exited' && fa.status === 'active' && (
                          <button onClick={() => {
                            const reason = fa.entryMode === 'closed' ? prompt('退出理由（封闭式必填，D.3.5）：') ?? '' : '';
                            if (fa.entryMode === 'closed' && !reason) return;
                            act(() => exitFaEntry(fa.id, e.id, reason || undefined), '已登记退出');
                          }} disabled={busy} className="neu-btn-xs !h-[20px] !px-1.5 !text-[10px] ml-1"><LogOut size={10} /> 退出</button>
                        )}
                        {e.status !== 'exited' && fa.status === 'active' && (
                          <button onClick={() => {
                            const amount = prompt('本批订单金额（元）：');
                            if (!amount) return;
                            act(() => secondStageOrder(fa.id, { entryId: e.id, amount: Number(amount) }), '二阶段订单合同已生成（合同域可查）');
                          }} disabled={busy} className="neu-btn-xs !h-[20px] !px-1.5 !text-[10px]"><ShoppingCart size={10} /> 下订单</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 变更动作 */}
              {fa.status === 'active' && (
                <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                  <button onClick={() => {
                    const note = prompt('价格调整依据（D.3.5，如市场波动）：');
                    if (!note) return;
                    const formula = prompt('调整后计价规则：');
                    if (!formula) return;
                    act(() => adjustFaPriceRule(fa.id, { formula }, note), '价格规则已调整（版本记录）');
                  }} disabled={busy} className="neu-btn-soft !h-[24px] !px-2 !text-[10px]"><TrendingUp size={10} /> 价格调整</button>
                  <button onClick={() => {
                    const reason = prompt('终止理由：');
                    if (!reason) return;
                    act(() => terminateFrameworkAgreement(fa.id, reason), '协议已终止');
                  }} disabled={busy} className="neu-btn-soft is-danger !h-[24px] !px-2 !text-[10px]"><Ban size={10} /> 终止</button>
                </div>
              )}

              {/* 变更记录 */}
              {(fa.changeLog?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="text-[0.62rem] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)] cursor-pointer">变更记录（{fa.changeLog!.length}）</summary>
                  <div className="mt-1 space-y-0.5">
                    {fa.changeLog!.map((c, i) => (
                      <p key={i} className="text-[0.66rem] text-[var(--muted-foreground)]">{new Date(c.at).toLocaleString('zh-CN')} · {c.action} · {c.note}</p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
