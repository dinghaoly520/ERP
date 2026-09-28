'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2, GripVertical, Sparkles, X, Link2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  createScorePoint,
  updateScorePoint,
  deleteScorePoint,
  extractScorePoints,
  batchCreateScorePoints,
  updateLinkedRequirements,
  getTenderRequirements,
  type BidScorePoint,
  type BidScoreItem,
  type ScorePointSuggestion,
} from '@/lib/api/bid';
import { Modal } from '@/components/workbench';
import { SuggestionRow } from './suggestion-row';

// Phase 1：条款类别标签（与 requirement-matcher 的 category 一致）
const REQ_CAT_LABEL: Record<string, string> = { qualification: '资格', technical: '技术', commercial: '商务' };

/** 客观/主观色调胶囊（2026-09-28 P2 cgzxui 迁移：blue-50/amber-50 → token color-mix） */
const objPillCls = (objective: boolean) =>
  `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
    objective
      ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent-strong)]'
      : 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[var(--danger)]'
  }`;

interface Props {
  projectId: string;
  item: BidScoreItem;
  points: BidScorePoint[];
  onChanged: () => void; // 增删改后通知父组件刷新
  locked?: boolean; // 项目已进 OPENING/EVALUATING/ARCHIVED 时禁用修改（校验标记不锁编辑，锁编辑的是阶段闸）
  /** 提取源（2026-09-26）：完成向导=正式盖章版（isOfficial）；「评分标准」面板=用户多文件时
   *  选定的源（isOfficial 缺省——非正式文件时文案不得冒称"正式盖章版"） */
  extractSource?: { attachmentId: string; fileName: string; isOfficial?: boolean } | null;
  /** 就地取源（2026-09-27 用户裁定：逐项与一键同口径）——extractSource 未定时由父级解析：
   *  单文件/已选源直接返回；多文件未选时弹同一选择器，选定落定、取消返回 null（中止提取）。
   *  null 返回后不再静默走后端「该轮最新附件」兜底。 */
  resolveSource?: () => Promise<{ attachmentId: string; fileName: string } | null>;
}

/**
 * 得分点子面板（2026-09-28 P2 cgzxui 迁移）：原纯白行/描边按钮/深色蒙层手搓弹窗
 * 全部收编——行=半透白凸面、按钮=neu-btn-xs、输入=workbench-input 紧凑变体、
 * 两弹窗=workbench Modal（token 蒙层+focus trap+Esc；z-[600] 盖过 z-[500] 评分面板）。
 */
