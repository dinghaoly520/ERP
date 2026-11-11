'use client';

/**
 * 变更 / 补遗三步弹窗（2026-11-11 spec §3）：
 *  ① 选类型（变更=改已发布信息并登记轮次；补遗=追加说明留痕，公告走既有补遗链路）
 *  ② 分组表单——阶段闸门（未到达组禁用）+ 必填变更理由
 *  ③ 保存=登记轮次；涉及开标时间 → needsAnnouncement（Task 7 接变更公告发布）
 * 服务端为权威闸（白名单/阶段/开标锁/理由），前端禁用仅作引导。
 */
import { useMemo, useState } from 'react';
import { RefreshCcw, FilePlus2, X } from 'lucide-react';
import { toast } from 'sonner';
import { registerChange } from '@/lib/api/project-changes';
import { CHANGE_FIELD_GROUPS, stageReached } from '@/lib/change-fields';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Step = 'type' | 'form';

const inputCls =
  'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';

/** PMI 中文开标时间（YYYY年M月D日 HH:mm，+08 墙钟）→ datetime-local 输入值 */
function cnToDatetimeLocal(cn: string | null | undefined): string {
  const m = (cn ?? '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const p = (x: string) => x.padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}`;
}

/** datetime-local 输入值 → ISO（按 +08 墙钟构造，与后端 parseFlexibleDate/中文格式化同口径） */
function localInputToIso(v: string): string {
  return new Date(`${v}:00+08:00`).toISOString();
}

export function ChangeModal({
  isOpen,
  onClose,
  item,
  currentStage,
  bidFields,
  onRegistered,
}: {
  isOpen: boolean;
  onClose: () => void;
  item: ProjectManagementItem;
  currentStage: string | null;
  /** 当前轮 BidProject 字段现值（BID 组预填；无投标侧数据传 null） */
  bidFields: { qualification?: string | null; scope?: string | null; qualityRequirement?: string | null } | null;
  onRegistered: (result: { needsAnnouncement: boolean; recordId: string; category: 'change_notice' | 'addendum'; round: number; reason: string; changeContent: string }) => void;
}) {
  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<'CHANGE' | 'ADDENDUM'>('CHANGE');
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const pm = item as unknown as Record<string, string | number | null>;
  const currentOf = (f: string): string => {
    if (f === 'bidOpeningTime') return cnToDatetimeLocal(pm.bidOpeningTime as string);
    const v = f === 'qualification' || f === 'scope' || f === 'qualityRequirement'
      ? (bidFields as Record<string, string | null | undefined> | null)?.[f]
      : pm[f];
    return v == null ? '' : String(v);
  };

  const groups = useMemo(
    () => CHANGE_FIELD_GROUPS.map(g => ({ ...g, unlocked: stageReached(currentStage, g.stageKey) })),
    [currentStage],
  );
  const changedCount = groups.reduce(
    (n, g) => n + g.fields.filter(f => (values[f.field] ?? '') !== '' && values[f.field] !== currentOf(f.field)).length,
    0,
  );

  if (!isOpen) return null;

  const submit = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) { toast.error('请填写变更理由'); return; }
    if (type === 'CHANGE' && changedCount === 0) { toast.error('请至少修改一个字段'); return; }
    setSaving(true);
    try {
      const fields: Record<string, string> = {};
      if (type === 'CHANGE') {
        for (const g of groups) {
          if (!g.unlocked) continue;
          for (const f of g.fields) {
            const v = values[f.field] ?? '';
            if (v === '' || v === currentOf(f.field)) continue;
            fields[f.field] = f.field === 'bidOpeningTime' ? localInputToIso(v) : v;
          }
        }
      }
      const r = await registerChange(item.id, { type, reason: trimmedReason, fields });
      toast.success(`已登记第 ${r.record.round} 轮${type === 'CHANGE' ? '变更' : '补遗'}`);
      const cs = (r.record.changeset ?? []) as Array<{ label: string; from: string; to: string }>;
      const changeContent = cs.length > 0
        ? cs.map(c => `${c.label}：${c.from || '（空）'} → ${c.to || '（空）'}`).join('\n')
        : trimmedReason; // 补遗无字段 diff：正文即事由
      onRegistered({
        needsAnnouncement: r.needsAnnouncement,
        recordId: r.record.id,
        category: type === 'CHANGE' ? 'change_notice' : 'addendum',
        round: r.record.round,
        reason: trimmedReason,
        changeContent,
      });
      onClose();
    } catch (e) {
      toast.error((e as Error).message || '登记失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[540] flex items-center justify-center">
      <div className="absolute inset-0" style={{ background: 'oklch(0.1 0.02 258 / 0.42)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div
        className="relative z-10 flex max-h-[84vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[20px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.75))',
          boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 4px 5px 18px oklch(0.45 0.07 258 / 0.2)',
        }}
      >
        <div className="flex shrink-0 items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="flex items-center gap-2 text-[0.92rem] font-semibold text-[var(--foreground)]">
            {type === 'CHANGE' ? <RefreshCcw size={16} className="text-[var(--accent)]" /> : <FilePlus2 size={16} className="text-[var(--accent)]" />}
            {step === 'type' ? '变更 / 补遗 · 选择类型' : type === 'CHANGE' ? '变更 · 修改信息' : '补遗 · 登记说明'}
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs"><X size={15} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {step === 'type' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setType('CHANGE'); setStep('form'); }}
                className="rounded-[14px] border border-[var(--border)] bg-[oklch(1_0_0/0.6)] p-4 text-left transition-colors hover:border-[var(--accent)]"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"><RefreshCcw size={15} className="text-[var(--warning)]" />变更</div>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
                  修改已发布的项目信息（按阶段解锁），登记轮次与理由；涉及开标时间须发布变更公告。
                </p>
              </button>
              <button
                type="button"
                onClick={() => { setType('ADDENDUM'); setStep('form'); }}
                className="rounded-[14px] border border-[var(--border)] bg-[oklch(1_0_0/0.6)] p-4 text-left transition-colors hover:border-[var(--accent)]"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"><FilePlus2 size={15} className="text-[var(--accent)]" />补遗</div>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
                  不修改原信息，追加补充说明并登记轮次；对外补遗公告沿用既有发布链路。
                </p>
              </button>
            </div>
          )}

          {step === 'form' && (
            <>
              {type === 'CHANGE' && groups.map(g => (
                <div key={g.key} className={`rounded-[14px] border p-4 ${g.unlocked ? 'border-[var(--border)]' : 'border-[var(--border)]/60 opacity-60'}`}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[13px] font-bold text-[var(--foreground)]">{g.label}</span>
                    {!g.unlocked && (
                      <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">
                        未进入 {g.stageLabel} 阶段，不可变更
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {g.fields.map(f => (
                      <label key={f.field} className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                          {f.label}{g.unlocked && (values[f.field] ?? '') !== '' && (values[f.field] ?? '') !== currentOf(f.field) && <span className="ml-1 text-[var(--warning)]">已修改</span>}
                        </span>
                        {f.kind === 'datetime' ? (
                          <input
                            type="datetime-local"
                            className={inputCls}
                            disabled={!g.unlocked}
                            value={values[f.field] ?? currentOf(f.field)}
                            onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))}
                          />
                        ) : (
                          <input
                            type={f.kind === 'number' ? 'number' : 'text'}
                            className={inputCls}
                            disabled={!g.unlocked}
                            placeholder={currentOf(f.field) || '（空）'}
                            value={values[f.field] ?? ''}
                            onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {type === 'ADDENDUM' && (
                <p className="rounded-[12px] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-4 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
                  补遗登记仅留痕（轮次+理由）；如需对外发布补遗公告，请在「④ 公告公示」阶段的公告制作与发布流程卡中操作。
                </p>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                  变更理由<span className="ml-1 font-normal normal-case text-[var(--warning)]">必填，随轮次留痕</span>
                </span>
                <textarea
                  className={`${inputCls} min-h-[72px]`}
                  maxLength={200}
                  placeholder="如：需求方要求调整供货范围"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        {step === 'form' && (
          <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
            <span className="text-xs text-[var(--muted-foreground)]">
              {type === 'CHANGE' ? `已修改 ${changedCount} 个字段` : '补遗登记'}
            </span>
            <div className="flex gap-3">
              <button type="button" className="neu-btn-soft" onClick={() => setStep('type')}>上一步</button>
              <button type="button" className="neu-btn-primary !h-[36px]" disabled={saving} onClick={() => void submit()}>
                {saving ? '登记中…' : '登记并留痕'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
