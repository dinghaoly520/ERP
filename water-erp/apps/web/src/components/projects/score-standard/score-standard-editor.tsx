'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { CATEGORY_COLOR, CATEGORY_LABEL, STAGE_LABEL, isPassFailCategory } from '@water-erp/shared';
import {
  batchCreateScorePoints,
  updatePriceConfig,
  createScoreItem,
  deleteScoreItem,
  ensureBidProject,
  extractAllScorePoints,
  getBidProjectDetail,
  listScoreItems,
  publishScoreStandard,
  updateScoreItem,
  type BidProjectRef,
  type BidScoreItem,
  type ScoreCategory,
} from '@/lib/api/bid';
import type { ProjectManagementAttachment, ProjectManagementItem } from '@/lib/types/project-management';
import { Modal, TableSkeleton } from '@/components/workbench';
import { ScorePointsEditor } from './score-points-editor';
import { PRICE_CALC_OPTIONS, resolveFormulaCalc } from '../price-config-card';
import { SaveTemplateDialog } from './save-template-dialog';
import { TemplateLibraryDialog } from './template-library-dialog';
import { BulkExtractReviewDialog, type EditableGroup } from './bulk-extract-review-dialog';
import { ExtractSourcePickerDialog } from './extract-source-picker-dialog';

const CATEGORY_OPTIONS: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
const inputCls = 'workbench-input';
// N10：与后端 ScoreStandardValidator SCORE_ITEM_ZERO_MAX 文案一致
const ZERO_MAX_SCORE_MSG = (name: string) => `评分项「${name}」为打分类但满分为 0，请删除或设置满分`;

type Props = {
  project: ProjectManagementItem;
  round?: number;
  bidProject?: BidProjectRef | null;
  onChanged?: () => void;
  variant?: 'standalone' | 'embedded';
  /** 价格分公式配置（2026-09-28：卡级 detail 下发——评标口径保存后面板重拉，编辑器据此
   *  刷新价格项提示；undefined=standalone 等无 detail 场景，退回自加载值） */
  priceFormulaConfig?: Record<string, unknown> | null;
  /** 提取源（2026-09-26 双入口分流）：
   *  - 显式对象 = 03 完成向导 Step2：固定提取正式盖章版采购文件（OCR，isOfficial=true）
   *  - undefined = 「评分标准」按钮面板：自动——唯一文件直用；多文件弹选择器由用户指定，
   *    选过一次后面板内后续提取（含逐项）沿用同一源 */
  extractSource?: { attachmentId: string; fileName: string; isOfficial?: boolean } | null;
  /** 该轮「采购文件」步骤附件（extractSource 未定时作提取源候选） */
  tenderCandidates?: ProjectManagementAttachment[];
};

