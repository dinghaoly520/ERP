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
import { RefreshCcw, FilePlus2, X, Sparkles, Loader2, ScrollText, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { registerChange, listChanges, type ProjectChangeRecord } from '@/lib/api/project-changes';
import { CHANGE_FIELD_GROUPS, stageReached } from '@/lib/change-fields';
import { SearchSelect, type SearchSelectOption } from '@/components/workbench/search-select';
import { fetchProjectManagementList, extractTenderFields, optimizeInitiationFields } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';

type Step = 'type' | 'form' | 'records';

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
  // 记录视图（2026-11-12：并入本窗口第三步）
  const [records, setRecords] = useState<ProjectChangeRecord[] | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // 登记前选择（2026-11-12 用户裁定）：是否先发布公告——发布优先模式未登记数据，
  // 公告发布成功才由面板补登记；取消发布=放弃本次修改
  const [awaitChoice, setAwaitChoice] = useState<{ type: 'CHANGE' | 'ADDENDUM'; reason: string; fields: Record<string, string> } | null>(null);
  // 发布配置（2026-11-12 借鉴公告向导发布步）：正文/公示期限——随向导注入预填
  const [pubStart, setPubStart] = useState('');
  const [pubEnd, setPubEnd] = useState('');
  const [pubContent, setPubContent] = useState('');

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

  useEffect(() => {
    if (isOpen && step === 'records') {
      // 每次进入强制刷新（2026-11-12 审计修复）：登记新轮次后旧缓存不再复显
      setRecordsLoading(true);
      listChanges(item.id)
        .then(setRecords)
        .catch(() => setRecords([]))
        .finally(() => setRecordsLoading(false));
    }
  }, [isOpen, step, item.id]);

  if (!isOpen) return null;

  const submit = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) { toast.error('请填写变更理由'); return; }
    if (type === 'CHANGE' && changedCount === 0) { toast.error('请至少修改一个字段'); return; }
    if (type === 'ADDENDUM' && !(values.changeContent ?? '').trim()) { toast.error('请填写补遗内容'); return; }
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
    // 补遗必须发公告（2026-11-12 用户裁定）：跳过选择步，直接进入公告发布（发布优先）；
    // 取消发布 = 放弃补遗（无登记留档的单独路径）
    if (type === 'ADDENDUM') {
      await doPublishFirst({ type, reason: trimmedReason, fields });
      return;
    }
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
        : (values.changeContent ?? payload.reason);
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

  /** 发布优先（2026-11-12 裁定）：不预登记——公告编辑与发布配置在向导完成，
   *  发布成功后由面板补登记；取消发布 = 放弃本次修改 */
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
        : (values.changeContent ?? payload.reason);
      // 补遗：公告表单值（正文/公示期/监督块/落款）随 patch 注入向导
      // 补遗只预填内容（2026-11-12 裁定）：名称/公示期/监督块/落款在公告发布页面填入
      const patchExtra: Record<string, string> = payload.type === 'ADDENDUM' ? {
        changeContent: values.changeContent ?? '',
      } : {};
      onRegistered({
        needsAnnouncement: 'bidOpeningTime' in payload.fields,
        recordId: '',
        category: payload.type === 'CHANGE' ? 'change_notice' : 'addendum',
        round: nextRound,
        reason: payload.reason,
        changeContent,
        patchExtra,
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
            {step === 'type' ? '变更 / 补遗' : step === 'records' ? '变更 / 补遗记录' : type === 'CHANGE' ? '变更 · 修改信息' : '补遗 · 说明'}
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
              <button type="button" onClick={() => setStep('records')} className="neu-card block w-full p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]"><ScrollText size={15} className="text-[var(--muted-foreground)]" />变更 / 补遗记录</div>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted-foreground)]">查看本项目历次变更与补遗的轮次、理由与内容对照。</p>
              </button>
            </div>
          )}

          {step === 'records' && (
            <div className="mt-4 space-y-2">
              {recordsLoading && <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">正在加载…</p>}
              {!recordsLoading && records && records.length === 0 && (
                <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">本项目尚无变更 / 补遗记录</p>
              )}
              {!recordsLoading && records && records.length > 0 && records.map((r) => {
                const summary = r.changeset?.[0]
                  ? `${r.changeset[0].label}：${r.changeset[0].from} → ${r.changeset[0].to}${r.changeset.length > 1 ? ` 等 ${r.changeset.length} 项` : ''}`
                  : '补遗登记';
                const open = expandedId === r.id;
                return (
                  <div key={r.id} className="rounded-[12px] bg-[var(--surface)]">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                      onClick={() => setExpandedId(open ? null : r.id)}
                    >
                      <span
                        className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[7px] px-1.5 text-[11px] font-extrabold"
                        style={{
                          background: r.type === 'CHANGE' ? 'color-mix(in oklch, var(--warning) 16%, transparent)' : 'color-mix(in oklch, var(--accent) 14%, transparent)',
                          color: r.type === 'CHANGE' ? 'var(--warning)' : 'var(--accent)',
                        }}
                      >
                        {r.round}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[var(--foreground)]">
                          {r.type === 'CHANGE' ? '变更' : '补遗'} · {summary}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">
                          理由：{r.reason} · {r.operatorName} · {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </span>
                      </span>
                      {r.needsAnnouncement && !r.announcementId && (
                        <span className="shrink-0 rounded-[6px] bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                          公告待发
                        </span>
                      )}
                      <ChevronRight size={15} className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-90' : ''}`} />
                    </button>
                    {open && r.changeset?.length > 0 && (
                      <div className="px-4 pb-3">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                              <th className="py-1 pr-2 font-bold">字段</th>
                              <th className="py-1 pr-2 font-bold">原值</th>
                              <th className="py-1 font-bold">新值</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.changeset.map((c) => (
                              <tr key={c.field} className="text-[var(--foreground)]">
                                <td className="border-t border-[var(--border)]/60 py-1.5 pr-2 font-semibold">{c.label}</td>
                                <td className="border-t border-[var(--border)]/60 py-1.5 pr-2 text-[var(--muted-foreground)]">{c.from || '（空）'}</td>
                                <td className="border-t border-[var(--border)]/60 py-1.5 font-semibold text-[var(--accent-strong)]">{c.to || '（空）'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
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
                    补遗登记：填写补充说明与理由留档；名称、公示期限、监督块等在公告发布页面填入。
                  </p>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">补遗内容</span>
                    <textarea className="neu-input min-h-[130px] text-sm" value={values.changeContent ?? ''} onChange={e => setValues(v => ({ ...v, changeContent: e.target.value }))} placeholder="补充说明正文（随公告发布）" />
                  </label>
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
                  disabled={saving}
                  onClick={() => void doPublishFirst(awaitChoice)}
                >
                  发布公告
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'records' && (
          <>
            <hr className="wb-section-rule" />
            <div className="flex shrink-0 items-center justify-end px-6 py-3.5">
              <button type="button" className="neu-btn-soft" onClick={() => setStep('type')}>返回</button>
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
