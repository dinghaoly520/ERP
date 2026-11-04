'use client';
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { HardConditions, HardConditionVocab } from '@/lib/api/supplier';

/**
 * 硬性筛选（2026-11-04 用户二次裁定）：行业/资质做成与业务标签同款的设计、依次放置；
 * 标签必选，行业/资质可选；业绩条件+评价等级并入本区。
 * spec docs/superpowers/specs/2026-11-04-supplier-requirement-hard-conditions-design.md
 */

/** 同款 picker 容器（视觉与 BusinessTagsPicker 一致：圆角内凹容器 + 已选条 + 词表 chips） */
function PickerShell({ label, required, hint, children }: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[oklch(0.6_0.04_258_/_0.12)]" style={{ background: 'oklch(0.98 0.008 258 / 0.35)' }}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="text-xs font-extrabold text-[var(--foreground)]">
          {label}
          {required
            ? <span className="ml-1 text-[10px] font-bold text-[var(--danger)]">必选</span>
            : <span className="ml-1 text-[10px] font-normal text-[var(--muted-foreground)]">可选</span>}
        </span>
        {hint && <span className="text-[10px] text-[var(--muted-foreground)]">{hint}</span>}
      </div>
      <div className="px-3 pb-3">{children}</div>
    </div>
  );
}

/** 已选条（同业务标签第二层视觉：accent 底 + neu-tag is-on + 清空） */
function SelectedStrip({ count, onClear, children }: {
  count: number;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-2">
      <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-2"
        style={{ background: 'color-mix(in oklch, var(--accent) 6%, transparent)', boxShadow: 'inset 0 1px 2px oklch(0.5 0.04 258 / 0.06)' }}>
        <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">{children}</div>
        {onClear && <button type="button" onClick={onClear} className="neu-btn-xs shrink-0">清空</button>}
      </div>
    </div>
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

  return (
    <div className="space-y-4">
      {/* ② 行业（同款设计，词表=库内行业+家数徽标） */}
      <PickerShell label="行业" hint="推荐时核验库内注册行业（26 类国民经济行业）">
        {!vocab && <p className="text-[10px] leading-5 text-[var(--muted-foreground)]">词表加载中…</p>}
        {vocab && vocab.industries.length === 0 && <p className="text-[10px] leading-5 text-[var(--muted-foreground)]">库内暂无入库供应商</p>}
        {vocab && vocab.industries.length > 0 && (
          <>
            <SelectedStrip count={(value.industries || []).length} onClear={() => onChange({ ...value, industries: [] })}>
              <span className="mr-0.5 shrink-0 text-[10px] font-extrabold tabular-nums text-[var(--accent-strong)]">已选 {(value.industries || []).length}</span>
              {(value.industries || []).map((name) => (
                <span key={name} className="neu-tag is-on text-xs">
                  {name}
                  <button type="button" onClick={() => toggleIndustry(name)} aria-label={`移除 ${name}`} className="neu-tag__x">
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </SelectedStrip>
            <div className="flex flex-wrap gap-1">
              {vocab.industries.map((ind) => {
                const on = (value.industries || []).includes(ind.name);
                return (
                  <button key={ind.name} type="button" onClick={() => toggleIndustry(ind.name)} title={`库内该行业 ${ind.count} 家`}
                    className={`neu-tag text-xs ${on ? 'is-on' : ''}`}>
                    {ind.name}<span className="text-[9px] tabular-nums opacity-60">{ind.count}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </PickerShell>

      {/* ③ 资质（同款设计，字典 chips + 必须/优先） */}
      <PickerShell label="资质" hint="核验库内资质记录与有效期；「必须」不满足剔除、「优先」仅加分">
        {!vocab && <p className="text-[10px] leading-5 text-[var(--muted-foreground)]">词表加载中…</p>}
        {vocab && vocab.qualifications.length === 0 && <p className="text-[10px] leading-5 text-[var(--muted-foreground)]">资质字典为空</p>}
        {vocab && vocab.qualifications.length > 0 && (
          <>
            <SelectedStrip count={(value.qualifications || []).length} onClear={() => onChange({ ...value, qualifications: [] })}>
              <span className="mr-0.5 shrink-0 text-[10px] font-extrabold tabular-nums text-[var(--accent-strong)]">已选 {(value.qualifications || []).length}</span>
              {(value.qualifications || []).map((q) => {
                const dict = vocab.qualifications.find((d) => d.key === q.key);
                return (
                  <span key={q.key} className="neu-tag is-on text-xs">
                    {dict?.label || q.key}
                    <select value={q.required ? 'required' : 'preferred'} onChange={(e) => setQualRequired(q.key, e.target.value === 'required')}
                      className="cursor-pointer bg-transparent text-[10px] font-bold outline-none" title="必须=不满足剔除；优先=仅展示加分">
                      <option value="required">必须</option>
                      <option value="preferred">优先</option>
                    </select>
                    <button type="button" onClick={() => toggleQualification(q.key)} aria-label={`移除 ${dict?.label || q.key}`} className="neu-tag__x">
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  </span>
                );
              })}
            </SelectedStrip>
            <div className="flex flex-wrap gap-1">
              {vocab.qualifications.filter((d) => !(value.qualifications || []).some((q) => q.key === d.key)).map((d) => (
                <button key={d.key} type="button" onClick={() => toggleQualification(d.key)} title={d.category} className="neu-tag text-xs">
                  {d.label}
                </button>
              ))}
            </div>
          </>
        )}
      </PickerShell>

      {/* ④ 业绩条件 + 评价等级（紧凑行，并入硬性筛选区） */}
      <PickerShell label="业绩与评价" hint="业绩核验库内自报业绩记录（当前库为空时标「资料缺失」保留）；评价等级取最新评价">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold text-[var(--muted-foreground)]">近</span>
          <input type="number" min={1} max={10} value={value.performance?.years ?? ''}
            onChange={(e) => onChange({ ...value, performance: { ...value.performance, years: e.target.value ? Number(e.target.value) : undefined } })}
            className="workbench-input !w-[52px] !h-7 !text-xs" placeholder="年限" />
          <span className="text-[10px] text-[var(--muted-foreground)]">年 ≥</span>
          <input type="number" min={1} max={99} value={value.performance?.minCount ?? ''}
            onChange={(e) => onChange({ ...value, performance: { ...value.performance, minCount: e.target.value ? Number(e.target.value) : undefined } })}
            className="workbench-input !w-[52px] !h-7 !text-xs" placeholder="数量" />
          <span className="text-[10px] text-[var(--muted-foreground)]">项 关键词</span>
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
              className="workbench-input !w-[88px] !h-7 !text-xs" placeholder="如：钻机" />
            <button type="button" onClick={addPerfKeyword} disabled={!perfKeyword.trim()} className="neu-btn-xs !h-7 !px-2"><Plus size={11} /></button>
          </span>
          <span className="ml-2 shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">评价等级</span>
          <select value={value.minGrade || ''}
            onChange={(e) => onChange({ ...value, minGrade: (e.target.value || undefined) as HardConditions['minGrade'] })}
            className="workbench-input !w-[72px] !h-7 !text-xs">
            <option value="">不限</option>
            <option value="A">≥A</option>
            <option value="B">≥B</option>
            <option value="C">≥C</option>
          </select>
        </div>
      </PickerShell>
    </div>
  );
}