export function ScorePointsEditor({ projectId, item, points, onChanged, locked, extractSource, resolveSource }: Props) {
  const isPassFail = item.category === 'QUALIFICATION' || item.category === 'RESPONSIVE';
  const isPrice = item.category === 'PRICE'; // 价格分按公式计算,不提取得分点
  const [draft, setDraft] = useState({ name: '', fullScore: 0, evidenceHint: '', objective: true });
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [suggestions, setSuggestions] = useState<(ScorePointSuggestion & { selected: boolean })[] | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // ── 本地得分点状态：增删改立即更新，避免父组件 reload 导致 DOM 重建 + 滚动跳顶 ──
  const [localPoints, setLocalPoints] = useState<BidScorePoint[]>(() => points);
  const localIdsRef = useRef('');
  useEffect(() => { localIdsRef.current = localPoints.map((p) => p.id).sort().join(','); }, [localPoints]);
  useEffect(() => {
    const propIds = points.map((p) => p.id).sort().join(',');
    if (propIds !== localIdsRef.current) setLocalPoints(points);
  }, [points]);

  const total = localPoints.reduce((s, p) => s + Number(p.fullScore), 0);
  const max = Number(item.maxScore);

  // ── 得分点行内编辑（2026-09-27 用户裁定：已配得分点可改名称/评审要点）──
  const [editingPoint, setEditingPoint] = useState<{ id: string; name: string; evidenceHint: string } | null>(null);
  async function savePointEdit() {
    if (!editingPoint) return;
    const name = editingPoint.name.trim();
    if (!name) { toast.error('得分点名称不能为空'); return; }
    const evidenceHint = editingPoint.evidenceHint.trim();
    try {
      await updateScorePoint(projectId, item.id, editingPoint.id, { name, evidenceHint });
      setLocalPoints((prev) => prev.map((x) => (x.id === editingPoint.id ? { ...x, name, evidenceHint } : x)));
      setEditingPoint(null);
      onChanged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.message 回退提示
    } catch (e: any) {
      toast.error(e?.message ?? '保存得分点失败，请重试');
    }
  }

  async function handleExtract() {
    setExtracting(true);
    setExtractError(null);
    // 取源（2026-09-27 用户裁定：与一键提取同口径）——面板多文件未选时先弹选择器；
    // 用户取消则中止，不再静默走后端「该轮最新附件」兜底
    let source = extractSource ?? null;
    if (!source && resolveSource) {
      source = await resolveSource();
      if (!source) {
        setExtracting(false);
        return;
      }
    }
    const controller = new AbortController();
    // 有显式源（正式盖章版扫描件 OCR 分钟级）超时放宽到 300s；无源兜底 120s
    const timeoutMs = source ? 300_000 : 120_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const list = await extractScorePoints(projectId, item.id, {
        sourceAttachmentId: source?.attachmentId,
        signal: controller.signal,
      });
      // E3: 按 confidence 降序,重复项默认不选
      const sorted = [...list].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
      setSuggestions(sorted.map((s) => ({ ...s, selected: !s.duplicate })));
      if (list.length === 0) {
        if (item.category === 'PRICE') {
          setExtractError('价格分类别的得分点不适用 AI 提取——价格分按评标口径计分（公式自动或专家手填）。');
        } else {
          setExtractError('AI 未从采购文件提取到得分点建议。');
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.name 判 AbortError + e?.message 回退
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setExtractError(`AI 提取超时（${timeoutMs / 1000}s），正式盖章版扫描件 OCR 较慢，请稍后重试`);
      } else {
        setExtractError(e?.message ?? 'AI 提取暂时不可用,请稍后重试或手动添加。');
      }
    } finally {
      clearTimeout(timer);
      setExtracting(false);
    }
  }

  async function handleImportSelected() {
    const picked = (suggestions ?? []).filter((s) => s.selected);
    if (picked.length === 0) { setSuggestions(null); return; }
    try {
      await batchCreateScorePoints(projectId, item.id, picked);
      setSuggestions(null);
      onChanged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.message 回退提示
    } catch (e: any) {
      toast.error(e?.message ?? '导入失败，请重试');
    }
  }

  async function add() {
    if (!draft.name.trim()) return;
    // 前端预检（2026-09-28）：合计将超大类满分直接 toast 拦下——此前裸 try/finally 无 catch，
    // ApiError 冒成未处理拒绝弹 Next.js dev 错误浮层（用户实测 20.5 > 20 即此路径）
    const nextTotal = total + (isPassFail ? 0 : Number(draft.fullScore));
    if (!isPassFail && nextTotal > max) {
      toast.error(`得分点满分合计 ${nextTotal} 将超过大类满分 ${max}，请调整后再添加`);
      return;
    }
    setBusy(true);
    try {
      const created = await createScorePoint(projectId, item.id, {
        name: draft.name.trim(),
        fullScore: isPassFail ? 0 : Number(draft.fullScore),
        evidenceHint: draft.evidenceHint.trim() || undefined,
        objective: draft.objective,
      });
      setLocalPoints((prev) => [...prev, created]);
      setDraft({ name: '', fullScore: 0, evidenceHint: '', objective: true });
      onChanged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.message 回退提示
    } catch (e: any) {
      toast.error(e?.message ?? '添加得分点失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  async function toggleObjective(p: BidScorePoint) {
    setLocalPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, objective: !p.objective } : x)));
    try {
      await updateScorePoint(projectId, item.id, p.id, { objective: !p.objective });
      onChanged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 失败回滚乐观更新
    } catch (e: any) {
      setLocalPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, objective: p.objective } : x)));
      toast.error(e?.message ?? '切换客观/主观失败，请重试');
    }
  }

  async function remove(p: BidScorePoint) {
    setLocalPoints((prev) => prev.filter((x) => x.id !== p.id));
    try {
      await deleteScorePoint(projectId, item.id, p.id);
      onChanged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 失败回滚乐观更新
    } catch (e: any) {
      setLocalPoints((prev) => [...prev, p]);
      toast.error(e?.message ?? '删除得分点失败，请重试');
    }
  }

  async function editFullScore(p: BidScorePoint, v: number, input: HTMLInputElement) {
    // uncontrolled 输入被拒时命令式还原显值（state 回滚同值不会触发重渲染）
    const revertInput = () => { input.value = String(Number(p.fullScore)); };
    // 前端预检：本项新值 + 其余项合计不得超过大类满分（与后端 assertPointsSumWithinMax 同口径）
    const others = total - Number(p.fullScore);
    if (!isPassFail && others + v > max) {
      toast.error(`得分点满分合计 ${others + v} 将超过大类满分 ${max}`);
      revertInput();
      return;
    }
    setLocalPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, fullScore: String(v) } : x)));
    try {
      await updateScorePoint(projectId, item.id, p.id, { fullScore: v });
      onChanged();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 失败回滚乐观更新+输入显值
    } catch (e: any) {
      setLocalPoints((prev) => prev.map((x) => (x.id === p.id ? { ...x, fullScore: p.fullScore } : x)));
      revertInput();
      toast.error(e?.message ?? '修改得分点满分失败，请重试');
    }
  }

  // ── Phase 1：得分点↔招标条款映射（独立于发布锁；lazy-load 条款列表）──
  const [linkingPoint, setLinkingPoint] = useState<BidScorePoint | null>(null);
  const [requirements, setRequirements] = useState<Array<{ requirementId: string; category: string; tenderContent: string; isStarred: boolean }> | null>(null);
  const [requirementsLoading, setRequirementsLoading] = useState(false);
  const [linkDraft, setLinkDraft] = useState<Record<string, boolean>>({});

  async function openLinks(p: BidScorePoint) {
    setLinkingPoint(p);
    const init: Record<string, boolean> = {};
    (p.linkedRequirementIds ?? []).forEach((id) => { init[id] = true; });
    setLinkDraft(init);
    if (requirements === null) {
      setRequirementsLoading(true);
      try {
        setRequirements(await getTenderRequirements(projectId));
      } catch {
        setRequirements([]);
        toast.error('加载招标条款失败');
      } finally {
        setRequirementsLoading(false);
      }
    }
  }

  async function saveLinks() {
    if (!linkingPoint) return;
    const ids = Object.keys(linkDraft).filter((k) => linkDraft[k]);
    const prevLinked = linkingPoint.linkedRequirementIds ?? [];
    // 乐观更新本地 + 反映 count 徽标
    setLocalPoints((prev) => prev.map((x) => (x.id === linkingPoint.id ? { ...x, linkedRequirementIds: ids } : x)));
    setLinkingPoint(null);
    if (ids.length === prevLinked.length && ids.every((id) => prevLinked.includes(id))) return; // 无变化
    try {
      await updateLinkedRequirements(projectId, item.id, linkingPoint.id, ids);
      onChanged();
      toast.success(`已关联 ${ids.length} 条招标条款`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 读 e?.message 回退提示
    } catch (e: any) {
      setLocalPoints((prev) => prev.map((x) => (x.id === linkingPoint.id ? { ...x, linkedRequirementIds: prevLinked } : x)));
      toast.error(e?.message ?? '保存映射失败');
    }
  }

  return (
    // 内凹井（P2 迁移：外侧框线撤销——层次感改由井影+半透底表达）
    <div className="mt-2 rounded-xl bg-[oklch(0.972_0.01_258_/_0.55)] p-3 shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258_/_0.09),inset_-1px_-1px_2px_oklch(1_0_0_/_0.5)]">
      {/* 价格项职责说明（2026-09-28 方案 B 定稿）：本面板=分配价格分总分，计分方式与此无关——
          显式解耦，防「手填/自动」被误读为影响此处配置 */}
      {isPrice && (
        <p className="mb-2 rounded-[10px] bg-[oklch(1_0_0_/_0.45)] px-2.5 py-1.5 text-xs leading-5 text-[var(--muted-foreground)]">
          此处分配价格分总分（如 50 分）：新增得分点使合计等于该项满分即可；不从采购文件 AI 提取——
          计分方式（公式自动/专家手填）在上方「价格分计算方式」中选择，与此处分配无关
        </p>
      )}
      {/* 合计提示 + AI 提取按钮 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        {!isPassFail ? (
          <div className="text-xs text-[var(--muted-foreground)]">
            得分点满分合计{' '}
            <span className={`font-mono font-semibold ${total > max ? 'text-[var(--danger)]' : 'text-[var(--foreground)]'}`}>{total}</span> / 大类满分 {max}
            {total > max && <span className="ml-1 text-[var(--danger)]">（已超出大类满分）</span>}
            {total < max && (
              <span className="ml-1 text-[var(--danger)]">差额 {max - total} 未分配</span>
            )}
          </div>
        ) : <span />}
        <div className="flex items-center gap-2">
          {!isPrice && !locked && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="neu-btn-xs gap-1.5 is-info"
            title={extractSource
              ? `从${extractSource.isOfficial ? '正式盖章版采购文件' : '指定提取源'}提取得分条款建议${extractSource.isOfficial ? '（OCR）' : ''}：${extractSource.fileName}`
              : '补充本评分项的得分条款建议——提取源与「AI 全部提取」一致（多文件未选时将先请选择）'}
          >
            <Sparkles size={13} /> {extracting ? '提取中…' : 'AI 补充建议'}
          </button>
          )}
          {extractError && <span className="text-xs text-[var(--danger)]">{extractError}</span>}
        </div>
      </div>

      {/* 已有得分点列表——名称/评审要点两列左对齐（2026-09-27 用户裁定，1:1.8 弹性列宽）；
          行内编辑改名称/评审要点（悬浮浮层已按用户裁定移除——列宽放宽后全文可见） */}
      <div className="space-y-1">
        {localPoints.map((p, idx) => {
          const isEditing = editingPoint?.id === p.id;
          return (
            <div key={p.id} className="flex items-center gap-2 rounded-[10px] bg-[oklch(1_0_0_/_0.62)] px-2.5 py-1.5 text-sm">
              <GripVertical size={14} className="text-[var(--muted-foreground)]/60" />
              <span className="w-6 text-[var(--muted-foreground)]">{idx + 1}.</span>
              {isEditing ? (
                /* 编辑态：名称 + 评审要点两输入 + 保存/取消（其余操作暂隐）——✓/✕ 与主表行内编辑同款 */
                <>
                  <input
                    type="text"
                    value={editingPoint!.name}
                    onChange={(e) => setEditingPoint((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    className="workbench-input min-w-0 flex-1 !h-8 !px-2 !text-xs"
                    placeholder="得分点名称"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') void savePointEdit(); if (e.key === 'Escape') setEditingPoint(null); }}
                  />
                  <input
                    type="text"
                    value={editingPoint!.evidenceHint}
                    onChange={(e) => setEditingPoint((prev) => (prev ? { ...prev, evidenceHint: e.target.value } : prev))}
                    className="workbench-input min-w-0 flex-[1.8] !h-8 !px-2 !text-xs"
                    placeholder="评审要点（可选）"
                    onKeyDown={(e) => { if (e.key === 'Enter') void savePointEdit(); if (e.key === 'Escape') setEditingPoint(null); }}
                  />
                  <button onClick={() => void savePointEdit()} disabled={!editingPoint!.name.trim()} className="neu-btn-xs is-success" title="保存">
                    <Check size={15} strokeWidth={1.8} />
                  </button>
                  <button onClick={() => setEditingPoint(null)} className="neu-btn-xs" title="取消">
                    <X size={15} strokeWidth={1.8} />
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-left font-medium text-[var(--foreground)]">{p.name}</span>
                  {p.evidenceHint && (
                    <span className="min-w-0 flex-[1.8] truncate text-left text-xs text-[var(--muted-foreground)]">{p.evidenceHint}</span>
                  )}
                  {/* 关联招标条款（映射编辑不受发布锁限制；专家端条款核对就地打分/批注的依据） */}
                  <button
                    onClick={() => openLinks(p)}
                    className="neu-btn-xs !h-6 shrink-0 gap-1 !px-1.5 !text-[11px]"
                    title="关联招标条款（专家端条款核对就地打分/批注依据；可随时修改，不受发布锁限制）"
                  >
                    <Link2 size={12} />
                    {(p.linkedRequirementIds?.length ?? 0) > 0 ? `${p.linkedRequirementIds!.length} 条款` : '关联条款'}
                  </button>
                  <button
                    onClick={() => toggleObjective(p)}
                    className={objPillCls(p.objective)}
                    title="客观=专家勾选制；主观=专家直接给分"
                  >
                    {p.objective ? '客观' : '主观'}
                  </button>
                  {!isPassFail && (
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      defaultValue={Number(p.fullScore)}
                      onBlur={(e) => void editFullScore(p, Number(e.target.value), e.currentTarget)}
                      className="workbench-input !h-7 w-[4.5rem] shrink-0 !px-1.5 !text-xs text-right tabular-nums"
                    />
                  )}
                  {!locked && (
                    <button
                      onClick={() => setEditingPoint({ id: p.id, name: p.name, evidenceHint: p.evidenceHint ?? '' })}
                      className="neu-btn-xs shrink-0"
                      title="编辑得分点名称与评审要点"
                    >
                      <Pencil size={13} strokeWidth={1.5} />
                    </button>
                  )}
                  <button onClick={() => remove(p)} className="neu-btn-xs is-danger shrink-0" title="删除">
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                </>
              )}
            </div>
          );
        })}
        {localPoints.length === 0 && (
          <div className="py-1 text-xs text-[var(--muted-foreground)]">暂无得分点，在下方添加。</div>
        )}
      </div>

      {/* 新增行（发布后隐藏） */}
      {!locked && (
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[oklch(0.6_0.04_258_/_0.12)] pt-2">
        <input
          type="text"
          placeholder="得分点名称（如：施工组织设计）"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="workbench-input min-w-[180px] flex-1 !h-8 !px-2 !text-xs"
        />
        {!isPassFail && (
          <input
            type="number"
            min={0}
            step={0.5}
            placeholder="满分"
            value={draft.fullScore}
            onChange={(e) => setDraft({ ...draft, fullScore: Number(e.target.value) })}
            className="workbench-input w-20 !h-8 !px-2 !text-xs"
          />
        )}
        <input
          type="text"
          placeholder="评审要点（可选）"
          value={draft.evidenceHint}
          onChange={(e) => setDraft({ ...draft, evidenceHint: e.target.value })}
          className="workbench-input min-w-[140px] flex-1 !h-8 !px-2 !text-xs"
        />
        <button
          onClick={() => setDraft({ ...draft, objective: !draft.objective })}
          className={objPillCls(draft.objective)}
        >
          {draft.objective ? '客观' : '主观'}
        </button>
        <button
          onClick={add}
          disabled={busy || !draft.name.trim()}
          className="neu-btn-xs gap-1.5"
        >
          <Plus size={13} /> 添加
        </button>
      </div>
      )}

      {/* AI 提取建议审核弹窗（E3+E4 增强）——P2 迁移：手搓白底扁平弹窗 → workbench Modal */}
      {suggestions && (
        <Modal
          open
          onClose={() => setSuggestions(null)}
          size="lg"
          title={
            <span className="flex items-center gap-1.5">
              AI 提取得分点建议（来自招标文件） · <span className="font-mono">{suggestions.length}</span> 项
            </span>
          }
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[var(--muted-foreground)]">
                已选 {suggestions.filter((s) => s.selected).length}/{suggestions.length} 项
                {suggestions.filter((s) => s.duplicate).length > 0 && ` · ${suggestions.filter((s) => s.duplicate).length} 项疑似重复`}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setSuggestions(null)} className="neu-btn-soft !text-xs">取消</button>
                {!locked && (
                  <button onClick={handleImportSelected} className="neu-btn-primary !h-[38px] !text-xs">
                    导入选中的 {suggestions.filter((s) => s.selected).length} 项
                  </button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-1.5">
            {suggestions.map((s, idx) => (
              <SuggestionRow
                key={idx}
                suggestion={s}
                onToggleSelected={() =>
                  setSuggestions((prev) => prev!.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)))
                }
                onChange={(patch) =>
                  setSuggestions((prev) => prev!.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
                }
              />
            ))}
          </div>
        </Modal>
      )}

      {/* Phase 1：关联招标条款弹窗——P2 迁移：同上 → workbench Modal（说明段归 description） */}
      {linkingPoint && (
        <Modal
          open
          onClose={() => setLinkingPoint(null)}
          size="lg"
          title={
            <span className="flex items-center gap-1.5">
              关联招标条款 · <span className="font-mono">{linkingPoint.name}</span>
            </span>
          }
          description={
            '勾选与该得分点相关的招标条款。专家端「条款响应核对」标注异议/存疑时，命中映射的争议会精确关联到该得分点（异议徽章可一键按异议扣分、存疑可插入备注）；未映射的争议按评分大类提示。修改映射不受发布锁限制。'
          }
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[var(--muted-foreground)]">已选 {Object.values(linkDraft).filter(Boolean).length} 条</span>
              <div className="flex gap-2">
                <button onClick={() => setLinkingPoint(null)} className="neu-btn-soft !text-xs">取消</button>
                <button onClick={saveLinks} className="neu-btn-primary !h-[38px] !text-xs">保存</button>
              </div>
            </div>
          }
        >
          {requirementsLoading ? (
            <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">加载招标条款…</div>
          ) : (requirements ?? []).length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">未检索到招标条款（可能尚未完成 AI 招标分析，或该项目无条款数据）</div>
          ) : (
            ['qualification', 'technical', 'commercial'].map((c) => {
              const list = (requirements ?? []).filter((r) => r.category === c);
              if (list.length === 0) return null;
              return (
                <div key={c} className="mb-2">
                  <div className="sticky top-0 bg-[var(--background)] py-1 text-xs font-bold text-[var(--foreground)]">
                    {REQ_CAT_LABEL[c] ?? c}（{list.length}）
                  </div>
                  {list.map((r) => (
                    <label key={r.requirementId} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[oklch(0.975_0.012_258_/_0.7)]">
                      <input
                        type="checkbox"
                        className="neu-checkbox mt-0.5 shrink-0"
                        checked={!!linkDraft[r.requirementId]}
                        onChange={() => setLinkDraft((prev) => ({ ...prev, [r.requirementId]: !prev[r.requirementId] }))}
                      />
                      <span className="text-[var(--foreground)]">
                        {r.isStarred && <span className="mr-1 font-bold text-[var(--danger)]">★</span>}
                        {r.tenderContent || <span className="text-[var(--muted-foreground)]">（无内容）</span>}
                      </span>
                    </label>
                  ))}
                </div>
              );
            })
          )}
        </Modal>
      )}
    </div>
  );
}
