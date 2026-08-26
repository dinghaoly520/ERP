'use client';

/**
 * C6（GB/T 43711 4.1.4）：采购人异议/投诉处理板。
 * :3005 信息发布中心面板内入口——在线受理答复供应商异议；答复后转投诉的登记监管处理结果。
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageSquareWarning, Send, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { StatusBadge } from '@/components/workbench';
import { listObjections, answerObjection, escalateObjection, closeObjection, type SupplierObjectionItem } from '@/lib/api/objection';
import { toast } from 'sonner';

const PHASE_LABEL: Record<string, string> = { document: '采购文件', prequalification: '资格预审', result: '采购结果' };
const STATUS_LABEL: Record<string, { label: string; tone: 'orange' | 'green' | 'red' | 'gray' }> = {
  open: { label: '待答复', tone: 'orange' },
  answered: { label: '已答复', tone: 'green' },
  complaint: { label: '已转投诉', tone: 'red' },
  closed: { label: '已办结', tone: 'gray' },
};

export function ObjectionBoardModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SupplierObjectionItem[] | null>(null);
  const [filter, setFilter] = useState('');
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listObjections(filter ? { status: filter } : undefined)
      .then(setItems)
      .catch(() => setItems([]));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleAnswer = async (o: SupplierObjectionItem) => {
    const answer = (answerDraft[o.id] ?? '').trim();
    if (!answer) { toast.error('请填写答复内容'); return; }
    setBusy(true);
    try {
      await answerObjection(o.id, answer);
      toast.success('已答复并通知供应商');
      setAnswerDraft(d => ({ ...d, [o.id]: '' }));
      load();
    } catch (e: any) { toast.error(e?.message || '答复失败'); } finally { setBusy(false); }
  };

  const handleEscalate = async (o: SupplierObjectionItem) => {
    const note = prompt('登记转投诉说明（移交监管部门处理的背景/依据）：') ?? '';
    if (note === '') return;
    setBusy(true);
    try {
      await escalateObjection(o.id, note);
      toast.success('已登记转投诉');
      load();
    } catch (e: any) { toast.error(e?.message || '操作失败'); } finally { setBusy(false); }
  };

  const handleClose = async (o: SupplierObjectionItem) => {
    const note = prompt('登记投诉处理结果（办结）：') ?? '';
    if (note === '') return;
    setBusy(true);
    try {
      await closeObjection(o.id, note);
      toast.success('已登记处理结果并办结');
      load();
    } catch (e: any) { toast.error(e?.message || '操作失败'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="异议 / 投诉处理" description="在线受理并答复供应商异议（GB/T 43711 4.1.4）；转投诉的登记监管处理结果" size="lg">
      <div className="flex items-center gap-2 mb-3">
        {[['', '全部'], ['open', '待答复'], ['answered', '已答复'], ['complaint', '已转投诉'], ['closed', '已办结']].map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)} className={`neu-tab ${filter === v ? 'is-active' : ''}`}>{label}</button>
        ))}
      </div>

      {items === null ? (
        <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">加载中…</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">暂无异议工单</div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {items.map(o => {
            const st = STATUS_LABEL[o.status] ?? { label: o.status, tone: 'gray' as const };
            return (
              <div key={o.id} className="rounded-[12px] bg-[var(--surface)] p-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  <StatusBadge tone="blue">{PHASE_LABEL[o.phase] ?? o.phase}</StatusBadge>
                  <span className="text-[0.7rem] font-bold text-[var(--foreground)]">{o.title}</span>
                  <span className="text-[0.65rem] text-[var(--muted-foreground)]">{o.supplierName} · {o.projectCode || '无编号'}</span>
                  <span className="ml-auto text-[0.62rem] text-[var(--muted-foreground)]">{new Date(o.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <p className="mt-2 text-[0.78rem] leading-relaxed whitespace-pre-wrap text-[var(--foreground)]">{o.content}</p>

                {o.answer && (
                  <div className="mt-2 rounded-[8px] bg-[var(--accent-soft)]/20 px-3 py-2">
                    <span className="text-[0.62rem] font-bold text-[var(--muted-foreground)]">答复（{o.answeredByName ?? '—'}）</span>
                    <p className="mt-1 text-[0.75rem] whitespace-pre-wrap">{o.answer}</p>
                  </div>
                )}
                {o.escalationNote && (
                  <div className="mt-2 rounded-[8px] bg-red-50/60 px-3 py-2">
                    <span className="text-[0.62rem] font-bold text-[var(--muted-foreground)]">投诉处理记录</span>
                    <p className="mt-1 text-[0.75rem] whitespace-pre-wrap">{o.escalationNote}</p>
                  </div>
                )}

                {o.status !== 'closed' && (
                  <div className="mt-3 flex items-start gap-2">
                    <textarea
                      value={answerDraft[o.id] ?? ''}
                      onChange={e => setAnswerDraft(d => ({ ...d, [o.id]: e.target.value }))}
                      placeholder={o.status === 'open' ? '填写在线答复内容…' : '补充答复…'}
                      className="neu-input flex-1 h-16 resize-y !text-xs"
                    />
                    <div className="flex flex-col gap-1.5">
                      <button onClick={() => handleAnswer(o)} disabled={busy} className="neu-btn-primary !h-[28px] !px-2.5 !text-[11px] disabled:opacity-50">
                        <Send size={12} /> 答复
                      </button>
                      {o.status === 'answered' && (
                        <button onClick={() => handleEscalate(o)} disabled={busy} className="neu-btn-soft !h-[28px] !px-2.5 !text-[11px]">
                          <ShieldAlert size={12} /> 转投诉
                        </button>
                      )}
                      {o.status === 'complaint' && (
                        <button onClick={() => handleClose(o)} disabled={busy} className="neu-btn-soft !h-[28px] !px-2.5 !text-[11px]">
                          <CheckCircle2 size={12} /> 登记结果办结
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
