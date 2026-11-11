'use client';

/**
 * 变更 / 补遗三步弹窗（2026-11-11 spec §3；UI 对齐 cgzxui 弹窗规范）：
 *  ① 选类型（变更=改已发布信息并登记轮次；补遗=追加说明留档）
 *  ② 分组表单——阶段闸门（未到达组禁用）+ 必填变更理由
 *  ③ 保存=登记轮次；涉及开标时间 → needsAnnouncement（接变更公告发布）
 * 字段控件分型（cgzxui）：采购类别=原生 select（7 项）；归属项目=SearchSelect（项目清单实体名单）。
 * 服务端为权威闸（白名单/阶段/开标锁/理由），前端禁用仅作引导。
 */
import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, FilePlus2, X, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { registerChange } from '@/lib/api/project-changes';
import { CHANGE_FIELD_GROUPS, stageReached } from '@/lib/change-fields';
import { SearchSelect, type SearchSelectOption } from '@/components/workbench/search-select';
import { fetchProjectManagementList, extractTenderFields, optimizeInitiationFields } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Step = 'type' | 'form';

/** PMI 中文开标时间（YYYY年M月D日 HH:mm，+08 墙钟）→ datetime-local 输入值 */
function cnToDatetimeLocal(cn: string | null | undefined): string {
  const m = (cn ?? '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const p = (x: string) => x.padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}`;
}

/** datetime-local 输入值 → ISO（按 +08 墙钟构造，与后端解析同口径） */
function localInputToIso(v: string): string {
  return new Date(`${v}:00+08:00`).toISOString();
}

export function ChangeModal({
  isOpen,
  onClose,
  item,
  currentValues,
  currentStage,
  onRegistered,
}: {
  isOpen: boolean;
  onClose: () => void;
  item: ProjectManagementItem;
  /** 现值源（与左栏同源）：item + extractedInfoOverride 非空键合并 */
  currentValues?: Record<string, string | number | null> | null;
  currentStage: string | null;
  onRegistered: (result: { needsAnnouncement: boolean; recordId: string; category: 'change_notice' | 'addendum'; round: number; reason: string; changeContent: string }) => void;
}) {
  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<'CHANGE' | 'ADDENDUM'>('CHANGE');
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [projectOptions, setProjectOptions] = useState<SearchSelectOption[]>([]);
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  // 归属项目候选：在办项目清单（排除本项目）；打开弹窗时取一次
  useEffect(() => {
    if (!isOpen) return;
    fetchProjectManagementList('ACTIVE')
      .then(list => setProjectOptions(
        list
          .filter(p => p.id !== item.id)
          .map(p => ({ value: p.projectCode || p.id, label: p.title, meta: p.projectCode || undefined })),
      ))
      .catch(() => setProjectOptions([]));
  }, [isOpen, item.id]);

  const pm = { ...(item as unknown as Record<string, string | number | null>), ...(currentValues ?? {}) };
  const currentOf = (f: string): string => {
    if (f === 'bidOpeningTime') return cnToDatetimeLocal(pm.bidOpeningTime as string);
    const v = pm[f];
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

  /** AI 预填（不落库）：提取值进表单由用户核对，登记时统一留痕 */
  const runAiAssist = async (field: string, source: 'tender-overview' | 'initiation') => {
    setAiBusy(field);
    try {
      if (source === 'tender-overview') {
        const r = await extractTenderFields(item.id, field, 150_000, true);
        const v = r?.[field];
        if (v) { setValues(prev => ({ ...prev, [field]: v })); toast.success('已提取，请核对后登记'); }
        else toast.warning('AI 未能从采购文件中提取到该字段内容');
      } else {
        const r = await optimizeInitiationFields(item.id);
        const v = (r as Record<string, string>)?.[field]?.trim();
        if (v) { setValues(prev => ({ ...prev, [field]: v })); toast.success('已提取，请核对后登记'); }
        else toast.warning('AI 未能从采购需求/立项文件中提炼出相关内容');
      }
    } catch (e) {
      toast.error((e as Error).message || 'AI 提取失败');
    } finally {
      setAiBusy(null);
    }
  };

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
        : trimmedReason;
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
      <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative flex max-h-[86vh] w-full max-w-[min(680px,92vw)] flex-col overflow-hidden wb-modal-shell"
        role="dialog"
      >
        {/* 标题 */}
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-5">
          <div className="flex items-center gap-2 text-base font-semibold text-[var(--foreground)]">
            {type === 'CHANGE' ? <RefreshCcw size={16} className="text-[var(--accent)]" /> : <FilePlus2 size={16} className="text-[var(--accent)]" />}
            {step === 'type' ? '变更 / 补遗' : type === 'CHANGE' ? '变更 · 修改信息' : '补遗 · 说明'}
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs"><X size={15} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {step === 'type' && (
            <div className="space-y-3">
              <button type="button" onClick={() => { setType('CHANGE'); setStep('form'); }} className="neu-card block w-full p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"><RefreshCcw size={15} className="text-[var(--warning)]" />变更</div>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
                  修改已发布的项目信息，写明变更理由留档；改了开标时间的还要发变更公告。
                </p>
              </button>
              <button type="button" onClick={() => { setType('ADDENDUM'); setStep('form'); }} className="neu-card block w-full p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"><FilePlus2 size={15} className="text-[var(--accent)]" />补遗</div>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
                  不动原公告，另发一份补充说明；需要对外发布的登记后直接发布。
                </p>
              </button>
            </div>
          )}

          {step === 'form' && (
            <div className="space-y-4">
              {type === 'CHANGE' && groups.map((g, gi) => (
                <div key={g.key} className="space-y-3">
                  {gi > 0 && <hr className="wb-section-rule" />}
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-[var(--foreground)]">{g.label}</span>
                    {!g.unlocked && (
                      <span className="text-[11px] font-medium text-[var(--muted-foreground)]">未进入 {g.stageLabel} 阶段，不可变更</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {g.fields.map(f => (
                      // 勿把按钮放进 label：label 点击会转发给内部第一个可交互元素，
                      // AI 按钮会被字段区远处点击误触（2026-11-12 实录）——按钮只随自身命中
                      <div key={f.field} className={`flex flex-col gap-1${f.fullRow ? ' col-span-2' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                            {f.label}
                            {g.unlocked && (values[f.field] ?? '') !== '' && (values[f.field] ?? '') !== currentOf(f.field) && <span className="ml-1 normal-case text-[var(--warning)]">已修改</span>}
                          </span>
                          {f.aiAssist && g.unlocked && (
                            <button
                              type="button"
                              className="neu-btn-xs !h-[22px] !px-2 text-[10px]"
                              disabled={aiBusy != null}
                              onClick={() => void runAiAssist(f.field, f.aiAssist!)}
                            >
                              {aiBusy === f.field ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                              AI 提取并优化
                            </button>
                          )}
                        </div>
                        {f.multiline ? (
                          <textarea
                            className="neu-input min-h-[110px] text-sm"
                            disabled={!g.unlocked}
                            placeholder={currentOf(f.field) || '（空）'}
                            value={values[f.field] ?? ''}
                            onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))}
                          />
                        ) : f.widget === 'search-select' ? (
                          <SearchSelect
                            options={projectOptions}
                            value={values[f.field] ?? currentOf(f.field)}
                            onPick={opt => setValues(v => ({ ...v, [f.field]: opt.value }))}
                            placeholder="选择归属项目（可搜索）"
                            allowCustom
                            disabled={!g.unlocked}
                          />
                        ) : f.options ? (
                          <select
                            className="workbench-input"
                            disabled={!g.unlocked}
                            value={values[f.field] ?? currentOf(f.field)}
                            onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))}
                          >
                            {(f.options.includes(currentOf(f.field)) ? f.options : [currentOf(f.field), ...f.options])
                              .filter(Boolean)
                              .map(opt => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : f.kind === 'datetime' ? (
                          <input
                            type="datetime-local"
                            className="workbench-input"
                            disabled={!g.unlocked}
                            value={values[f.field] ?? currentOf(f.field)}
                            onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))}
                          />
                        ) : (
                          <input
                            type={f.kind === 'number' ? 'number' : 'text'}
                            className="workbench-input"
                            disabled={!g.unlocked}
                            placeholder={currentOf(f.field) || '（空）'}
                            value={values[f.field] ?? ''}
                            onChange={e => setValues(v => ({ ...v, [f.field]: e.target.value }))}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {type === 'ADDENDUM' && (
                <p className="rounded-[12px] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-4 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
                  补遗先登记留档；登记后可直接发布对外的补遗公告。
                </p>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                  变更理由<span className="ml-1 font-normal normal-case text-[var(--warning)]">必填，随轮次留档</span>
                </span>
                <textarea
                  className="neu-input text-sm"
                  maxLength={200}
                  placeholder="如：需求方要求调整供货范围"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>

        {step === 'form' && (
          <>
            <hr className="wb-section-rule" />
            <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5">
              <span className="text-xs text-[var(--muted-foreground)]">
                {type === 'CHANGE' ? `已修改 ${changedCount} 个字段` : '补遗登记'}
              </span>
              <div className="neu-btn-group">
                <button type="button" className="neu-btn-soft" onClick={() => setStep('type')}>上一步</button>
                <button type="button" className="neu-btn-primary !h-[38px]" disabled={saving} onClick={() => void submit()}>
                  {saving ? '登记中…' : '登记并留档'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
