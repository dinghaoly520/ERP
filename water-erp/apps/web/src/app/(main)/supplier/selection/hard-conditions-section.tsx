'use client';
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { HardConditions, HardConditionVocab } from '@/lib/api/supplier';

/**
 * 硬性筛选条件区（2026-11-04 spec docs/superpowers/specs/2026-11-04-supplier-requirement-hard-conditions-design.md）
 * 词表全部来自库内真实数据：行业=库内聚合（带家数徽标）、资质=后端内置字典；
 * 推荐时后端三态核验（✓满足/✗不满足剔除/○资料缺失保留）。
 */
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

  const hasAny =
    (value.industries?.length || 0) + (value.qualifications?.length || 0) > 0 ||
    !!(value.performance && (value.performance.years || value.performance.minCount || value.performance.keywords?.length)) ||
    !!value.minGrade;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          硬性筛选条件 <span className="font-normal normal-case tracking-normal">（推荐时逐项核验库内资料：满足✓ / 资料缺失○标黄人工核实 / 不满足✗剔除）</span>
        </label>
        {hasAny && (
          <button type="button" onClick={() => onChange({})} className="neu-btn-xs shrink-0">清空</button>
        )}
      </div>

      {/* 行业（词表=库内行业+家数徽标） */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">行业</span>
        {!vocab && <span className="text-[10px] text-[var(--muted-foreground)]">词表加载中…</span>}
        {vocab && vocab.industries.length === 0 && <span className="text-[10px] text-[var(--muted-foreground)]">库内暂无入库供应商</span>}
        {vocab?.industries.map((ind) => {
          const on = (value.industries || []).includes(ind.name);
          return (
            <button key={ind.name} type="button" onClick={() => toggleIndustry(ind.name)} title={`库内该行业 ${ind.count} 家`}
              className={`neu-tag text-xs ${on ? 'is-on' : ''}`}>
              {ind.name}<span className="text-[9px] tabular-nums opacity-60">{ind.count}</span>
            </button>
          );
        })}
      </div>

      {/* 资质（字典 chips + 必须/优先 + 移除） */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">资质</span>
        {!vocab && <span className="text-[10px] text-[var(--muted-foreground)]">词表加载中…</span>}
        {(value.qualifications || []).map((q) => {
          const dict = vocab?.qualifications.find((d) => d.key === q.key);
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
        {vocab?.qualifications.filter((d) => !(value.qualifications || []).some((q) => q.key === d.key)).map((d) => (
          <button key={d.key} type="button" onClick={() => toggleQualification(d.key)} title={d.category} className="neu-tag text-xs">
            {d.label}
          </button>
        ))}
      </div>

      {/* 业绩（年限/数量/关键词）+ 评价等级 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-bold text-[var(--muted-foreground)]">业绩</span>
        <span className="text-[10px] text-[var(--muted-foreground)]">近</span>
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
    </div>
  );
}
