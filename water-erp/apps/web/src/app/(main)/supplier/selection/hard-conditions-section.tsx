'use client';
import { useState } from 'react';
import { X, Plus, Search, Check } from 'lucide-react';
import type { HardConditions, HardConditionVocab } from '@/lib/api/supplier';

/**
 * 硬性筛选（2026-11-04 二次裁定）：行业/资质与业务标签同款三层设计（搜索栏/已选条/内凹词表区）、依次放置；
 * 标签必选，其余可选；业绩条件+评价等级并入本区。
 * spec docs/superpowers/specs/2026-11-04-supplier-requirement-hard-conditions-design.md
 */

interface VocabItem {
  key: string;
  label: string;
  count?: number;
  title?: string;
}

/** 与 BusinessTagsPicker 同款三层 picker：操作栏（搜索）/ 已选过滤条 / 可选词表（内凹滚动区） */
function TagStylePicker({ searchPlaceholder, emptyText, items, selectedKeys, onToggle, onClear, renderSelected }: {
  searchPlaceholder: string;
  emptyText: string;
  items: VocabItem[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  /** 已选条内容覆写（资质用：额外带 必须/优先 下拉） */
  renderSelected?: (key: string) => React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const filtered = ql ? items.filter((i) => i.label.toLowerCase().includes(ql)) : items;
  const hasSelected = selectedKeys.length > 0;

  return (
    <div className="rounded-xl border border-[oklch(0.6_0.04_258_/_0.12)]" style={{ background: 'oklch(0.98 0.008 258 / 0.35)' }}>
      {/* 第一层：操作栏（搜索；AI 预填统一走「AI 按项目文件生成」按钮） */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="workbench-input w-full !pl-8 !pr-2 text-xs !h-7"
          />
        </div>
      </div>

      {/* 第二层：已选过滤（有选中时显示，视觉与业务标签一致） */}
      {hasSelected && (
        <div className="px-3 pb-2.5">
          <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-2"
            style={{ background: 'color-mix(in oklch, var(--accent) 6%, transparent)', boxShadow: 'inset 0 1px 2px oklch(0.5 0.04 258 / 0.06)' }}>
            <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
              <span className="mr-0.5 shrink-0 text-[10px] font-extrabold tabular-nums text-[var(--accent-strong)]">已选 {selectedKeys.length}</span>
              {selectedKeys.map((k) =>
                renderSelected ? (
                  <span key={k}>{renderSelected(k)}</span>
                ) : (
                  <span key={k} className="neu-tag is-on text-xs">
                    {k}
                    <button type="button" onClick={() => onToggle(k)} aria-label={`移除 ${k}`} className="neu-tag__x">
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  </span>
                ),
              )}
            </div>
            <button type="button" onClick={onClear} className="neu-btn-xs shrink-0">清空</button>
          </div>
        </div>
      )}

      {/* 第三层：可选词表（内凹滚动区，样式与业务标签词表一致） */}
      <div className="px-3 pb-3">
        {items.length > 0 ? (
          filtered.length > 0 ? (
            <div className="flex max-h-[120px] flex-wrap content-start gap-1 overflow-y-auto rounded-lg px-2.5 py-2"
              style={{ background: 'oklch(0.968 0.01 258 / 0.45)', boxShadow: 'inset 1px 1px 4px oklch(0.52 0.05 258 / 0.08), inset -1px -1px 2px oklch(1 0 0 / 0.55)' }}>
              {filtered.map((item) => {
                const on = selectedKeys.includes(item.key);
                return (
                  <button key={item.key} type="button" onClick={() => onToggle(item.key)} title={item.title}
                    className={`neu-tag text-xs ${on ? 'is-on' : ''}`}>
                    {on && <Check size={10} strokeWidth={3} className="shrink-0" />}{item.label}
                    {item.count != null && <span className="neu-tag__count">{item.count}</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            q && <p className="text-[10px] text-[var(--muted-foreground)]">无匹配结果</p>
          )
        ) : (
          <p className="text-[10px] leading-5 text-[var(--muted-foreground)]">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

/** 外层标签（与「业务标签」label 同款样式） */
function BlockLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)] block mb-1.5">
      {text}{' '}
      {required
        ? <span className="text-[10px] font-bold normal-case text-[var(--danger)]">必选</span>
        : <span className="text-[10px] font-bold normal-case text-[var(--muted-foreground)]/70">可选</span>}
    </label>
  );
}

export function HardConditionsSection({ vocab, value, onChange }: {
  vocab: HardConditionVocab | null;
  value: HardConditions;
  onChange: (v: HardConditions) => void;
}) {
  const [perfKeyword, setPerfKeyword] = useState('');

  const toggleIndustry = (name: string) => {
    const cur = value.industries || [];
    onChange({ ...value, industries: cur.includes(name) ? cur.filter((i) => i !== name) : [...cur, name] });
  };
  const toggleQualification = (key: string) => {
    const cur = value.qualifications || [];
    if (cur.some((q) => q.key === key)) {
      onChange({ ...value, qualifications: cur.filter((q) => q.key !== key) });
    } else {
      onChange({ ...value, qualifications: [...cur, { key, required: true }] });
    }
  };
  const setQualRequired = (key: string, required: boolean) => {
    onChange({ ...value, qualifications: (value.qualifications || []).map((q) => (q.key === key ? { ...q, required } : q)) });
  };
  const addPerfKeyword = () => {
    const k = perfKeyword.trim();
    if (!k) return;
    const cur = value.performance?.keywords || [];
    if (!cur.includes(k)) onChange({ ...value, performance: { ...value.performance, keywords: [...cur, k] } });
    setPerfKeyword('');
  };
  const removePerfKeyword = (k: string) => {
    onChange({ ...value, performance: { ...value.performance, keywords: (value.performance?.keywords || []).filter((x) => x !== k) } });
  };

  const industryItems: VocabItem[] = (vocab?.industries || []).map((i) => ({
    key: i.name, label: i.name, count: i.count, title: `${i.count} 家供应商`,
  }));
  const qualItems: VocabItem[] = (vocab?.qualifications || []).map((q) => ({
    key: q.key, label: q.label, title: q.category,
  }));
  const qualLabelOf = (key: string) => vocab?.qualifications.find((d) => d.key === key)?.label || key;

  return (
    <div className="space-y-4">
      {/* ② 行业（同款三层设计；词表=库内注册行业，徽标=家数） */}
      <div>
        <BlockLabel text="行业" />
        <TagStylePicker
          searchPlaceholder="搜索行业…"
          emptyText={vocab ? '库内暂无入库供应商' : '词表加载中…'}
          items={vocab ? industryItems : []}
          selectedKeys={value.industries || []}
          onToggle={toggleIndustry}
          onClear={() => onChange({ ...value, industries: [] })}
        />
      </div>

      {/* ③ 资质（同款三层设计；已选条带 必须/优先） */}
      <div>
        <BlockLabel text="资质" />
        <TagStylePicker
          searchPlaceholder="搜索资质…"
          emptyText={vocab ? '资质字典为空' : '词表加载中…'}
          items={vocab ? qualItems : []}
          selectedKeys={(value.qualifications || []).map((q) => q.key)}
          onToggle={toggleQualification}
          onClear={() => onChange({ ...value, qualifications: [] })}
          renderSelected={(key) => (
            <span className="neu-tag is-on text-xs">
              {qualLabelOf(key)}
              <select value={(value.qualifications || []).find((q) => q.key === key)?.required === false ? 'preferred' : 'required'}
                onChange={(e) => setQualRequired(key, e.target.value === 'required')}
                className="cursor-pointer bg-transparent text-[10px] font-bold outline-none">
                <option value="required">必须</option>
                <option value="preferred">优先</option>
              </select>
              <button type="button" onClick={() => toggleQualification(key)} aria-label={`移除 ${qualLabelOf(key)}`} className="neu-tag__x">
                <X size={11} strokeWidth={2.5} />
              </button>
            </span>
          )}
        />
      </div>

      {/* ④ 业绩与评价（同款容器；三行对齐表单——门槛/关键词/等级分段） */}
      <div>
        <BlockLabel text="业绩与评价" />
        <div className="rounded-xl border border-[oklch(0.6_0.04_258_/_0.12)] px-3 py-3 space-y-2.5" style={{ background: 'oklch(0.98 0.008 258 / 0.35)' }}>
          {/* 行 1：业绩门槛（自然语句式） */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-[56px] shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">业绩门槛</span>
            <span className="text-xs text-[var(--foreground)]">近</span>
            <input type="number" min={1} max={10} value={value.performance?.years ?? ''}
              onChange={(e) => onChange({ ...value, performance: { ...value.performance, years: e.target.value ? Number(e.target.value) : undefined } })}
              className="workbench-input !w-[80px] !h-7 !text-xs text-center" placeholder="年限" />
            <span className="text-xs text-[var(--foreground)]">年，至少</span>
            <input type="number" min={1} max={99} value={value.performance?.minCount ?? ''}
              onChange={(e) => onChange({ ...value, performance: { ...value.performance, minCount: e.target.value ? Number(e.target.value) : undefined } })}
              className="workbench-input !w-[80px] !h-7 !text-xs text-center" placeholder="数量" />
            <span className="text-xs text-[var(--foreground)]">项同类业绩</span>
            <span className="text-[10px] text-[var(--muted-foreground)]">留空即不限</span>
          </div>

          {/* 行 2：业绩关键词（chips + 回车添加） */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-[56px] shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">业绩关键词</span>
            {(value.performance?.keywords || []).map((k) => (
              <span key={k} className="neu-tag is-on text-xs">
                {k}
                <button type="button" onClick={() => removePerfKeyword(k)} aria-label={`移除 ${k}`} className="neu-tag__x">
                  <X size={11} strokeWidth={2.5} />
                </button>
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <input value={perfKeyword} onChange={(e) => setPerfKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPerfKeyword(); } }}
                className="workbench-input !w-[140px] !h-7 !text-xs" placeholder="输入关键词，回车添加" />
              <button type="button" onClick={addPerfKeyword} disabled={!perfKeyword.trim()} className="neu-btn-xs !h-7 !px-2" aria-label="添加关键词"><Plus size={11} /></button>
            </span>
          </div>

          {/* 行 3：评价等级（分段按钮，一键切换；再点已选项=恢复不限） */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-[56px] shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">评价等级</span>
            {([undefined, 'A', 'B', 'C'] as const).map((g) => {
              const on = value.minGrade === g;
              return (
                <button key={g ?? 'any'} type="button" onClick={() => onChange({ ...value, minGrade: on ? undefined : (g as HardConditions['minGrade']) })}
                  className={`neu-tag text-xs ${on ? 'is-on' : ''}`}>
                  {on && <Check size={10} strokeWidth={3} className="shrink-0" />}
                  {g ? `不低于 ${g} 级` : '不限'}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
