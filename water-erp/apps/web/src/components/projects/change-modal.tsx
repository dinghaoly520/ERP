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
import { registerChange, listChanges } from '@/lib/api/project-changes';
import { CHANGE_FIELD_GROUPS, stageReached } from '@/lib/change-fields';
import { SearchSelect, type SearchSelectOption } from '@/components/workbench/search-select';
import { fetchProjectManagementList, extractTenderFields, optimizeInitiationFields } from '@/lib/api/project-management';
import { fetchMyCompanyInfo } from '@/lib/api/company-info';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Step = 'type' | 'form';

/** datetime-local 当前时刻 */
function toLocalNow(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local 今日 +n 天 */
function daysAfter(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

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
  bidOpened,
  onRegistered,
}: {
  isOpen: boolean;
  onClose: () => void;
  item: ProjectManagementItem;
  /** 现值源（与左栏同源）：item + extractedInfoOverride 非空键合并 */
  currentValues?: Record<string, string | number | null> | null;
  currentStage: string | null;
  /** 开标确认（BidProject 进入 OPENING 起）——标段分区闸：开标后标前锁死、标后解锁 */
  bidOpened: boolean;
  onRegistered: (
    result: { needsAnnouncement: boolean; recordId: string; category: 'change_notice' | 'addendum'; round: number; reason: string; changeContent: string; publishStart?: string; publishEnd?: string; patchExtra?: Record<string, string> },
    publish: boolean,
    /** 发布优先模式（2026-11-12 裁定）：尚未登记——公告发布成功后由面板补登记 */
    pending?: { type: 'CHANGE' | 'ADDENDUM'; reason: string; fields: Record<string, string> },
  ) => void;
}) {
  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<'CHANGE' | 'ADDENDUM'>('CHANGE');
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [projectOptions, setProjectOptions] = useState<SearchSelectOption[]>([]);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  // 登记前选择（2026-11-12 用户裁定）：是否先发布公告——发布优先模式未登记数据，
  // 公告发布成功才由面板补登记；取消发布=放弃本次修改
  const [awaitChoice, setAwaitChoice] = useState<{ type: 'CHANGE' | 'ADDENDUM'; reason: string; fields: Record<string, string> } | null>(null);
  // 发布配置（2026-11-12 借鉴公告向导发布步）：正文/公示期限——随向导注入预填
  const [pubStart, setPubStart] = useState('');
  const [pubEnd, setPubEnd] = useState('');
  const [pubContent, setPubContent] = useState('');

  // 监督举报块预填：公司信息管理的默认监督方案（2026-11-12 借鉴公告向导）
  useEffect(() => {
    if (!isOpen) return;
    fetchMyCompanyInfo()
      .then(ci => {
        const sup = ci?.supervisionProfiles?.find(x => x.isDefault) ?? ci?.supervisionProfiles?.[0];
        if (!sup) return;
        setValues(prev => ({
          ...prev,
          supervisionDepartment: prev.supervisionDepartment || sup.department || '',
          supervisionAddress: prev.supervisionAddress || sup.address || '',
          supervisionContact: prev.supervisionContact || sup.contact || '',
          supervisionPhone: prev.supervisionPhone || sup.phone || '',
        }));
      })
      .catch(() => {});
  }, [isOpen]);

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

  // 标段分区（2026-11-12 用户裁定）：标前开标确认后锁死（组内阶段闸仍适用）；
  // 标后开标确认前锁死、确认后解锁（不再看阶段指针）
  const groups = useMemo(
    () => CHANGE_FIELD_GROUPS.map(g => {
      if (g.zone === 'post') {
        return { ...g, unlocked: bidOpened, lockText: '开标确认前，不能编辑标后' };
      }
      const stageOk = stageReached(currentStage, g.stageKey);
      return {
        ...g,
        unlocked: stageOk && !bidOpened,
        lockText: bidOpened ? '开标后不可修改标前数据' : `未进入 ${g.stageLabel} 阶段，不可变更`,
      };
    }),
    [currentStage, bidOpened],
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
        let v = r?.[field];
        if (v && field === 'bidOpeningTime') v = cnToDatetimeLocal(v); // 提取值为中文格式 → 控件值
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
    if (type === 'ADDENDUM' && !(values.changeContent ?? '').trim()) { toast.error('请填写补遗内容'); return; }
    if (type === 'ADDENDUM' && (!values.announcementStart || !values.announcementEnd)) { toast.error('请选择公示期限起止'); return; }
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
    // 补遗：正文/公示期直接取表单值（不再用默认 3 日）
    if (type === 'ADDENDUM') {
      setPubContent(values.changeContent ?? '');
      setPubStart(values.announcementStart ?? '');
      setPubEnd(values.announcementEnd ?? '');
      setAwaitChoice({ type, reason: trimmedReason, fields });
      return;
    }
    // 变更：正文预填对照；公示期默认 3 日（法定）
    const cs = Object.entries(fields);
    setPubContent(cs.length > 0
      ? cs.map(([f]) => {
          const def = CHANGE_FIELD_GROUPS.flatMap(g => g.fields).find(x => x.field === f);
          return `${def?.label ?? f}：${currentOf(f) || '（空）'} → ${fields[f]}`;
        }).join('\n')
      : trimmedReason);
    setPubStart(toLocalNow());
    setPubEnd(daysAfter(3));
    setAwaitChoice({ type, reason: trimmedReason, fields });
  };

  /** 直接登记（暂不发布路径） */
  const doRegister = async (payload: { type: 'CHANGE' | 'ADDENDUM'; reason: string; fields: Record<string, string> }) => {
    setSaving(true);
    try {
      const r = await registerChange(item.id, payload);
      toast.success(`已登记第 ${r.record.round} 轮${payload.type === 'CHANGE' ? '变更' : '补遗'}`);
      const cs = (r.record.changeset ?? []) as Array<{ label: string; from: string; to: string }>;
      const changeContent = cs.length > 0
        ? cs.map(c => `${c.label}：${c.from || '（空）'} → ${c.to || '（空）'}`).join('\n')
        : payload.reason;
      onRegistered({
        needsAnnouncement: r.needsAnnouncement,
        recordId: r.record.id,
        category: payload.type === 'CHANGE' ? 'change_notice' : 'addendum',
        round: r.record.round,
        reason: payload.reason,
        changeContent,
      }, false);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || '登记失败');
    } finally {
      setSaving(false);
    }
  };

  /** 发布优先（2026-11-12 裁定）：不预登记——公告成功后面板补登记；轮次按现流水预测 */
  const doPublishFirst = async (payload: { type: 'CHANGE' | 'ADDENDUM'; reason: string; fields: Record<string, string> }) => {
    setSaving(true);
    try {
      const recs = await listChanges(item.id).catch(() => []);
      const nextRound = (recs[0]?.round ?? 0) + 1;
      const cs = Object.entries(payload.fields);
      const changeContent = cs.length > 0
        ? cs.map(([f]) => {
            const def = CHANGE_FIELD_GROUPS.flatMap(g => g.fields).find(x => x.field === f);
            return `${def?.label ?? f}：${currentOf(f) || '（空）'} → ${payload.fields[f]}`;
          }).join('\n')
        : payload.reason;
      // 补遗：公告表单值（名称/编号/监督块/落款）随 patch 注入向导
      const addendumPatch: Record<string, string> = payload.type === 'ADDENDUM' ? {
        projectName: values.projectName ?? String(pm.title ?? ''),
        projectCode: values.projectCode ?? String(pm.projectCode ?? ''),
        supervisionDepartment: values.supervisionDepartment ?? '',
        supervisionAddress: values.supervisionAddress ?? '',
        supervisionContact: values.supervisionContact ?? '',
        supervisionPhone: values.supervisionPhone ?? '',
        signatureDate: values.signatureDate ?? new Date().toISOString().slice(0, 10),
      } : {};
      onRegistered({
        needsAnnouncement: 'bidOpeningTime' in payload.fields,
        recordId: '',
        category: payload.type === 'CHANGE' ? 'change_notice' : 'addendum',
        round: nextRound,
        reason: payload.reason,
        changeContent: pubContent.trim() || changeContent,
        publishStart: pubStart,
        publishEnd: pubEnd,
        patchExtra: addendumPatch,
      }, true, payload);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || '操作失败');
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
          <div className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em] text-[var(--foreground)]">
            {type === 'CHANGE' ? <RefreshCcw size={16} className="text-[var(--accent)]" /> : <FilePlus2 size={16} className="text-[var(--accent)]" />}
            {step === 'type' ? '变更 / 补遗' : type === 'CHANGE' ? '变更 · 修改信息' : '补遗 · 说明'}
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs"><X size={15} /></button>
        </div>

        <div className="mx-6 h-px shrink-0 bg-[oklch(0.6_0.04_258_/_0.16)]" />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {step === 'type' && (
            <div className="mt-8 space-y-3">
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
                    <span className="text-sm font-bold text-[var(--foreground)]">{g.label}</span>
                    {!g.unlocked && (
                      <span className="text-[11px] font-medium text-[var(--danger)]">{g.lockText}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {g.fields.map(f => (
                      // 勿把按钮放进 label：label 点击会转发给内部第一个可交互元素，
                      // AI 按钮会被字段区远处点击误触（2026-11-12 实录）——按钮只随自身命中
                      <div key={f.field} className={`flex flex-col gap-1${f.fullRow ? ' col-span-2' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                            {f.label}
                            {g.unlocked && (values[f.field] ?? '') !== '' && (values[f.field] ?? '') !== currentOf(f.field) && <span className="ml-1 font-bold normal-case text-[var(--danger)]">已修改</span>}
                          </span>
                          {f.aiAssist && g.unlocked && (
                            <button
                              type="button"
                              className="neu-btn-xs !h-[22px] !px-2 !text-[10px] !font-semibold"
                              disabled={aiBusy != null}
                              onClick={() => void runAiAssist(f.field, f.aiAssist!)}
                            >
                              {aiBusy === f.field ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                              {(f.field === 'bidOpeningTime' || f.field === 'documentAcquireTime') ? 'AI 提取' : 'AI 提取并优化'}
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
                <div className="space-y-3">
                  <p className="rounded-[12px] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-4 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
                    补遗公告表单（与公告发布同款）：登记留档后可直接发布对外公告。
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">项目名称</span>
                      <input type="text" className="workbench-input" value={values.projectName ?? String(pm.title ?? '')} onChange={e => setValues(v => ({ ...v, projectName: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">项目编号</span>
                      <input type="text" className="workbench-input" value={values.projectCode ?? String(pm.projectCode ?? '')} onChange={e => setValues(v => ({ ...v, projectCode: e.target.value }))} />
                    </label>
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">补遗内容</span>
                      <textarea className="neu-input min-h-[110px] text-sm" value={values.changeContent ?? ''} onChange={e => setValues(v => ({ ...v, changeContent: e.target.value }))} placeholder="补充说明正文（随公告发布）" />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">公示期限（起）</span>
                      <input type="datetime-local" className="workbench-input" value={values.announcementStart ?? ''} onChange={e => setValues(v => ({ ...v, announcementStart: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">公示期限（止）</span>
                      <input type="datetime-local" className="workbench-input" value={values.announcementEnd ?? ''} onChange={e => setValues(v => ({ ...v, announcementEnd: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">监督部门</span>
                      <input type="text" className="workbench-input" value={values.supervisionDepartment ?? ''} onChange={e => setValues(v => ({ ...v, supervisionDepartment: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">监督地址</span>
                      <input type="text" className="workbench-input" value={values.supervisionAddress ?? ''} onChange={e => setValues(v => ({ ...v, supervisionAddress: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">监督联系人</span>
                      <input type="text" className="workbench-input" value={values.supervisionContact ?? ''} onChange={e => setValues(v => ({ ...v, supervisionContact: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">监督电话</span>
                      <input type="text" className="workbench-input" value={values.supervisionPhone ?? ''} onChange={e => setValues(v => ({ ...v, supervisionPhone: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">落款日期</span>
                      <input type="date" className="workbench-input" value={values.signatureDate ?? new Date().toISOString().slice(0, 10)} onChange={e => setValues(v => ({ ...v, signatureDate: e.target.value }))} />
                    </label>
                  </div>
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
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

        {awaitChoice && (
          <div className="space-y-4 px-6 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-[var(--foreground)]">
                发布{awaitChoice.type === 'CHANGE' ? '变更' : '补遗'}公告
              </span>
              <span className="text-[11px] font-medium text-[var(--muted-foreground)]">公示期默认 3 日（法定），可调整</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">公告内容</span>
              <textarea
                className="neu-input min-h-[110px] text-sm"
                value={pubContent}
                onChange={(e) => setPubContent(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">公示期限（起）</span>
                <input type="datetime-local" className="workbench-input" value={pubStart} onChange={(e) => setPubStart(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">公示期限（止）</span>
                <input type="datetime-local" className="workbench-input" value={pubEnd} onChange={(e) => setPubEnd(e.target.value)} />
              </label>
            </div>
            <p className="rounded-[12px] bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-4 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
              下一步进入公告发布确认（可见范围、附件与平台同步在发布页配置）；公告发布成功后自动登记变更，取消则本次修改不生效。
            </p>
          </div>
        )}

        {awaitChoice && (
          <>
            <hr className="wb-section-rule" />
            <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5">
              <button type="button" className="neu-btn-soft" onClick={() => setAwaitChoice(null)}>
                返回修改
              </button>
              <div className="neu-btn-group">
                <button type="button" className="neu-btn-soft" disabled={saving} onClick={() => void doRegister(awaitChoice)}>
                  暂不发布，直接登记
                </button>
                <button
                  type="button"
                  className="neu-btn-primary !h-[38px]"
                  disabled={saving || !pubStart || !pubEnd || !pubContent.trim()}
                  onClick={() => void doPublishFirst(awaitChoice)}
                >
                  下一步：发布公告
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'form' && !awaitChoice && (
          <>
            <hr className="wb-section-rule" />
            <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3.5">
              {type === 'CHANGE' ? (
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
                    changedCount > 0
                      ? 'bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-[var(--danger)]'
                      : 'bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] text-[var(--muted-foreground)]'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${changedCount > 0 ? 'bg-[var(--danger)]' : 'bg-[var(--muted-foreground)]'}`} />
                  已修改 {changedCount} 个字段
                </span>
              ) : (
                <span />
              )}
              <div className="neu-btn-group">
                <button type="button" className="neu-btn-soft" onClick={() => setStep('type')}>上一步</button>
                <button
                  type="button"
                  className="neu-btn-primary !h-[38px]"
                  disabled={saving || (type === 'CHANGE' && changedCount === 0)}
                  title={type === 'CHANGE' && changedCount === 0 ? '请先修改至少一个字段' : undefined}
                  onClick={() => void submit()}
                >
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