export function ScoreStandardEditor({ project, round, bidProject, onChanged, variant = 'standalone', extractSource, tenderCandidates, priceFormulaConfig }: Props) {
  const [bpId, setBpId] = useState<string | null>(bidProject?.id ?? null);
  const [stage, setStage] = useState('');
  /** 最近一次通过完整性校验的版本时间戳（2026-09-28 用户裁定方案 A：scoreStandardPublishedAt
   *  前端语义重释义为「已校验」——发布动作无任何下游消费/锁定效力，降级为版本校验标记）。 */
  const [validatedAt, setValidatedAt] = useState<string | null>(null);
  /** 价格分计算方式（回显口径与 EvaluationBasisFields 一致：manual=专家手填）——传给
   *  ScorePointsEditor 渲染动态提示（2026-09-28：价格项提示不再写死「按报价公式」） */
  const [priceFormulaCalc, setPriceFormulaCalc] = useState<string>('');
  /* eslint-disable react-hooks/set-state-in-effect -- prop 下发的公式配置随卡级 detail 重拉刷新 */
  useEffect(() => {
    if (priceFormulaConfig !== undefined) setPriceFormulaCalc(resolveFormulaCalc(priceFormulaConfig));
  }, [priceFormulaConfig]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [items, setItems] = useState<BidScoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<{ category: ScoreCategory; name: string; maxScore: number }>({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ category: ScoreCategory; name: string; maxScore: number }>({ category: 'TECHNICAL', name: '', maxScore: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [showLib, setShowLib] = useState(false);
  // A-147：模板维度（保存快照/列表过滤同源）——采购方式取 BidProject 明细，项目类型取 PMI
  const [tplDims, setTplDims] = useState<{ procurementMethod: string; projectCategory: string }>({
    procurementMethod: '',
    projectCategory: '',
  });
  const [bulkGroups, setBulkGroups] = useState<EditableGroup[] | null>(null);
  const [extractingAll, setExtractingAll] = useState(false);
  // 提取源（2026-09-26）：面板内最近一次选定的源（选择器挑过即沿用）；sourceLabel 供审核弹窗标注
  const [pickedSource, setPickedSource] = useState<{ attachmentId: string; fileName: string } | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  // 逐项「AI 提取建议」经选择器取源（2026-09-27 用户裁定：与一键提取同口径）——
  // 选择器由哪个动作唤起 + 挂起的 Promise 落定器（onPick/onClose 各自回调）
  const pickerForRef = useRef<'bulk' | 'item'>('bulk');
  const pendingItemSourceRef = useRef<((s: { attachmentId: string; fileName: string } | null) => void) | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开加载 / 关闭重置，符合模态惯例 */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setShowAdd(false);
    setEditingId(null);
    (async () => {
      try {
        const bp = bidProject ?? (await ensureBidProject(project.id, round));
        const [detail, its] = await Promise.all([getBidProjectDetail(bp.id), listScoreItems(bp.id)]);
        if (cancelled) return;
        setBpId(bp.id);
        setStage(detail.stage);
        setValidatedAt(detail.scoreStandardPublishedAt ?? null);
        setPriceFormulaCalc(resolveFormulaCalc(detail.priceFormulaConfig));
        setTplDims({ procurementMethod: detail.procurementMethod || '', projectCategory: project.procurementCategory || '' });
        setItems(its);
      } catch {
        if (!cancelled) toast.error('评分标准加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按项目/轮次重载；bidProject 仅作首屏捷径（stage 变化时重载以同步锁定态）
  }, [project.id, round, bidProject?.id, bidProject?.stage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 开标（OPENING）后锁定；校验不锁定——通过后开标前仍可修改（修改即作废校验标记，需重新校验）
  const locked = stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED';
  const scoredTotal = useMemo(
    () => items.filter((i) => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0),
    [items],
  );
  // 活合计（P1-1/P1-2，2026-09-28：原摘要条 + 底部合计条合并入工具行；Σ 与得分点完整性
  // 是 SCORE_STANDARD_REQUIRED / 启动评标 G9 硬闸口径，不达标就地显差额/缺项）
  const passFailCount = items.length - items.filter((i) => Number(i.maxScore) > 0).length;
  const sumOk = scoredTotal === 100;
  const sumDiff = 100 - scoredTotal;
  // 得分点未配满（2026-09-28 与后端 POINTS_SUM_BELOW_MAX 同口径）：无得分点，或 ΣfullScore ≠ 项满分
  // （容差 0.05）——差额未分配时有效满分 <100，Σ=100 的表象下校验也必须拦
  const pointsIncomplete = items.filter((i) => {
    if (!(Number(i.maxScore) > 0)) return false;
    const pts = i.points ?? [];
    if (pts.length === 0) return true;
    const s = pts.reduce((acc, p) => acc + Number(p.fullScore), 0);
    return Math.abs(s - Number(i.maxScore)) > 0.05;
  });
  const pointsIncompleteCount = pointsIncomplete.length;
  // 得分点合计（打分类 Σpoints——「有效满分」）：Σ=100 但配不满时，100 只是申报值，
  // 实际可得 = Σpoints（chip 自解释用：100/100 与「未配满」并列不再像矛盾）
  const pointsTotal = useMemo(
    () => items
      .filter((i) => Number(i.maxScore) > 0)
      .reduce((s, i) => s + (i.points ?? []).reduce((a, p) => a + Number(p.fullScore), 0), 0),
    [items],
  );
  const gateWarnText = !sumOk
    ? (sumDiff > 0 ? `差 ${sumDiff} 分` : `超 ${-sumDiff} 分`)
    : pointsIncompleteCount > 0
      ? `得分点合计 ${pointsTotal}/100（${pointsIncompleteCount} 项未配满）`
      : null;

  // 得分点增删改后刷新 items（含 points 字段）+ 同步阶段/校验态（修改会作废已校验状态）并通知父组件
  const reloadItems = useCallback(async () => {
    if (!bpId) return;
    try {
      const [refreshed, detail] = await Promise.all([listScoreItems(bpId), getBidProjectDetail(bpId)]);
      setItems(refreshed);
      setStage(detail.stage);
      setValidatedAt(detail.scoreStandardPublishedAt ?? null);
      setPriceFormulaCalc(resolveFormulaCalc(detail.priceFormulaConfig));
    } catch {
      /* 保留旧数据 */
    }
    onChanged?.();
  }, [bpId, onChanged]);

  /** 校验评分标准（2026-09-28 方案 A：原「发布」重释义——复用 publishScoreStandard 端点做
   *  完整性校验并盖时间戳，纯前端语义调整，零后端改动；校验非破坏性，无需确认框）。 */
  const handleValidate = async () => {
    if (!bpId) return;
    // N10：打分类 0 满分「空项」不得通过校验（英雄项目「法」）
    const zeroMaxScored = items.find((i) => !isPassFailCategory(i.category) && Number(i.maxScore) <= 0);
    if (zeroMaxScored) {
      toast.error(ZERO_MAX_SCORE_MSG(zeroMaxScored.name));
      return;
    }
    const scoredSum = items.filter((i) => Number(i.maxScore) > 0).reduce((s, i) => s + Number(i.maxScore), 0);
    if (scoredSum !== 100 || pointsIncompleteCount > 0) {
      // 未配满明细点名前两项（与后端 POINTS_SUM_BELOW_MAX/EXCEEDS 同口径）
      const detail = pointsIncomplete.slice(0, 2).map((i) => {
        const s = (i.points ?? []).reduce((acc, p) => acc + Number(p.fullScore), 0);
        return `「${i.name}」${(i.points ?? []).length === 0 ? '无得分点' : `得分点合计 ${s}/${i.maxScore}`}`;
      }).join('、');
      toast.error(`校验未通过:打分项满分合计须=100(当前 ${scoredSum}),且每个打分项的得分点须配满${detail ? `（${detail}）` : ''}`);
      return;
    }
    try {
      const res = await publishScoreStandard(bpId);
      setValidatedAt(res.scoreStandardPublishedAt ?? null);
      toast.success('评分标准校验通过');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '校验失败');
    }
  };

  /** 取源核心（一键/逐项共用，2026-09-27 统一口径）：显式 extractSource（完成向导=正式盖章版）
   *  优先 → 无候选 toast（返回 'none'）→ 单候选自动 → 已选沿用 → 多候选需弹选择器（'picker'）。 */
  const resolveSourceCore = (): { attachmentId: string; fileName: string } | 'picker' | 'none' => {
    if (extractSource) return extractSource;
    const candidates = (tenderCandidates ?? []).filter((c) => !!c.id);
    if (candidates.length === 0) {
      toast.error('采购文件未就绪：请先在「采购文件编写」导出或手动上传采购文件');
      return 'none';
    }
    if (candidates.length === 1) return { attachmentId: candidates[0].id!, fileName: candidates[0].fileName };
    if (pickedSource) return pickedSource; // 多文件但本面板已选过源——沿用，避免反复询问
    return 'picker'; // 多文件：用户裁定须询问提取哪一个
  };

  /** 一键提取用：同步解析；null = 流程中止（已弹选择器或已 toast），调用方直接 return。 */
  const resolveExtractSource = (): { attachmentId: string; fileName: string } | null => {
    const r = resolveSourceCore();
    if (r === 'picker') {
      pickerForRef.current = 'bulk';
      setShowSourcePicker(true);
      return null;
    }
    if (r === 'none') return null;
    return r;
  };

  /** 逐项「AI 提取建议」用（2026-09-27 用户裁定：不再静默走后端兜底）——与一键同口径；
   *  多文件未选时弹同一选择器并 Promise 挂起，选定落定 / 取消返回 null（调用方中止）。 */
  const resolveSourceForItem = (): Promise<{ attachmentId: string; fileName: string } | null> => {
    const r = resolveSourceCore();
    if (r === 'picker') {
      pickerForRef.current = 'item';
      setShowSourcePicker(true);
      return new Promise((resolve) => {
        pendingItemSourceRef.current = resolve;
      });
    }
    return Promise.resolve(r === 'none' ? null : r);
  };

  const runBulkExtract = async (source: { attachmentId: string; fileName: string }) => {
    if (!bpId) return;
    setExtractingAll(true);
    setSourceLabel(source.fileName);
    const controller = new AbortController();
    // 提取均带显式源（正式盖章版多为扫描件，OCR 分钟级）——超时放宽到 600s
    const timer = setTimeout(() => controller.abort(), 600_000);
    try {
      const groups = await extractAllScorePoints(bpId, { sourceAttachmentId: source.attachmentId, signal: controller.signal });
      const withSelection: EditableGroup[] = groups
        .filter((g) => g.suggestions.length > 0)
        .map((g) => ({
          ...g,
          suggestions: [...g.suggestions]
            .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
            .map((s) => ({ ...s, selected: !s.duplicate })),
        }));
      if (withSelection.length === 0) {
        toast.info('AI 未提取到任何得分点建议');
      } else {
        setBulkGroups(withSelection);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.name 判 AbortError + e?.message 回退（与单项提取一致）
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        toast.error('AI 提取超时（600s）——正式盖章版扫描件 OCR 较慢，请稍后重试（重复提取会命中已缓存的识别文本）');
      } else {
        toast.error(e?.message ?? 'AI 提取暂时不可用，请稍后重试或逐项提取。');
      }
    } finally {
      clearTimeout(timer);
      setExtractingAll(false);
    }
  };

  const handleBulkExtract = async () => {
    if (!bpId) return;
    if (items.length === 0) {
      toast.error('请先「应用模板」或手动新增评分项');
      return;
    }
    if (items.every((i) => i.category === 'PRICE')) {
      toast.error('当前评分项均为价格项，无需 AI 提取');
      return;
    }
    const source = resolveExtractSource();
    if (!source) return;
    await runBulkExtract(source);
  };

  const handleBulkImport = async (groups: EditableGroup[]) => {
    if (!bpId) return;
    const picked = groups
      .map((g) => ({ itemId: g.itemId, points: g.suggestions.filter((s) => s.selected) }))
      .filter((g) => g.points.length > 0);
    if (picked.length === 0) {
      setBulkGroups(null);
      return;
    }
    const results = await Promise.allSettled(picked.map((g) => batchCreateScorePoints(bpId, g.itemId, g.points)));
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) {
      if (r.status === 'rejected') {
        toast.error(r.reason instanceof Error ? r.reason.message : '部分得分点导入失败');
      }
    }
    if (okCount > 0) {
      // 2026-09-26 用户裁定：导入含价格类（PRICE）评分项 → 评标办法自动切「专家评审」
      // （价格作为打分项由专家逐项手填；幂等写——已是 manual 时无副作用）
      const hasPriceItem = picked.some((g) => items.find((i) => i.id === g.itemId)?.category === 'PRICE');
      if (hasPriceItem) {
        try {
          await updatePriceConfig(bpId, { evaluationMethod: 'manual' });
          toast.info('检测到价格类评分项——评标办法已切换为「专家评审」（价格分由专家按项打分）');
        } catch {
          // 切换失败不阻断导入；评标办法可在上方「评标办法与最高限价」手动调整
        }
      }
      toast.success(`已导入得分点（${okCount}/${picked.length} 个评分项）`);
      setBulkGroups(null);
      await reloadItems();
      onChanged?.(); // PRICE 联动后重拉详情 → 上方块回显 manual
    }
  };

  const handleCreate = async () => {
    if (!bpId) return;
    if (!draft.name.trim()) {
      toast.error('请填写评分项名称');
      return;
    }
    // N10：打分类项满分须 >0（通过性审查满分恒为 0）
    if (!isPassFailCategory(draft.category) && Number(draft.maxScore) <= 0) {
      toast.error(ZERO_MAX_SCORE_MSG(draft.name.trim()));
      return;
    }
    try {
      const created = await createScoreItem(bpId, {
        category: draft.category,
        name: draft.name.trim(),
        maxScore: isPassFailCategory(draft.category) ? 0 : Number(draft.maxScore),
      });
      setItems((prev) => [...prev, created]);
      setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 });
      setShowAdd(false);
      setValidatedAt(null); // 修改作废已校验状态，需重新校验
      toast.success('评分项已新增');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '新增失败');
    }
  };

  const startEdit = (it: BidScoreItem) => {
    setEditingId(it.id);
    setEditDraft({ category: it.category, name: it.name, maxScore: Number(it.maxScore) });
  };

  const handleSaveEdit = async (id: string) => {
    if (!bpId) return;
    if (!editDraft.name.trim()) {
      toast.error('请填写评分项名称');
      return;
    }
    // N10：打分类项满分须 >0（通过性审查满分恒为 0）
    if (!isPassFailCategory(editDraft.category) && Number(editDraft.maxScore) <= 0) {
      toast.error(ZERO_MAX_SCORE_MSG(editDraft.name.trim()));
      return;
    }
    try {
      const updated = await updateScoreItem(bpId, id, {
        category: editDraft.category,
        name: editDraft.name.trim(),
        maxScore: isPassFailCategory(editDraft.category) ? 0 : Number(editDraft.maxScore),
      });
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      setEditingId(null);
      setValidatedAt(null); // 修改作废已校验状态，需重新校验
      toast.success('已保存');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const confirmDelete = async () => {
    if (!bpId || !deleteConfirm) return;
    const { id } = deleteConfirm;
    try {
      await deleteScoreItem(bpId, id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      setValidatedAt(null); // 修改作废已校验状态，需重新校验
      toast.success('已删除');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败');
    }
    setDeleteConfirm(null);
  };

  const CategoryBadge = ({ category }: { category: string }) => {
    const color = CATEGORY_COLOR[category] || '#94a3b8';
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-[var(--cat-color)] bg-[color-mix(in_oklch,var(--cat-color)_12%,transparent)]"
        style={{ '--cat-color': color } as React.CSSProperties}
      >
        {CATEGORY_LABEL[category] || category}
      </span>
    );
  };

  const toolbar = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      {/* 左侧：模板与提取 */}
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 && (
          <button onClick={() => setShowSaveTpl(true)} className="neu-btn-xs gap-1.5">
            <Save size={13} />存为模板
          </button>
        )}
        <button onClick={() => setShowLib(true)} className="neu-btn-xs gap-1.5">
          <FileSpreadsheet size={13} />应用模板
        </button>
        {!locked && (
          <button
            onClick={handleBulkExtract}
            disabled={extractingAll}
            className="neu-btn-xs gap-1.5 is-info"
            title={extractSource
              ? `从${extractSource.isOfficial === false ? '指定提取源' : '正式盖章版采购文件'}提取得分点${extractSource.isOfficial === false ? '' : '（OCR）'}：${extractSource.fileName}`
              : pickedSource
                ? `提取源：${pickedSource.fileName}`
                : '从「采购文件」步骤的采购文件提取得分点（多文件时可选）'}
          >
            <Sparkles size={13} />
            {extractingAll ? '提取中…' : 'AI 全部提取'}
          </button>
        )}
      </div>
      {/* 右侧：活合计 + 校验 + 新增（P1，2026-09-28：原摘要条与底部合计条并入此处——
          Σ 硬闸口径就地可见（状态常显，锁定态也保留）；校验/新增动作仅未锁定时显示。
          校验语义见方案 A：原「发布评分标准」重释义为版本校验标记，与新增同权重软按钮） */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {items.length > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)]"
            title={`打分项满分合计（硬闸口径：Σ=100 且每打分项得分点配满——Σ得分点满分=项满分；未配满行见名称列「合计 x/y」标示）。共 ${items.length} 项，含 ${passFailCount} 项通过性审查（不计分）`}
          >
            打分合计
            <span
              className={`font-mono text-sm font-bold ${sumOk && !pointsIncompleteCount ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
            >
              {scoredTotal}
            </span>
            /100
            {gateWarnText ? (
              <span className="font-semibold text-[var(--danger)]">
                · {gateWarnText}
              </span>
            ) : (
              <Check size={12} strokeWidth={2.2} className="text-[var(--success)]" />
            )}
          </span>
        )}
        {!locked && (
          <>
            <button onClick={() => { setShowAdd(true); setDraft({ category: 'TECHNICAL', name: '', maxScore: 0 }); }} className="neu-btn-soft gap-1.5">
              <Plus size={14} />新增评分项
            </button>
            {validatedAt ? (
              /* 2026-09-28 用户裁定：校验后状态由彩色胶囊改软按钮态（neu-btn-soft is-success）——
                  与「新增评分项」同几何同语言，工具行不再混入异形元素 */
              <span
                className="neu-btn-soft is-success !cursor-default"
                title={`当前版本已通过完整性校验（${new Date(validatedAt).toLocaleString('zh-CN')}）；开标前仍可修改，修改后需重新校验`}
              >
                <Check size={14} strokeWidth={2} /> 已校验 · 开标前可修改
              </span>
            ) : (
              <button onClick={handleValidate} className="neu-btn-soft gap-1.5">
                <ShieldCheck size={14} />校验评分标准
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  const tableBlock = (
    <>
      {/* ── Summary（P1-1，2026-09-28：摘要条撤销——项数/Σ/通过性计数并入工具行活合计与 title） ── */}

      <div className="overflow-x-auto">
        {/* table-fixed（2026-09-28 宽度适配）：列宽由表头指定、内容不反推表宽——展开行内
            得分点 flex 行的 nowrap 固有宽（Chrome 对 min-width:0 钳制在表格内在尺寸计算中
            不生效）曾把 auto 表撑到 ~2100px 产生横向滚动；名称列吃剩余宽、长文换行 */}
        {loading ? (
          <table className="neu-table w-full table-fixed">
            <tbody>
              <TableSkeleton cols={5} rows={5} />
            </tbody>
          </table>
        ) : items.length === 0 && !showAdd ? (
          <div className="py-14 text-center">
            <p className="text-sm text-[var(--muted-foreground)]/70">该项目尚未编制评分标准。</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]/50">
              评分项是评标的前置条件——无评分项则专家无法打分。请点击「应用模板」选用标准模板，或手动新增。
            </p>
          </div>
        ) : (
          <table className="neu-table w-full table-fixed">
            <thead>
              <tr>
                <th className="w-8 px-2 py-3"></th>
                <th className="w-[120px] px-4 py-3 text-left text-xs font-semibold text-[var(--muted-foreground)]">类别</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[var(--muted-foreground)]">评分项名称</th>
                <th className="w-[92px] px-4 py-3 text-left text-xs font-semibold text-[var(--muted-foreground)]">满分</th>
                <th className="w-[104px] px-4 py-3 text-right text-xs font-semibold text-[var(--muted-foreground)]">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isEdit = editingId === it.id;
                const open = !!expanded[it.id];
                const points = it.points ?? [];
                return (
                  <Fragment key={it.id}>
                    <tr
                      className={`${isEdit ? '' : 'cursor-pointer hover:bg-[oklch(0.97_0.01_258_/_0.5)]'}`}
                      onClick={() => {
                        if (!isEdit) setExpanded((prev) => ({ ...prev, [it.id]: !prev[it.id] }));
                      }}
                    >
                      <td className="px-2 py-3 text-[var(--muted-foreground)]/70">
                        {!isEdit &&
                          (open ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />)}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <select
                            value={editDraft.category}
                            onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value as ScoreCategory }))}
                            className={`${inputCls} w-full`}
                          >
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {CATEGORY_LABEL[c]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <CategoryBadge category={it.category} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <input
                            type="text"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            className={`${inputCls} w-full max-w-[360px]`}
                          />
                        ) : (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-[var(--foreground)]">{it.name}</span>
                            {/* 行内副行（2026-09-28 两级化）：完整=muted 计数；未配满=警示色并点名
                                「合计 x/y」——chip 只报件数，哪一行短须不展开即可见 */}
                            {!isPassFailCategory(it.category) &&
                              (() => {
                                if (points.length === 0) {
                                  return (
                                    <span className="text-[11px] font-semibold text-[var(--danger)]">
                                      未设得分点
                                    </span>
                                  );
                                }
                                const s = points.reduce((acc, p) => acc + Number(p.fullScore), 0);
                                const short = Math.abs(s - Number(it.maxScore)) > 0.05;
                                return (
                                  <span
                                    className={`text-[11px] ${short ? 'font-semibold text-[var(--danger)]' : 'text-[var(--muted-foreground)]/80'}`}
                                  >
                                    {points.length} 个得分点{short ? ` · 合计 ${s}/${it.maxScore}` : ''}
                                  </span>
                                );
                              })()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          isPassFailCategory(editDraft.category) ? (
                            <span className="text-xs font-bold text-[var(--muted-foreground)]">通过性</span>
                          ) : (
                            <input
                              type="number"
                              min={1}
                              step="0.1"
                              value={editDraft.maxScore}
                              onChange={(e) => setEditDraft((d) => ({ ...d, maxScore: Number(e.target.value) }))}
                              className={`${inputCls} w-full max-w-[100px] font-mono`}
                            />
                          )
                        ) : (
                          <span className="font-mono text-sm font-bold text-[var(--accent-strong)]">
                            {isPassFailCategory(it.category) ? '通过性' : Number(it.maxScore) > 0 ? `${Number(it.maxScore)}` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {isEdit ? (
                            <>
                              <button onClick={() => handleSaveEdit(it.id)} className="neu-btn-xs is-success" title="保存">
                                <Check size={15} strokeWidth={1.8} />
                              </button>
                              <button onClick={() => setEditingId(null)} className="neu-btn-xs" title="取消">
                                <X size={15} strokeWidth={1.8} />
                              </button>
                            </>
                          ) : (
                            !locked && (
                              <>
                                <button onClick={() => startEdit(it)} className="neu-btn-xs" title="编辑">
                                  <Pencil size={13} strokeWidth={1.5} />
                                </button>
                                <button onClick={() => setDeleteConfirm({ id: it.id, name: it.name })} className="neu-btn-xs is-danger" title="删除">
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                    {open && !isEdit && bpId && (
                      <tr className="bg-[oklch(0.985_0.003_265)]">
                        <td colSpan={5} className="px-4 pb-4 pt-1">
                          <ScorePointsEditor
                            projectId={bpId}
                            item={it}
                            points={points}
                            onChanged={reloadItems}
                            locked={locked}
                            extractSource={extractSource ?? pickedSource}
                            resolveSource={resolveSourceForItem}
                            priceFormulaCalc={priceFormulaCalc}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {/* ── Add row ── */}
              {showAdd && (
                <tr className="border-t-2 border-[oklch(0.5_0.16_258_/_0.15)]">
                  <td className="px-2 py-3"></td>
                  <td className="px-4 py-3">
                    <select
                      value={draft.category}
                      onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as ScoreCategory }))}
                      className={`${inputCls} w-full`}
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="如：技术方案完整性"
                      value={draft.name}
                      onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      className={`${inputCls} w-full max-w-[360px]`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {isPassFailCategory(draft.category) ? (
                      <span className="text-xs font-bold text-[var(--muted-foreground)]">通过性</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        step="0.1"
                        value={draft.maxScore}
                        onChange={(e) => setDraft((d) => ({ ...d, maxScore: Number(e.target.value) }))}
                        className={`${inputCls} w-full max-w-[100px] font-mono`}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={handleCreate} className="neu-btn-xs is-success" title="保存">
                        <Check size={15} strokeWidth={1.8} />
                      </button>
                      <button onClick={() => setShowAdd(false)} className="neu-btn-xs" title="取消">
                        <X size={15} strokeWidth={1.8} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 底部合计条（P1-1，2026-09-28：撤销——与摘要条/工具行活合计三处重复，保留工具行一处） */}
    </>
  );

  return (
    <div className={variant === 'embedded' ? 'space-y-4' : 'space-y-6'}>
      {locked && (
        <div className="wb-alert wb-alert--warning flex items-center gap-2 !text-sm !font-semibold">
          <Lock size={14} />
          <span>
            {validatedAt
              ? `评分标准最后校验通过于 ${new Date(validatedAt).toLocaleString('zh-CN')},项目已进入「${STAGE_LABEL[stage] || stage}」阶段,锁定不可修改。`
              : `项目处于「${STAGE_LABEL[stage] || stage}」阶段,评分标准已锁定,不可修改。${stage === 'EVALUATING' ? ' 专家已开始打分。' : ''}`}
          </span>
        </div>
      )}

      {variant === 'standalone' ? (
        <div className="neu-table-card p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-[var(--foreground)]">评分项</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              资格审查 / 响应性为通过性审查（满分 0）；商务 / 技术 / 价格为打分项。
            </p>
          </div>
          {toolbar}
          {tableBlock}
        </div>
      ) : (
        <>
          {toolbar}
          {tableBlock}
        </>
      )}

      {/* 删除确认弹窗 */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <button onClick={() => setDeleteConfirm(null)} className="neu-btn-soft">
              取消
            </button>
            <button
              onClick={confirmDelete}
              className="neu-btn-primary is-danger !h-[38px] !text-xs"
            >
              确认删除
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--muted-foreground)]">
          确定要删除评分项「{deleteConfirm?.name}」吗？此操作不可撤销。
        </p>
      </Modal>

      {bpId && (
        <SaveTemplateDialog
          open={showSaveTpl}
          onClose={() => setShowSaveTpl(false)}
          projectId={bpId}
          procurementMethod={tplDims.procurementMethod}
          projectCategory={tplDims.projectCategory}
        />
      )}
      {bpId && (
        <TemplateLibraryDialog
          open={showLib}
          onClose={() => setShowLib(false)}
          projectId={bpId}
          locked={locked}
          procurementMethod={tplDims.procurementMethod}
          projectCategory={tplDims.projectCategory}
          onChanged={(updated) => {
            setItems(updated);
            // 应用模板可能作废已校验状态，回读详情同步
            getBidProjectDetail(bpId).then((d) => setValidatedAt(d.scoreStandardPublishedAt ?? null)).catch(() => {});
            onChanged?.();
          }}
        />
      )}
      {bulkGroups && bpId && (
        <BulkExtractReviewDialog
          open
          groups={bulkGroups}
          locked={locked}
          sourceLabel={sourceLabel}
          onClose={() => setBulkGroups(null)}
          onImport={handleBulkImport}
        />
      )}

      {/* 提取源选择（用户裁定 2026-09-26）：「采购文件」步骤多文件时询问提取哪一个；
          2026-09-27 起一键与逐项共用——逐项唤起时选定落定挂起 Promise、取消返回 null */}
      {showSourcePicker && (
        <ExtractSourcePickerDialog
          open
          candidates={tenderCandidates ?? []}
          onClose={() => {
            setShowSourcePicker(false);
            if (pickerForRef.current === 'item') {
              pickerForRef.current = 'bulk';
              pendingItemSourceRef.current?.(null);
              pendingItemSourceRef.current = null;
            }
          }}
          onPick={(attachmentId, fileName) => {
            setShowSourcePicker(false);
            setPickedSource({ attachmentId, fileName });
            if (pickerForRef.current === 'item') {
              pickerForRef.current = 'bulk';
              pendingItemSourceRef.current?.({ attachmentId, fileName });
              pendingItemSourceRef.current = null;
            } else {
              void runBulkExtract({ attachmentId, fileName });
            }
          }}
        />
      )}
    </div>
  );
}
