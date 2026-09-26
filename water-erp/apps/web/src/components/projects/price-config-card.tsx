"use client";

/**
 * W3（API-only 盲区收口，2026-09-08）：价格与评标办法配置。
 * 2026-09-10 与「评分标准编制」合并为一卡（评分标准与评标办法）。
 * 2026-09-26 价格分公式表单化并入本块（原独立「价格分公式参数（高级）」裸 JSON textarea 子块撤销）：
 *   - 公式下拉 4 项（三公式 + 专家手填），随评标办法联动带出默认；参数数字输入、空=引擎默认
 *   - 修复语义陷阱：留空保存曾得 {}（truthy）→ 引擎静默回退最低评标价法；现「专家手填」显式保存 null
 *   - 后端 updatePriceConfig 同步加值校验（PRICE_FORMULA_INVALID / PRICE_CONFIG_INVALID）
 * 写径共用 PATCH /bid/projects/:id/price-config（undefined=不更新；EVALUATING/ARCHIVED 后端 409
 * PRICE_CONFIG_LOCKED——锁定态如实前置：输入禁用+锁定文案）。载荷来源 BidProjectDetail。
 */
import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { updatePriceConfig, type BidProjectDetail } from "@/lib/api/bid";

const EVAL_METHOD_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "comprehensive", label: "综合评估法", hint: "资格+符合性+商务+技术+价格" },
  { value: "lowest_price", label: "最低价法", hint: "询比/竞价——价格为主" },
  { value: "qualified_lowest_price", label: "合格最低价法", hint: "谈判采购——合格中最低价" },
  { value: "manual", label: "专家评审", hint: "评标委员会依据评分标准逐项手填打分" },
  { value: "none", label: "不评分", hint: "直接采购——无竞争性评分" },
];

/** 采购方式 → 默认评标办法（镜像自 apps/api/src/bid/evaluation-method.config.ts
 *  PROCUREMENT_EVALUATION_MAP + FALLBACK——web 不可跨包 import，改映射须两侧同步）。
 *  evaluationMethod 为 null（罕见历史/直建）时按此推导实际生效办法——回显=实际口径 */
const PROCUREMENT_EVAL_DEFAULT: Record<string, string> = {
  // 2026-09-26 默认改定：竞争性方式默认 manual（专家评审）；谈判/直接采购族为固有属性维持原值
  '邀请招标': 'manual', '询比采购': 'manual', '谈判采购': 'qualified_lowest_price',
  '竞价采购': 'manual', '直接采购': 'none',
  '公开招标': 'manual', '直接委托': 'none', '续约': 'none', '直接签订合同': 'none',
};
const deriveEvalMethod = (procurementMethod?: string | null) =>
  PROCUREMENT_EVAL_DEFAULT[procurementMethod ?? ''] ?? 'manual';

/** 评标办法对评分标准编制的影响提示（comprehensive/未设置不提示） */
const EVAL_METHOD_NOTES: Record<string, string> = {
  lowest_price: "当前评标办法为最低价法——价格分为主要评标依据（由价格分计算方式自动计算），其余类别评分项酌情编制。",
  qualified_lowest_price: "当前评标办法为合格最低价法——价格不作评分项（多轮报价、合格中最低价定标）。",
  manual: "当前评标办法为专家评审——评标委员会依据下方评分标准逐项打分；价格分不按公式自动计算（可在价格分计算方式中调整）。",
  none: "当前评标办法为不评分——本项目无竞争性评分，可跳过评分标准编制。",
};

/** 价格分计算方式（镜像自 apps/api/src/bid/price-formula.service.ts PRICE_FORMULA_OPTIONS——
 *  web 不可跨包 import，改公式语义须两侧同步）；manual=专家手填（保存 priceFormulaConfig=null） */
const PRICE_CALC_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "benchmark_deviation", label: "基准价偏离法", hint: "基准价=限价×K，双向偏离线性扣分（防高价也防恶意低价）" },
  { value: "lowest_price", label: "最低评标价法", hint: "最低有效报价=满分，其余按最低报价÷该报价×满分折算" },
  { value: "ratio", label: "比例法", hint: "限价÷报价×满分，报价越低分越高（不惩罚异常低价）" },
  { value: "manual", label: "专家手填", hint: "停用自动计算——价格分由专家在打分时手工填写" },
];

/** 评标办法 → 推荐价格分公式（与建项默认 buildEvaluationDefaults 同口径）；
 *  办法值变化时无条件重置为推荐项并提示（改办法本就该重审公式） */
