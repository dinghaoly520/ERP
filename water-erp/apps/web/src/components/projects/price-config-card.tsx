"use client";

/**
 * W3（API-only 盲区收口，2026-09-08）：价格与评标办法配置。
 * 2026-09-10 与「评分标准编制」合并为一卡（评分标准与评标办法）后，本文件拆为两个子区块组件——
 *   EvaluationBasisFields  评标办法+最高限价（合并卡顶部「评标口径」行）
 *   PriceFormulaFields     价格分公式参数（合并卡底部「高级」区，作用于「价格」类评分项）
 * 两者共用写径 PATCH /bid/projects/:id/price-config（后端语义：undefined=不更新；P2-17 起
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

/** 评标办法对评分标准编制的影响提示（comprehensive/未设置不提示） */
const EVAL_METHOD_NOTES: Record<string, string> = {
  lowest_price: "当前评标办法为最低价法——价格分为主要评标依据（由下方价格分公式计算），其余类别评分项酌情编制。",
  qualified_lowest_price: "当前评标办法为合格最低价法——合格性审查通过后按价格排序。",
  none: "当前评标办法为不评分——本项目无竞争性评分，可跳过评分标准编制。",
};

const LOCKED_NOTICE =
  "项目已进入评标/归档阶段——评标办法、最高限价与价格分公式已锁定（评标口径确定性）。如需更正请按法定程序办理。";

type PriceConfigSource = Pick<BidProjectDetail, 'id' | 'stage'> & Partial<Pick<BidProjectDetail, 'ceilingPrice' | 'evaluationMethod' | 'priceFormulaConfig'>>;

/** P2-17（二轮审查收尾）：后端 409 PRICE_CONFIG_LOCKED 如实前置——评标/归档阶段输入禁用（评标口径确定性） */
const softLockedOf = (stage?: string) => stage === "EVALUATING" || stage === "ARCHIVED";

export function EvaluationBasisFields({ detail, onChanged }: { detail: PriceConfigSource | null; onChanged: () => void }) {
  const [ceilingPrice, setCeilingPrice] = useState("");
  const [evaluationMethod, setEvaluationMethod] = useState("");
  const [saving, setSaving] = useState(false);

  // 载荷就位/变更时回显（string 化避免受控警告）
  /* eslint-disable react-hooks/set-state-in-effect -- 载荷回显：detail 变更时同步表单初值，符合受控表单惯例 */
  useEffect(() => {
    setCeilingPrice(detail?.ceilingPrice != null ? String(detail.ceilingPrice) : "");
    setEvaluationMethod(detail?.evaluationMethod ?? "");
  }, [detail?.id, detail?.ceilingPrice, detail?.evaluationMethod]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const softLocked = softLockedOf(detail?.stage);
  // P1-A：脏检查——与唱标字段配置卡口径一致（无修改时禁用而非点击后提示）
  const dirty = useMemo(() => (
    ceilingPrice.trim() !== (detail?.ceilingPrice != null ? String(detail.ceilingPrice) : "")
    || evaluationMethod !== (detail?.evaluationMethod ?? "")
  ), [ceilingPrice, evaluationMethod, detail?.ceilingPrice, detail?.evaluationMethod]);

  async function save() {
    if (!detail) return;
    const data: { ceilingPrice?: number; evaluationMethod?: string } = {};
    const cp = ceilingPrice.trim();
    if (cp !== (detail.ceilingPrice != null ? String(detail.ceilingPrice) : "")) {
      if (cp === "") { toast.error("清空最高限价请填 0 或联系管理员（后端未定义清除语义）"); return; }
      const n = Number(cp);
      if (!isFinite(n) || n < 0) { toast.error("最高限价须为非负数字"); return; }
      data.ceilingPrice = n;
    }
    if (evaluationMethod !== (detail.evaluationMethod ?? "")) data.evaluationMethod = evaluationMethod;
    if (Object.keys(data).length === 0) { toast.info("没有需要保存的修改"); return; }
    setSaving(true);
    try {
      await updatePriceConfig(detail.id, data);
      toast.success("评标办法与最高限价已保存");
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
          <Lock size={13} /> {LOCKED_NOTICE}
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
      {!softLocked && EVAL_METHOD_NOTES[evaluationMethod] && (
        <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          {EVAL_METHOD_NOTES[evaluationMethod]}
        </p>
      )}
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

export function PriceFormulaFields({ detail, onChanged }: { detail: PriceConfigSource | null; onChanged: () => void }) {
  const [formulaRaw, setFormulaRaw] = useState("");
  const [saving, setSaving] = useState(false);

  // 载荷就位/变更时回显（formula 序列化保持键序稳定）
  const formulaCanonical = useMemo(
    () => (detail?.priceFormulaConfig && Object.keys(detail.priceFormulaConfig).length > 0
      ? JSON.stringify(detail.priceFormulaConfig, null, 2)
      : ""),
    [detail?.priceFormulaConfig],
  );
  /* eslint-disable react-hooks/set-state-in-effect -- 载荷回显：formula 变更时同步表单初值，符合受控表单惯例 */
  useEffect(() => {
    setFormulaRaw(formulaCanonical);
  }, [detail?.id, formulaCanonical]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const softLocked = softLockedOf(detail?.stage);
  // P1-A：脏检查——无修改时禁用而非点击后提示
  const dirty = useMemo(() => formulaRaw.trim() !== formulaCanonical.trim(), [formulaRaw, formulaCanonical]);

  async function save() {
    if (!detail) return;
    const fr = formulaRaw.trim();
    if (fr === formulaCanonical.trim()) { toast.info("没有需要保存的修改"); return; }
    let parsed: Record<string, unknown>;
    try { parsed = fr === "" ? {} : JSON.parse(fr); } catch (e) { toast.error(`公式参数不是合法 JSON：${(e as Error).message}`); return; }
    setSaving(true);
    try {
      await updatePriceConfig(detail.id, { priceFormulaConfig: parsed });
      toast.success("价格分公式参数已保存");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={formulaRaw} onChange={(e) => setFormulaRaw(e.target.value)}
        rows={6} spellCheck={false} disabled={softLocked}
        placeholder='{"formulaType":"benchmark_deviation","K":0.97,"penaltyRate":2}（留空=使用内置默认公式）'
        className="workbench-input w-full font-mono !text-[12px] leading-relaxed"
      />
      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        作用于评分标准中「价格」类评分项。可用键：formulaType（lowest_price 最低评标价法|benchmark_deviation 基准价偏离法|ratio 比例法）、K（基准价偏离法折扣系数，默认 0.97）、penaltyRate（每 1% 偏离扣分比例，默认 2）、noPenaltyRange（无惩罚区间百分比，默认 0）。留空 = 内置默认公式。
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          className="neu-btn-primary !h-[34px] !text-xs"
          disabled={saving || !detail || !dirty || softLocked}
          title={softLocked ? '评标/归档阶段配置已锁定' : !dirty ? '无修改' : undefined}
          onClick={save}
        >
          {saving ? "保存中…" : "保存公式"}
        </button>
      </div>
    </div>
  );
}
