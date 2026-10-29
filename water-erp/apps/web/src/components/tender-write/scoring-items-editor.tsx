"use client";

import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import type { ScoringItem } from "@/lib/types/tender-write";

export function createEmptyScoringItem(): ScoringItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    factor: "",
    score: "",
    criteria: "",
    note: "",
  };
}

/** 有效行判定（导出闸门/进度同口径）：评分因素或评分标准非空 */
export function hasValidScoringRows(items?: ScoringItem[] | null): boolean {
  return !!items?.some((it) => it.factor.trim() || it.criteria.trim());
}

/** 分值合计（可解析数字求和，两位小数；无可解析值返回 null）。
 * 口径与导出一致：只累计有效行（评分因素或评分标准非空）——幽灵行
 * （仅填了分值）不计入，避免屏上合计与 docx 合计分叉。 */
export function scoringTotal(items?: ScoringItem[] | null): number | null {
  if (!items?.length) return null;
  let sum = 0;
  let any = false;
  for (const it of items) {
    if (!(it.factor.trim() || it.criteria.trim())) continue;
    const n = parseFloat(it.score);
    if (!Number.isNaN(n)) {
      sum += n;
      any = true;
    }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

/** AI 生成文本 → 评分行：Tab 优先，逗号/多空格兜底；列序=评分因素/分值/评分标准/说明 */
export function parseScoringTextToItems(text: string): ScoringItem[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const items: ScoringItem[] = [];
  for (const line of lines) {
    // Tab 分列最可靠；无 Tab 的逗号兜底只信任前两列（因素、纯数字分值），
    // 其余整段拼回评分标准——含逗号的打分公式不会被拦腰截进说明列
    const parts = line.includes("\t")
      ? line.split("\t")
      : line.split(/[，,]/);
    if (!parts[0]?.trim()) continue;
    let factor = parts[0].trim();
    let score = "";
    let criteria = "";
    let note = "/";
    if (line.includes("\t")) {
      score = (parts[1] ?? "").replace(/[^0-9.]/g, "");
      criteria = (parts[2] ?? "").trim();
      note = (parts[3] ?? "").trim() || "/";
    } else {
      const rest = parts.slice(1);
      const numericIdx = rest.findIndex((seg) => /^\s*[0-9]+(\.[0-9]+)?\s*$/.test(seg));
      if (numericIdx === 0) {
        score = rest[0].trim();
        criteria = rest.slice(1).join("，");
      } else {
        // 无数字分值列：整行进因素，其余留空由用户补
        factor = line.trim();
      }
    }
    items.push({
      id: Math.random().toString(36).slice(2, 10),
      factor,
      score,
      criteria,
      note,
    });
  }
  return items.length ? items : null;
}

const inputCls =
  "w-full rounded-[10px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.6)] px-2.5 py-1.5 text-sm text-[color:var(--foreground)] outline-none transition-all focus:border-[rgba(107,149,240,0.34)] focus:shadow-[0_0_0_4px_rgba(113,152,242,0.08)]";

/**
 * 综合评分法评审标准编辑器（询比 v2）：五列对齐 docx「六、综合评分法评审标准」表——
 * 序号自动、分值自动合计（≠100 黄色提示不阻断）、评分标准多行文本、行增删/上下移。
 */
export function ScoringItemsEditor({
  value,
  onChange,
  onAiGenerate,
  isGenerating,
  aiError,
}: {
  value: ScoringItem[];
  onChange: (items: ScoringItem[]) => void;
  onAiGenerate?: () => void;
  isGenerating?: boolean;
  aiError?: string | null;
}) {
  const total = scoringTotal(value);
  const totalValid = total !== null && Math.abs(total - 100) < 0.005;

  const update = (id: string, patch: Partial<ScoringItem>) =>
    onChange(value.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.2)] bg-[oklch(1_0_0_/_0.3)] px-3 py-2">
        <span className="text-sm text-[color:var(--muted-foreground)]">
          评审方法：
          <span className="font-semibold text-[color:var(--foreground)]">
            综合评分法（固定）
          </span>
        </span>
        <div className="flex items-center gap-2">
          {onAiGenerate && (
            <button
              type="button"
              onClick={onAiGenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-[color:var(--foreground)] transition-all hover:bg-[oklch(1_0_0_/_0.5)] disabled:opacity-50"
            >
              <Sparkles size={13} />
              {isGenerating ? "生成中…" : "AI 生成"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onChange([...value, createEmptyScoringItem()])}
            className="flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 text-xs font-medium text-[color:var(--foreground)] transition-all hover:bg-[oklch(1_0_0_/_0.5)]"
          >
            <Plus size={13} /> 添加评分因素
          </button>
        </div>
      </div>

      {aiError && <p className="px-1 text-xs text-[rgba(199,108,83,1)]">{aiError}</p>}

      <div className="overflow-x-auto rounded-[14px] border border-[oklch(0.6_0.04_258_/_0.25)] bg-[oklch(1_0_0_/_0.5)] p-3">
        <table className="w-full min-w-[760px] border-collapse" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="bg-[oklch(0.55_0.05_258_/_0.06)] text-xs font-semibold">
              <th className="w-[54px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">序号</th>
              <th className="w-[130px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">评分因素</th>
              <th className="w-[76px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">分值</th>
              <th className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">评分标准</th>
              <th className="w-[150px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">说明</th>
              <th className="w-[64px] border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {value.map((item, i) => (
              <tr key={item.id}>
                <td className="border border-[rgba(200,210,230,0.6)] px-2 py-1.5 text-center text-sm tabular-nums">{i + 1}</td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1">
                  <input className={inputCls} value={item.factor} placeholder="如：价格部分" onChange={(e) => update(item.id, { factor: e.target.value })} />
                </td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1">
                  <input className={`${inputCls} text-center`} value={item.score} placeholder="如：30" onChange={(e) => update(item.id, { score: e.target.value })} />
                </td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1">
                  <textarea className={`${inputCls} min-h-[64px] resize-y leading-relaxed`} value={item.criteria} placeholder="打分规则与计算公式" onChange={(e) => update(item.id, { criteria: e.target.value })} />
                </td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1">
                  <textarea className={`${inputCls} min-h-[64px] resize-y`} value={item.note} placeholder="评审依据/证明材料，无则 /" onChange={(e) => update(item.id, { note: e.target.value })} />
                </td>
                <td className="border border-[rgba(200,210,230,0.6)] p-1">
                  <div className="flex flex-col items-center gap-0.5">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)] disabled:opacity-30" title="上移"><ArrowUp size={13} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)] disabled:opacity-30" title="下移"><ArrowDown size={13} /></button>
                    <button type="button" onClick={() => onChange(value.filter((x) => x.id !== item.id))} className="rounded p-1 text-[color:var(--muted-foreground)] hover:bg-[oklch(1_0_0_/_0.4)]" title="删除行"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {value.length === 0 && (
              <tr>
                <td colSpan={6} className="border border-[rgba(200,210,230,0.6)] px-2 py-6 text-center text-sm text-[color:var(--muted-foreground)]">
                  暂无评分因素，点击右上「添加评分因素」或「AI 生成」
                </td>
              </tr>
            )}
            <tr className="bg-[oklch(0.55_0.05_258_/_0.04)] font-semibold">
              <td colSpan={2} className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center text-sm">合计</td>
              <td className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-center text-sm tabular-nums">{total ?? "—"}</td>
              <td colSpan={3} className="border border-[rgba(200,210,230,0.6)] px-2 py-2 text-xs">
                {total !== null && !totalValid ? (
                  <span className="text-[rgba(178,124,42,1)]">提示：分值合计应为 100，当前 {total}</span>
                ) : null}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
