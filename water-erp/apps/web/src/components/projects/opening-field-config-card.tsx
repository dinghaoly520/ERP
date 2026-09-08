'use client';

/**
 * A-113：唱标字段配置卡（:3005 开标确认面板，壳 SectionCard 由宿主提供）。
 * 字段设计器：法定四键（amount/period/qualityTarget/bondStatus）锁定行（仅可改标签）+
 * 动态字段行（key/label/type/options/required 增删改序）。
 * 写径 PUT /bid/projects/:id/opening-field-config（{fields} 手工 / {fromTemplateId} 应用模板）；
 * OPENING/EVALUATING/ARCHIVED 后端 409 OPENING_FIELDS_LOCKED——本卡锁定态如实前置。
 * 模板库（A-115）经 opening-template-library-dialog 复用本卡当前字段存为模板。
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Lock, Plus, RotateCcw, Save, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import {
  STATUTORY_OPENING_KEYS,
  resolveOpeningFields,
  setOpeningFieldConfig,
  type BidStage,
  type OpeningFieldDef,
  type OpeningFieldType,
} from '@/lib/api/bid';
import { OpeningTemplateLibraryDialog } from './opening-template-library-dialog';

type Props = {
  bidProject: { id: string; stage: BidStage; openingFieldConfig?: { fields?: OpeningFieldDef[] } | null };
  onChanged: () => void;
};

/** 编辑行：optionsRaw 为下拉选项的原始草稿文本（逗号分隔，保留输入中的尾逗号），保存时才解析成数组 */
type EditableField = OpeningFieldDef & { optionsRaw?: string };

const TYPE_OPTIONS: { value: OpeningFieldType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '下拉选择' },
];

const LOCKED_STAGES: readonly BidStage[] = ['OPENING', 'EVALUATING', 'ARCHIVED'];

function isStatutory(key: string): boolean {
  return (STATUTORY_OPENING_KEYS as readonly string[]).includes(key);
}

/** 草稿行 → 提交形状（optionsRaw 解析、非 select 剥 options、键序归一——脏检查与保存共用） */
function toEffective(fields: EditableField[]): OpeningFieldDef[] {
  return fields.map((f) => {
    const { optionsRaw, ...rest } = f;
    if (rest.type === 'select') {
      rest.options =
        optionsRaw != null
          ? optionsRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
          : (rest.options ?? []);
    } else {
      delete rest.options;
    }
    return rest;
  });
}

/** 前端预检（后端 assertValidOpeningFieldConfig 为权威，此处拦截最常见错误省一次往返） */
function validateDraft(fields: OpeningFieldDef[]): string | null {
  if (fields.length === 0) return '唱标字段配置不能为空';
  const seen = new Set<string>();
  for (const f of fields) {
    const key = f.key.trim();
    if (!key) return `字段「${f.label || '?'}」的 key 不能为空`;
    if (seen.has(key)) return `字段 key「${key}」重复`;
    seen.add(key);
    if (!f.label.trim()) return `字段「${key}」label 不能为空`;
    if (f.label.length > 20) return `字段「${key}」label 不能超过 20 字`;
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      return `字段「${key}」为下拉选择，须提供非空选项`;
    }
  }
  for (const k of STATUTORY_OPENING_KEYS) {
    if (!fields.some((f) => f.key === k)) return `法定字段「${k}」不可从配置中删除`;
  }
  return null;
}

