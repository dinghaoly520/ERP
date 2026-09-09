"use client";

/**
 * W3（API-only 盲区收口，2026-09-08）：价格与评标办法配置卡。
 * 写径 PATCH /bid/projects/:id/price-config（后端语义：undefined=不更新；P2-17 起
 * EVALUATING/ARCHIVED 后端 409 PRICE_CONFIG_LOCKED——本卡锁定态如实前置，输入禁用+锁定文案）。
 * 载荷来源 BidProjectDetail（include 全标量）。
 */
import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
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
  // P1-A：脏检查——与唱标字段配置卡口径一致（无修改时禁用而非点击后提示）
  const dirty = useMemo(() => (
    ceilingPrice.trim() !== (detail?.ceilingPrice != null ? String(detail.ceilingPrice) : "")
    || evaluationMethod !== (detail?.evaluationMethod ?? "")
    || formulaRaw.trim() !== formulaCanonical.trim()
  ), [ceilingPrice, evaluationMethod, formulaRaw, detail?.ceilingPrice, detail?.evaluationMethod, formulaCanonical]);
  // P2-17（二轮审查收尾）：后端 409 PRICE_CONFIG_LOCKED 如实前置——评标/归档阶段输入禁用（评标口径确定性）
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
        <div className="wb-alert wb-alert--warning flex items-center gap-2 text-xs">
          <Lock size={13} /> 项目已进入评标/归档阶段——价格与评标办法配置已锁定（评标口径确定性）。如需更正请按法定程序办理。
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-[var(--muted-foreground)]">
          最高限价 / 控制价（元）
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={ceilingPrice} onChange={(e) => setCeilingPrice(e.target.value)}
            placeholder="未设置" disabled={softLocked}
            className="workbench-input mt-1 w-full !text-[13px] tabular-nums"
          />
        </label>
        <label className="block text-xs text-[var(--muted-foreground)]">
          评标办法
          <select
            value={evaluationMethod} onChange={(e) => setEvaluationMethod(e.target.value)}
            disabled={softLocked}
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
          <>
            <textarea
              value={formulaRaw} onChange={(e) => setFormulaRaw(e.target.value)}
              rows={6} spellCheck={false} disabled={softLocked}
              placeholder='{"formulaType":"benchmark_deviation","K":0.97,"penaltyRate":2}（留空=使用内置默认公式）'
              className="workbench-input mt-2 w-full font-mono !text-[12px] leading-relaxed"
            />
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
              可用键：formulaType（lowest_price 最低评标价法|benchmark_deviation 基准价偏离法|ratio 比例法）、K（基准价偏离法折扣系数，默认 0.97）、penaltyRate（每 1% 偏离扣分比例，默认 2）、noPenaltyRange（无惩罚区间百分比，默认 0）。留空 = 内置默认公式。
            </p>
          </>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="neu-btn-primary !h-[34px] !text-xs"
          disabled={saving || !detail || !dirty || softLocked}
          title={softLocked ? '评标/归档阶段配置已锁定' : !dirty ? '无修改' : undefined}
          onClick={save}
        >
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>
    </div>
  );
}