const EVAL_METHOD_FORMULA_DEFAULT: Record<string, string> = {
  comprehensive: "benchmark_deviation",
  lowest_price: "lowest_price",
  manual: "manual",
};

/** 这些办法下价格不作评分项 → 公式区隐藏、保存自动清除遗留配置 */
const FORMULA_HIDDEN_METHODS = new Set(["qualified_lowest_price", "none"]);

const LEGAL_FORMULA_TYPES = ["lowest_price", "benchmark_deviation", "ratio"];

const LOCKED_NOTICE =
  "项目已进入评标/归档阶段——评标办法、最高限价与价格分公式已锁定（评标口径确定性）。如需更正请按法定程序办理。";

type PriceConfigSource = Pick<BidProjectDetail, 'id' | 'stage'> & Partial<Pick<BidProjectDetail, 'ceilingPrice' | 'evaluationMethod' | 'priceFormulaConfig' | 'procurementMethod' | 'scoreTrimEnabled'>>;

/** P2-17：后端 409 PRICE_CONFIG_LOCKED 如实前置——评标/归档阶段输入禁用（评标口径确定性） */
const softLockedOf = (stage?: string) => stage === "EVALUATING" || stage === "ARCHIVED";

/** 回显口径=引擎实际行为：config null→manual；formulaType 缺失/非法（含历史 {}）→ lowest_price
 *  （price-formula.service default 分支的真实回退），保存时写规范形态顺带治理脏数据 */
function resolveFormulaCalc(cfg: Record<string, unknown> | null | undefined): string {
  if (cfg == null) return "manual";
  const t = (cfg as Record<string, unknown>).formulaType;
  return LEGAL_FORMULA_TYPES.includes(t as string) ? (t as string) : "lowest_price";
}

/** 参数数值校验（与后端 updatePriceConfig 同区间；空=引擎默认不校验） */
function validateParams(k: string, penaltyRate: string, noPenaltyRange: string): string | null {
  if (k.trim() !== "") {
    const n = Number(k);
    if (!isFinite(n) || n <= 0 || n > 1) return "K 折扣系数须满足 0 < K ≤ 1";
  }
  if (penaltyRate.trim() !== "") {
    const n = Number(penaltyRate);
    if (!isFinite(n) || n <= 0) return "每 1% 偏离扣分须为正数";
  }
  if (noPenaltyRange.trim() !== "") {
    const n = Number(noPenaltyRange);
    if (!isFinite(n) || n < 0) return "无惩罚区间须为非负数";
  }
  return null;
}