export function OpeningFieldConfigCard({ bidProject, onChanged }: Props) {
  const locked = LOCKED_STAGES.includes(bidProject.stage);
  const [fields, setFields] = useState<EditableField[]>(() => resolveOpeningFields(bidProject));
  const [saving, setSaving] = useState(false);
  /** 模板库弹窗：false 关闭 / 'manage' 管理 / 'save' 存为模板（打开即聚焦名称输入） */
  const [libOpen, setLibOpen] = useState<false | 'manage' | 'save'>(false);

  /* eslint-disable react-hooks/set-state-in-effect -- 宿主 load() 后随 props 重置草稿：
     保存/应用模板成功后回显服务端真值；props 引用仅在 load() 换新，面板内部重渲染不打扰编辑中草稿 */
  useEffect(() => {
    setFields(resolveOpeningFields(bidProject));
  }, [bidProject]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** 服务端当前值（脏检查基准） */
  const savedFields = useMemo(() => resolveOpeningFields(bidProject), [bidProject]);
  const dirty = useMemo(
    () => JSON.stringify(toEffective(fields)) !== JSON.stringify(savedFields),
    [fields, savedFields],
  );

  const effective = useMemo(() => toEffective(fields), [fields]);

  const updateField = (index: number, patch: Partial<EditableField>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  const moveField = (index: number, dir: -1 | 1) => {
    setFields((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const addField = () => {
    setFields((prev) => [...prev, { key: '', label: '', type: 'text', required: false }]);
  };
  const resetDefault = () => {
    if (!window.confirm('恢复为内置默认四字段（报价/工期/质量承诺/保证金）？当前列表将被替换，保存前可反悔。')) return;
    setFields(resolveOpeningFields(null));
    toast.success('已恢复默认四字段（尚未保存，请点击「保存配置」生效）');
  };

  const handleSave = async () => {
    const error = validateDraft(effective);
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      await setOpeningFieldConfig(bidProject.id, { fields: effective });
      toast.success('唱标字段配置已保存（开标开始后自动锁定）');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'workbench-input !h-8 !px-2 !text-xs';

  return (
    <div>
      {locked && (
        <div className="wb-alert wb-alert--warning mb-3 flex items-center gap-2 text-xs">
          <Lock size={13} /> 开标已开始，唱标字段配置已锁定（《招标投标法》开标程序确定性）
        </div>
      )}

      {/* 工具行：编辑入口 + 保存（脏检查） */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addField} disabled={locked} className="neu-btn-xs gap-1.5">
            <Plus size={13} /> 添加字段
          </button>
          <button type="button" onClick={resetDefault} disabled={locked} className="neu-btn-xs gap-1.5">
            <RotateCcw size={13} /> 恢复默认
          </button>
          <button type="button" onClick={() => setLibOpen('save')} className="neu-btn-xs gap-1.5">
            <Save size={13} /> 存为模板…
          </button>
          <button type="button" onClick={() => setLibOpen('manage')} className="neu-btn-xs gap-1.5">
            <ScrollText size={13} /> 管理模板库
          </button>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={locked || saving || !dirty}
          title={locked ? '开标已开始，配置已锁定' : !dirty ? '无修改' : undefined}
          className="neu-btn-primary !h-[34px] !text-xs gap-1.5"
        >
          <Save size={13} /> {saving ? '保存中…' : '保存配置'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="neu-table w-full min-w-[760px] [&_td]:!py-1.5 [&_th]:!py-2">
          <thead>
            <tr>
              <th className="w-10 !text-left !text-[10px]">序</th>
              <th className="!text-left !text-[10px]">字段键</th>
              <th className="!text-left !text-[10px]">标签（≤20 字）</th>
              <th className="w-24 !text-left !text-[10px]">类型</th>
              <th className="!text-left !text-[10px]">下拉选项（逗号分隔）</th>
              <th className="w-12 !text-left !text-[10px]">必填</th>
              <th className="w-24 !text-left !text-[10px]">操作</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => {
              const statutory = isStatutory(f.key);
              return (
                <tr key={`${f.key}-${i}`}>
                  <td className="tabular-nums text-[var(--muted-foreground)]">{i + 1}</td>
                  <td>
                    {statutory ? (
                      <span className="flex items-center gap-1.5" title="法定字段：不可删除、类型锁定，仅可修改标签">
                        <Lock size={11} className="shrink-0 text-[var(--warning)]" />
                        <span className="font-mono text-xs">{f.key}</span>
                        <span className="shrink-0 rounded-full bg-[var(--warning-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--warning)]">
                          法定
                        </span>
                      </span>
                    ) : (
                      <input
                        className={`${inputCls} w-32 font-mono`}
                        value={f.key}
                        placeholder="建议英文键"
                        disabled={locked}
                        onChange={(e) => updateField(i, { key: e.target.value })}
                      />
                    )}
                  </td>
                  <td>
                    <input
                      className={`${inputCls} w-32`}
                      value={f.label}
                      maxLength={20}
                      disabled={locked}
                      onChange={(e) => updateField(i, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    {statutory ? (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {TYPE_OPTIONS.find((t) => t.value === f.type)?.label ?? f.type}
                      </span>
                    ) : (
                      <select
                        className={`${inputCls} w-24`}
                        value={f.type}
                        disabled={locked}
                        onChange={(e) => updateField(i, { type: e.target.value as OpeningFieldType })}
                      >
                        {TYPE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {statutory ? (
                      <span className="text-[11px] text-[var(--muted-foreground)]">
                        {f.options?.length ? f.options.join(' / ') : '—'}
                      </span>
                    ) : f.type === 'select' ? (
                      <input
                        className={`${inputCls} w-40`}
                        value={f.optionsRaw ?? f.options?.join(',') ?? ''}
                        placeholder="选项1,选项2,…"
                        disabled={locked}
                        onChange={(e) => updateField(i, { optionsRaw: e.target.value })}
                      />
                    ) : (
                      <span className="text-xs text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="text-center">
                    {statutory ? (
                      <span className="text-xs font-bold text-[var(--success)]">✓</span>
                    ) : (
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[var(--accent)]"
                        checked={!!f.required}
                        disabled={locked}
                        onChange={(e) => updateField(i, { required: e.target.checked })}
                      />
                    )}
                  </td>
                  <td>
                    {statutory ? (
                      <span className="text-[10px] text-[var(--muted-foreground)]">锁定</span>
                    ) : (
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          className="neu-btn-xs !h-6 !w-6 !p-0"
                          title="上移"
                          disabled={locked || i === 0}
                          onClick={() => moveField(i, -1)}
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          type="button"
                          className="neu-btn-xs !h-6 !w-6 !p-0"
                          title="下移"
                          disabled={locked || i === fields.length - 1}
                          onClick={() => moveField(i, 1)}
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          type="button"
                          className="neu-btn-xs !h-6 !w-6 !p-0 is-danger"
                          title="删除字段"
                          disabled={locked}
                          onClick={() => setFields((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        法定四字段（报价 / 工期 / 质量承诺 / 保证金）不可删除、类型锁定，仅可修改标签；动态字段在唱标时人工录入，值落开标记录 customFields。
      </p>

      <OpeningTemplateLibraryDialog
        open={libOpen !== false}
        intent={libOpen === 'save' ? 'save' : 'manage'}
        onClose={() => setLibOpen(false)}
        projectId={bidProject.id}
        locked={locked}
        currentFields={effective}
        onChanged={onChanged}
      />
    </div>
  );
}
