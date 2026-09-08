"use client";

/**
 * W3（API-only 盲区收口，2026-09-08）：价格与评标办法配置卡。
 * 写径 PATCH /bid/projects/:id/price-config（后端语义：undefined=不更新，无阶段闸——本卡如实不加锁，
 * EVALUATING+ 给软提示）。载荷来源 BidProjectDetail（include 全标量）。
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { updatePriceConfig, type BidProjectDetail } from "@/lib/api/bid";

const EVAL_METHOD_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "comprehensive", label: "综合评估法", hint: "资格+符合性+商务+技术+价格" },
  { value: "lowest_price", label: "最低价法", hint: "询比/竞价——价格为主" },
  { value: "qualified_lowest_price", label: "合格最低价法", hint: "谈判采购——合格中最低价" },
  { value: "none", label: "不评分", hint: "直接采购——无竞争性评分" },
];

type PriceConfigSource = Pick<BidProjectDetail, 'id' | 'stage'> & Partial<Pick<BidProjectDetail, 'ceilingPrice' | 'evaluationMethod' | 'priceFormulaConfig'>>;

export function PriceConfigCard({ detail, onChanged }: { detail: PriceConfigSource | null; onChanged: () => void }) {
  const [ceilingPrice, setCeilingPrice] = useState("");
  const [evaluationMethod, setEvaluationMethod] = useState("");
  const [formulaRaw, setFormulaRaw] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 载荷就位/变更时回显（string 化避免受控警告；formula 序列化保持键序稳定）
  const formulaCanonical = useMemo(
    () => (detail?.priceFormulaConfig && Object.keys(detail.priceFormulaConfig).length > 0
      ? JSON.stringify(detail.priceFormulaConfig, null, 2)
      : ""),
    [detail?.priceFormulaConfig],
  );
  useEffect(() => {
    setCeilingPrice(detail?.ceilingPrice != null ? String(detail.ceilingPrice) : "");
    setEvaluationMethod(detail?.evaluationMethod ?? "");
    setFormulaRaw(formulaCanonical);
  }, [detail?.id, formulaCanonical]);

  const stage = detail?.stage;
  const softLocked = stage === "EVALUATING" || stage === "ARCHIVED";

  async function save() {
    if (!detail) return;
    const data: { ceilingPrice?: number; evaluationMethod?: string; priceFormulaConfig?: Record<string, unknown> } = {};
    const cp = ceilingPrice.trim();
    if (cp !== (detail.ceilingPrice != null ? String(detail.ceilingPrice) : "")) {
      if (cp === "") { toast.error("清空最高限价请填 0 或联系管理员（后端未定义清除语义）"); return; }
      const n = Number(cp);
      if (!isFinite(n) || n < 0) { toast.error("最高限价须为非负数字"); return; }
      data.ceilingPrice = n;
    }
    if (evaluationMethod !== (detail.evaluationMethod ?? "")) data.evaluationMethod = evaluationMethod;
    const fr = formulaRaw.trim();
    if (fr !== formulaCanonical.trim()) {
      let parsed: Record<string, unknown>;
      try { parsed = fr === "" ? {} : JSON.parse(fr); } catch (e) { toast.error(`公式参数不是合法 JSON：${(e as Error).message}`); return; }
      data.priceFormulaConfig = parsed;
    }
    if (Object.keys(data).length === 0) { toast.info("没有需要保存的修改"); return; }
    setSaving(true);
    try {
      await updatePriceConfig(detail.id, data);
      toast.success("价格与评标办法已保存");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {softLocked && (
        <div className="rounded-lg border border-[color-mix(in_oklch,var(--warning)_38%,transparent)] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
          项目已进入评标/归档阶段——修改评标办法或公式会影响后续评分口径，请谨慎操作。
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-[var(--muted-foreground)]">
          最高限价 / 控制价（元）
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={ceilingPrice} onChange={(e) => setCeilingPrice(e.target.value)}
            placeholder="未设置"
            className="workbench-input mt-1 w-full !text-[13px] tabular-nums"
          />
        </label>
        <label className="block text-xs text-[var(--muted-foreground)]">
          评标办法
          <select
            value={evaluationMethod} onChange={(e) => setEvaluationMethod(e.target.value)}
            className="workbench-input mt-1 w-full !text-[13px]"
          >
            <option value="">未设置（按采购方式默认）</option>
            {EVAL_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}（{o.hint}）</option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <button type="button" className="neu-btn-xs" onClick={() => setAdvancedOpen((v) => !v)}>
          {advancedOpen ? "收起" : "展开"}价格分公式参数（高级）
        </button>
        {advancedOpen && (
          <textarea
            value={formulaRaw} onChange={(e) => setFormulaRaw(e.target.value)}
            rows={6} spellCheck={false}
            placeholder='{"benchmarkMode":"average","lowPriceRatio":0.7}（留空=使用内置默认公式）'
            className="workbench-input mt-2 w-full font-mono !text-[12px] leading-relaxed"
          />
        )}
      </div>
      <div className="flex justify-end">
        <button type="button" className="neu-btn" disabled={saving || !detail} onClick={save}>
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>
    </div>
  );
}