export function EvaluationBasisFields({
  detail, onChanged, priceItemCount,
}: { detail: PriceConfigSource | null; onChanged: () => void; priceItemCount?: number }) {
  const [ceilingPrice, setCeilingPrice] = useState("");
  const [evaluationMethod, setEvaluationMethod] = useState("");
  const [formulaCalc, setFormulaCalc] = useState("manual");
  const [scoreTrim, setScoreTrim] = useState(true);
  const [paramK, setParamK] = useState("");
  const [paramPenalty, setParamPenalty] = useState("");
  const [paramRange, setParamRange] = useState("");
  const [saving, setSaving] = useState(false);

  const cfg = detail?.priceFormulaConfig;
  const cfgObj = cfg != null && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : null;

  // 载荷就位/变更时回显（string 化避免受控警告；公式回显=引擎实际生效口径）
  /* eslint-disable react-hooks/set-state-in-effect -- 载荷回显：detail 变更时同步表单初值，符合受控表单惯例 */
  useEffect(() => {
    setCeilingPrice(detail?.ceilingPrice != null ? String(detail.ceilingPrice) : "");
    // 回显=实际生效口径：null（罕见）按采购方式推导，不再提供「未设置」空选项（曾致用户
    // 误解为专家手动打分）；保存即落显式值，顺带规范化数据
    setEvaluationMethod(detail?.evaluationMethod ?? deriveEvalMethod(detail?.procurementMethod));
    setFormulaCalc(resolveFormulaCalc(detail?.priceFormulaConfig));
    setScoreTrim(detail?.scoreTrimEnabled ?? true);
    setParamK(cfgObj?.K != null ? String(cfgObj.K) : "");
    setParamPenalty(cfgObj?.penaltyRate != null ? String(cfgObj.penaltyRate) : "");
    setParamRange(cfgObj?.noPenaltyRange != null ? String(cfgObj.noPenaltyRange) : "");
  }, [detail?.id, detail?.ceilingPrice, detail?.evaluationMethod, detail?.priceFormulaConfig]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const softLocked = softLockedOf(detail?.stage);
  const formulaVisible = evaluationMethod !== "" && !FORMULA_HIDDEN_METHODS.has(evaluationMethod);

  // 当前表单的规范 config 形态（供 dirty 对比与保存复用；显式填写的参数才入 config）
  const formulaPayload = useMemo((): Record<string, unknown> | null => {
    if (formulaCalc === "manual") return null;
    const out: Record<string, unknown> = { formulaType: formulaCalc };
    if (paramK.trim() !== "") out.K = Number(paramK);
    if (paramPenalty.trim() !== "") out.penaltyRate = Number(paramPenalty);
    if (paramRange.trim() !== "") out.noPenaltyRange = Number(paramRange);
    return out;
  }, [formulaCalc, paramK, paramPenalty, paramRange]);

  // detail 当前值的规范形态（回显口径：manual→null；formulaType 显式参数键才入——与 formulaPayload 同构可比）
  const currentFormulaPayload = useMemo((): Record<string, unknown> | null => {
    const t = resolveFormulaCalc(detail?.priceFormulaConfig);
    if (t === "manual") return null;
    const out: Record<string, unknown> = { formulaType: t };
    if (cfgObj?.K != null) out.K = cfgObj.K;
    if (cfgObj?.penaltyRate != null) out.penaltyRate = cfgObj.penaltyRate;
    if (cfgObj?.noPenaltyRange != null) out.noPenaltyRange = cfgObj.noPenaltyRange;
    return out;
  }, [detail?.priceFormulaConfig]);

  // 谈判/不评分：公式区隐藏但存量配置非空 → 保存需自动清除（隐式脏项，按钮须亮起）
  const implicitClear = !formulaVisible && detail?.priceFormulaConfig != null;

  const formulaDirty = formulaVisible && JSON.stringify(formulaPayload) !== JSON.stringify(currentFormulaPayload);

  const initialEvalMethod = detail?.evaluationMethod ?? deriveEvalMethod(detail?.procurementMethod);
  const evalMethodDirty = evaluationMethod !== initialEvalMethod;
  const trimDirty = scoreTrim !== (detail?.scoreTrimEnabled ?? true);
  const dirty = useMemo(() => (
    ceilingPrice.trim() !== (detail?.ceilingPrice != null ? String(detail.ceilingPrice) : "")
    || evalMethodDirty
    || formulaDirty
    || implicitClear
    || trimDirty
  ), [ceilingPrice, evalMethodDirty, formulaDirty, implicitClear, trimDirty, detail?.ceilingPrice]);

  // 办法切换联动：无条件重置公式为该办法推荐项（行为可预期，不跟踪"是否定制过"）
  function onMethodChange(v: string) {
    setEvaluationMethod(v);
    const recommended = EVAL_METHOD_FORMULA_DEFAULT[v];
    if (recommended && formulaCalc !== recommended) {
      setFormulaCalc(recommended);
      toast.info(`价格分计算方式已随评标办法调整为「${PRICE_CALC_OPTIONS.find(o => o.value === recommended)?.label}」，可按需修改`);
    }
  }

  async function save() {
    if (!detail) return;
    const data: { ceilingPrice?: number; evaluationMethod?: string; priceFormulaConfig?: Record<string, unknown> | null; scoreTrimEnabled?: boolean } = {};
    const cp = ceilingPrice.trim();
    if (cp !== (detail.ceilingPrice != null ? String(detail.ceilingPrice) : "")) {
      if (cp === "") { toast.error("清空最高限价请填 0 或联系管理员（后端未定义清除语义）"); return; }
      const n = Number(cp);
      if (!isFinite(n) || n < 0) { toast.error("最高限价须为非负数字"); return; }
      data.ceilingPrice = n;
    }
    if (evalMethodDirty) data.evaluationMethod = evaluationMethod;
    if (trimDirty) data.scoreTrimEnabled = scoreTrim;
    if (implicitClear) data.priceFormulaConfig = null;
    else if (formulaDirty) {
      const err = validateParams(paramK, paramPenalty, paramRange);
      if (err) { toast.error(err); return; }
      data.priceFormulaConfig = formulaPayload;
    }
    if (Object.keys(data).length === 0) { toast.info("没有需要保存的修改"); return; }
    setSaving(true);
    try {
      await updatePriceConfig(detail.id, data);
      toast.success("评标办法与价格分配置已保存");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const ceilingMissingForFormula =
    (formulaCalc === "benchmark_deviation" || formulaCalc === "ratio")
    && ceilingPrice.trim() === "";

  return (
    <div className="space-y-3">
      {softLocked && (
        <div className="wb-alert wb-alert--warning flex items-center gap-2 text-xs">
          <Lock size={13} /> {LOCKED_NOTICE}
        </div>
      )}
      {/* 三项主控件一行三列等宽（2026-09-26 用户裁定：限价/办法/公式同层级排列清晰） */}
      <div className={`grid gap-3 sm:grid-cols-2 ${formulaVisible ? 'xl:grid-cols-3' : ''}`}>
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
            value={evaluationMethod} onChange={(e) => onMethodChange(e.target.value)}
            disabled={softLocked}
            className="workbench-input mt-1 w-full !text-[13px]"
          >
            {EVAL_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}（{o.hint}）</option>
            ))}
          </select>
        </label>
        {formulaVisible && (
          <label className="block text-xs text-[var(--muted-foreground)]">
            价格分计算方式
            <select
              value={formulaCalc} onChange={(e) => setFormulaCalc(e.target.value)}
              disabled={softLocked}
              className="workbench-input mt-1 w-full !text-[13px]"
            >
              {PRICE_CALC_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}（{o.hint}）</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {formulaVisible && (
        <>
          {formulaCalc === "benchmark_deviation" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-[var(--muted-foreground)]">
                K 折扣系数
                <input type="number" min="0.01" max="1" step="0.01" inputMode="decimal"
                  value={paramK} onChange={(e) => setParamK(e.target.value)}
                  placeholder="默认 0.97" disabled={softLocked}
                  className="workbench-input mt-1 w-full !text-[13px] tabular-nums" />
              </label>
              <label className="block text-xs text-[var(--muted-foreground)]">
                每 1% 偏离扣分
                <input type="number" min="0.1" step="0.1" inputMode="decimal"
                  value={paramPenalty} onChange={(e) => setParamPenalty(e.target.value)}
                  placeholder="默认 2" disabled={softLocked}
                  className="workbench-input mt-1 w-full !text-[13px] tabular-nums" />
              </label>
              <label className="block text-xs text-[var(--muted-foreground)]">
                无惩罚区间（%）
                <input type="number" min="0" step="0.5" inputMode="decimal"
                  value={paramRange} onChange={(e) => setParamRange(e.target.value)}
                  placeholder="默认 0" disabled={softLocked}
                  className="workbench-input mt-1 w-full !text-[13px] tabular-nums" />
              </label>
            </div>
          )}
          {!softLocked && PRICE_CALC_OPTIONS.find(o => o.value === formulaCalc)?.hint && formulaCalc !== "manual" && (
            <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              {PRICE_CALC_OPTIONS.find(o => o.value === formulaCalc)?.hint}
            </p>
          )}
        </>
      )}
      <label className={`flex items-center gap-2.5 ${softLocked ? 'opacity-60' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={scoreTrim}
          onChange={(e) => setScoreTrim(e.target.checked)}
          disabled={softLocked}
          className="neu-checkbox shrink-0"
        />
        {/* 单行标题 + ？hover 气泡（2026-09-26 定稿：说明移入气泡，标题行 20px=选择框高精确居中） */}
        <span className="flex items-center gap-1.5 text-xs font-semibold leading-5 text-[var(--foreground)]">
          评分去极值
          <span className="pm-help-anchor" tabIndex={0}>
            <span className="pm-help-dot" aria-label="评分去极值说明" role="img">？</span>
            <span className="pm-help-tip" role="tooltip">
              ≥5 位专家时去掉 1 个最高分、1 个最低分后取平均（评标实务惯例）；关闭后全额均分
            </span>
          </span>
        </span>
      </label>
      {!softLocked && !evalMethodDirty && detail?.evaluationMethod == null && (
        <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          未显式设置——当前按采购方式默认执行「{EVAL_METHOD_OPTIONS.find(o => o.value === evaluationMethod)?.label}」，保存后落为显式值。
        </p>
      )}
      {!softLocked && EVAL_METHOD_NOTES[evaluationMethod] && (
        <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          {EVAL_METHOD_NOTES[evaluationMethod]}
        </p>
      )}
      {!softLocked && ceilingMissingForFormula && (
        <div className="wb-alert wb-alert--warning flex items-center gap-2 text-[11px]">
          <Lock size={12} /> 当前公式以最高限价为基准，但限价未设置——生成评标结果前须填写，否则将被拦截。
        </div>
      )}
      {!softLocked && formulaVisible && priceItemCount === 0 && (
        <p className="text-[11px] leading-relaxed text-[color-mix(in_oklch,var(--warning)_82%,var(--foreground))]">
          当前评分项中暂无「价格」类项——价格分公式暂不参与计分（如需公式计分，请在下方评分项中添加价格类项）。
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
