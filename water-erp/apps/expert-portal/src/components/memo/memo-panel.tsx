'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  Eraser, ExternalLink, Keyboard, Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut,
  PenLine, Save, Trash2, Undo2,
} from 'lucide-react';
import { AtramentCanvas, type AtramentCanvasHandle, type Stroke } from './atrament-canvas';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  createMemo, deleteMemo, getMemoInkUrl, listMemos,
} from '@/lib/api';
import type { ExpertMemo } from '@water-erp/shared';

interface MemoPanelProps {
  projectId: string;
  supplierId?: string;
  scoreItemId?: string;
  /** 得分点 id + 名称（得分点粒度备忘） */
  scorePointId?: string;
  scorePointName?: string;
  compact?: boolean;
  sourceDevice?: 'tablet' | 'desktop';
  defaultMode?: Mode;
  /** true=无 scorePointId 时禁用输入（平板）；false/省略=始终允许（桌面） */
  requirePointSelection?: boolean;
  /** memo 列表加载/增删后回调，供父组件更新角标 */
  onMemoCountChange?: (pointId: string, count: number) => void;
}

type Mode = 'handwriting' | 'keyboard';

const COLORS = [
  { value: '#064ea2', label: '蓝' },
  { value: '#000000', label: '黑' },
  { value: '#e74c3c', label: '红' },
];
function memoDeviceLabel(sourceDevice: string): string {
  const [device, input] = sourceDevice.split('_');
  const dl = device === 'desktop' ? '桌面' : device === 'tablet' ? '平板' : device;
  const il = input === 'handwriting' ? '手写' : input === 'keyboard' ? '键盘' : input;
  return `${dl}·${il}`;
}

export function MemoPanel({
  projectId, supplierId, scoreItemId, scorePointId, scorePointName,
  compact, sourceDevice = 'tablet', defaultMode,
  requirePointSelection = false, onMemoCountChange,
}: MemoPanelProps) {
  const [mode, setMode] = useState<Mode>(defaultMode ?? (sourceDevice === 'desktop' ? 'keyboard' : 'handwriting'));
  const [text, setText] = useState('');
  const [memos, setMemos] = useState<ExpertMemo[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  // 清屏二次确认弹窗（拟态 ConfirmDialog）
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // 删除备忘二次确认弹窗：存待删备忘 id
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [currentColor, setCurrentColor] = useState('#000000');
  const [currentWeight, setCurrentWeight] = useState(6);
  const [eraseMode, setEraseMode] = useState(false);
  const [eraserSize, setEraserSize] = useState(3);
  const [zoomLevel, setZoomLevel] = useState(1);
  const inlineCanvasRef = useRef<AtramentCanvasHandle>(null);
  const fullscreenCanvasRef = useRef<AtramentCanvasHandle>(null);
  // 全屏切换时暂存矢量笔触，在新 canvas mount 后恢复
  const pendingStrokes = useRef<Stroke[] | null>(null);
  // P1-12：无矢量笔触（位图恢复的墨迹）时，全屏切换用 blob 兜底转移
  const pendingBlob = useRef<Blob | null>(null);
  // 得分点 → 墨迹缓存（strokes 矢量 + blob 位图）。恢复优先用 strokes（支持全屏矢量转移）
  const inkCache = useRef<Map<string, { strokes: Stroke[]; blob: Blob }>>(new Map());
  // memos 列表的 ref 镜像，供异步闭包读取最新值（避免 stale closure）
  const memosRef = useRef<ExpertMemo[]>([]);
  useEffect(() => { memosRef.current = memos; }, [memos]);

  // 获取当前活跃的画布（全屏/内嵌）
  const activeCanvas = () => fullscreen ? fullscreenCanvasRef.current : inlineCanvasRef.current;

  // 得分点粒度 reload（仅加载备忘列表，画布恢复由 switch effect 统一处理）
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMemos(projectId, supplierId, scorePointId, scoreItemId);
      setMemos(list);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '加载备忘失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, supplierId, scorePointId, scoreItemId]);

  useEffect(() => { load(); }, [load]);

  // 批注计数回调
  useEffect(() => {
    if (scorePointId && onMemoCountChange) {
      onMemoCountChange(scorePointId, memos.length);
    }
  }, [scorePointId, memos.length, onMemoCountChange]);

  // 切换（供应商, 得分点）→ 清屏 + 恢复新得分点墨迹
  const prevRef = useRef({ supplierId, scorePointId });
  const switchToken = useRef(0);
  useEffect(() => {
    const prev = prevRef.current;
    const cur = { supplierId, scorePointId };
    prevRef.current = cur;
    const prevKey = `${prev.supplierId}:${prev.scorePointId}`;
    const curKey = `${cur.supplierId}:${cur.scorePointId}`;
    if (prevKey === curKey) {
      // 首次渲染 → 尝试恢复缓存墨迹
      const c0 = activeCanvas();
      if (mode === 'handwriting' && c0 && c0.isEmpty() && scorePointId) {
        const cached = inkCache.current.get(curKey);
        if (cached?.strokes.length) c0.restoreStrokes(cached.strokes);
        else if (cached?.blob) c0.restoreBlob(cached.blob).catch(() => {});
      }
      return;
    }
    const token = ++switchToken.current;
    const c = activeCanvas();
    c?.clear();

    // 恢复新得分点墨迹
    (async () => {
      if (switchToken.current !== token) return;
      if (mode === 'handwriting' && scorePointId) {
        const cached = inkCache.current.get(curKey);
        if (cached?.strokes.length) {
          c?.restoreStrokes(cached.strokes);
        } else if (cached?.blob) {
          await c?.restoreBlob(cached.blob);
        } else {
          // API 兜底
          try {
            const list = await listMemos(projectId, supplierId, scorePointId, scoreItemId);
            const latestInk = list.find(m => m.inkFileId);
            if (latestInk?.inkFileId) {
              const { url } = await getMemoInkUrl(projectId, latestInk.id);
              const res = await fetch(url);
              if (res.ok) {
                const blob = await res.blob();
                inkCache.current.set(curKey, { strokes: [], blob });
                if (switchToken.current === token) await c?.restoreBlob(blob);
              }
            }
          } catch { /* restore silent */ }
        }
      }
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scorePointId, supplierId]);

  // 全屏 vs 内嵌 的缩放比例：坐标 0.4（字占左上角），笔触 0.45（视觉粗细一致）
  // 互逆：进全屏 *0.4/*0.45，出全屏 *2.5/*2.222 还原
  const COORD_SCALE = 0.4;
  const WEIGHT_SCALE = 0.45;

  // 全屏切换后恢复矢量笔触（rAF 同步恢复，无取消机制，避免 cleanup 吞掉恢复）
  useEffect(() => {
    // P1-12：位图墨迹兜底转移（无矢量笔触时）
    if (pendingBlob.current) {
      const b = pendingBlob.current; pendingBlob.current = null;
      const target = fullscreen ? fullscreenCanvasRef.current : inlineCanvasRef.current;
      if (target) requestAnimationFrame(() => target.restoreBlob(b));
      return;
    }
    if (!pendingStrokes.current) return;
    const src = pendingStrokes.current;
    pendingStrokes.current = null;
    const target = fullscreen ? fullscreenCanvasRef.current : inlineCanvasRef.current;
    if (!target) return;
    // 进全屏缩小，出全屏放大还原（坐标与笔触各自互逆）
    const cs = fullscreen ? COORD_SCALE : 1 / COORD_SCALE;
    const ws = fullscreen ? WEIGHT_SCALE : 1 / WEIGHT_SCALE;
    requestAnimationFrame(() => target.restoreStrokes(src, cs, ws));
  }, [fullscreen]);

  const enterFullscreen = async () => {
    const c = inlineCanvasRef.current;
    const hasInk = c && !c.isEmpty();
    const strokes = hasInk ? c.captureStrokes() : null;
    let blob: Blob | null = null;
    if (hasInk && (!strokes || strokes.length === 0)) blob = (await c.toBlob()) ?? null; // P1-12：位图兜底
    c?.clear();
    if (strokes && strokes.length) pendingStrokes.current = strokes;
    else if (blob) pendingBlob.current = blob;
    setFullscreen(true);
    // 全屏笔触按 WEIGHT_SCALE 缩小，新画的字与恢复的字粗细一致
    const fsWeight = Math.max(2, +(currentWeight * WEIGHT_SCALE).toFixed(1));
    setCurrentWeight(fsWeight);
    requestAnimationFrame(() => fullscreenCanvasRef.current?.setWeight(fsWeight));
  };

  const exitFullscreen = async () => {
    const c = fullscreenCanvasRef.current;
    const hasInk = c && !c.isEmpty();
    const strokes = hasInk ? c.captureStrokes() : null;
    let blob: Blob | null = null;
    if (hasInk && (!strokes || strokes.length === 0)) blob = (await c.toBlob()) ?? null; // P1-12：位图兜底
    c?.clear();
    if (strokes && strokes.length) pendingStrokes.current = strokes;
    else if (blob) pendingBlob.current = blob;
    setFullscreen(false);
    // 退出恢复内嵌笔触（全屏 weight / WEIGHT_SCALE = 原值）
    const inlineWeight = Math.max(2, +(currentWeight / WEIGHT_SCALE).toFixed(1));
    setCurrentWeight(inlineWeight);
    requestAnimationFrame(() => inlineCanvasRef.current?.setWeight(inlineWeight));
  };

  const doSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === 'handwriting') {
        const c = activeCanvas();
        if (c?.isEmpty()) {
          toast.warning('请先在手写区书写内容');
          return;
        }
        // 同步捕获矢量（缓存用，保持全屏切换清晰）
        const strokes = c?.captureStrokes() ?? [];
        const blob = await c?.toBlob();
        if (!blob) { toast.error('墨迹导出失败'); return; }
        await createMemo(projectId, {
          inkBlob: blob,
          sourceDevice: `${sourceDevice}_handwriting`,
          supplierId, scoreItemId, scorePointId,
        });
        // 更新本地缓存（复合键：供应商+得分点）
        if (scorePointId) inkCache.current.set(`${supplierId}:${scorePointId}`, { strokes, blob });
        c?.clear();
      } else {
        const trimmed = text.trim();
        if (!trimmed) { toast.warning('请输入备忘内容'); return; }
        await createMemo(projectId, {
          contentText: trimmed,
          sourceDevice: `${sourceDevice}_keyboard`,
          supplierId, scoreItemId, scorePointId,
        });
        setText('');
      }
      toast.success('备忘已保存');
      await load();
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }, [saving, mode, projectId, sourceDevice, supplierId, scoreItemId, scorePointId, text, load]);

  const handleDelete = async (memoId: string) => {
    try {
      await deleteMemo(projectId, memoId);
      setMemos(prev => prev.filter(m => m.id !== memoId));
      toast.success('已删除');
    } catch (e) { toast.error('删除失败'); }
  };

  const openInkUrl = async (memoId: string) => {
    try {
      const { url } = await getMemoInkUrl(projectId, memoId);
      window.open(url, '_blank', 'noopener');
    } catch (e) { toast.error('获取墨迹失败'); }
  };

  // 点击历史备忘 → 载入编辑区
  const recallMemo = async (memo: ExpertMemo) => {
    if (memo.inkFileId) {
      setMode('handwriting');
      try {
        const { url } = await getMemoInkUrl(projectId, memo.id);
        const res = await fetch(url);
        if (res.ok) {
          const blob = await res.blob();
          if (scorePointId) inkCache.current.set(`${supplierId}:${scorePointId}`, { strokes: [], blob });
          await activeCanvas()?.restoreBlob(blob);
        }
      } catch { toast.error('载入墨迹失败'); }
    } else if (memo.contentText) {
      setText(memo.contentText);
      setMode('keyboard');
    }
  };

  // cgzxui 工具栏图标按钮（36px 方形凸起，平板触控友好）
  const toolBtn = 'neu-btn-xs is-square !h-9 !w-9';

  const sliderCls = `h-1.5 cursor-pointer appearance-none rounded-full
    bg-[oklch(0.96_0.01_258)]
    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer
    [&::-webkit-slider-thumb]:shadow-[2px_2px_4px_oklch(0.55_0.03_258/0.2),inset_0_1px_0_oklch(1_0_0/0.5)]`;

  // 工具栏：全屏带缩放(zoom:true)，略缩页去缩放、清屏占位(zoom:false)；清屏统一居末，点击弹 ConfirmDialog
  const renderToolbar = ({ zoom }: { zoom: boolean }) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* 颜色 */}
      {COLORS.map(c => (
        <button
          key={c.value}
          type="button" title={c.label}
          onClick={() => { setCurrentColor(c.value); activeCanvas()?.setColor(c.value); }}
          className={`neu-btn-xs is-square !h-9 !w-9 ${
            currentColor === c.value
              ? '!bg-[oklch(0.96_0.04_251/0.5)] shadow-[inset_1.5px_1.5px_3px_oklch(0.55_0.03_258/0.14),inset_-1px_-1px_2px_oklch(1_0_0/0.5)]'
              : ''
          }`}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--c)]" style={{ '--c': c.value } as React.CSSProperties} />
        </button>
      ))}
      <span className="h-4 w-px bg-[oklch(0.6_0.04_258/0.2)]" />
      {/* 线宽滑块 */}
      <input type="range" min={2} max={12} value={currentWeight}
        onChange={e => { const v=Number(e.target.value); setCurrentWeight(v); activeCanvas()?.setWeight(v); }}
        className={`w-20 ${sliderCls} [&::-webkit-slider-thumb]:bg-[var(--accent-strong)]`}
        title="笔触粗细"
      />
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
        <span
          className="h-[var(--d)] w-[var(--d)] rounded-full bg-[var(--c)] transition-all duration-100"
          style={{ '--c': currentColor, '--d': `${Math.max(2, currentWeight / 2)}px` } as React.CSSProperties}
        />
      </span>
      <span className="w-5 text-right text-[10px] font-mono tabular-nums text-[var(--muted-foreground)]">{currentWeight}</span>
      <span className="h-4 w-px bg-[oklch(0.6_0.04_258/0.2)]" />
      {/* 画笔/橡皮 */}
      <button
        type="button"
        onClick={() => { const next = !eraseMode; setEraseMode(next); activeCanvas()?.setMode(next ? 'erase' : 'draw'); if(next) activeCanvas()?.setEraserMul(eraserSize); }}
        aria-pressed={eraseMode}
        title={eraseMode ? '橡皮擦（开）' : '橡皮擦'}
        className={`${toolBtn} ${eraseMode ? 'is-warning !bg-[oklch(0.96_0.05_83/0.45)] shadow-[inset_1.5px_1.5px_3px_oklch(0.55_0.03_258/0.14),inset_-1px_-1px_2px_oklch(1_0_0/0.5)]' : ''}`}
      >
        <Eraser size={14} strokeWidth={1.5} />
      </button>
      {/* 橡皮大小（仅擦除模式） */}
      {eraseMode && (
        <>
          <input type="range" min={1} max={20} value={eraserSize}
            onChange={e => { const v=Number(e.target.value); setEraserSize(v); activeCanvas()?.setEraserMul(v); }}
            className={`w-16 ${sliderCls} [&::-webkit-slider-thumb]:bg-[var(--warning)]`}
            title="橡皮大小"
          />
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center">
            <span
              className="h-[var(--d)] w-[var(--d)] rounded-full bg-[oklch(0.95_0.05_83/0.5)] transition-all duration-100"
              style={{ '--d': `${Math.max(3, eraserSize * 1.5)}px` } as React.CSSProperties}
            />
          </span>
          <span className="w-5 text-right text-[10px] font-mono tabular-nums text-[var(--warning)]">{eraserSize}</span>
        </>
      )}
      <span className="h-4 w-px bg-[oklch(0.6_0.04_258/0.2)]" />
      {/* 撤销 */}
      <button type="button" onClick={() => activeCanvas()?.undo()} className={toolBtn} title="撤销上一笔">
        <Undo2 size={14} strokeWidth={1.5} />
      </button>
      {/* 缩放（仅全屏） */}
      {zoom && (
        <>
          <span className="h-4 w-px bg-[oklch(0.6_0.04_258/0.2)]" />
          <button type="button"
            onClick={() => { const v = Math.max(0.5, zoomLevel - 0.25); setZoomLevel(v); activeCanvas()?.setZoom(v); }}
            className={toolBtn} title="缩小">
            <ZoomOut size={14} strokeWidth={1.5} />
          </button>
          <span className="w-[34px] text-center text-[10px] font-mono tabular-nums text-[var(--muted-foreground)]">{Math.round(zoomLevel * 100)}%</span>
          <button type="button"
            onClick={() => { const v = Math.min(3, zoomLevel + 0.25); setZoomLevel(v); activeCanvas()?.setZoom(v); }}
            className={toolBtn} title="放大">
            <ZoomIn size={14} strokeWidth={1.5} />
          </button>
        </>
      )}
      <span className="h-4 w-px bg-[oklch(0.6_0.04_258/0.2)]" />
      {/* 清屏：弹 ConfirmDialog */}
      <button type="button"
        onClick={() => setClearConfirmOpen(true)}
        className="neu-btn-xs is-danger !h-9"
        title="清空全部笔画">
        <Trash2 size={13} strokeWidth={1.5} /> 清屏
      </button>
    </div>
  );

  const fullscreenOverlay = fullscreen && mode === 'handwriting'
    ? createPortal(
      <div className="fixed inset-0 z-50 flex select-none flex-col bg-[var(--background)] [-webkit-touch-callout:none]"
        onContextMenu={e => e.preventDefault()}
        onTouchStart={e => e.preventDefault()}>
        <div className="exp-topbar relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2.5">
          {/* 左：退出全屏 */}
          <button type="button" onClick={exitFullscreen} className="neu-btn-soft !h-11 justify-self-start">
            <Minimize2 size={15} strokeWidth={1.6} /> 退出全屏
          </button>
          {/* 中：工具栏（含清屏），顶部居中 */}
          <div className="justify-self-center">{renderToolbar({ zoom: true })}</div>
          {/* 右：保存 */}
          <button type="button" onClick={doSave} disabled={saving} className="neu-btn-primary !h-11 justify-self-end">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} strokeWidth={1.6} />}
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        <AtramentCanvas ref={fullscreenCanvasRef} width={800} height={560} fillContainer
          className="min-h-0 flex-1 !rounded-none"
          onNonPenHint={() => toast.info('手写模式请使用触控笔')} />
      </div>,
      document.body,
    )
    : null;

  const inputDisabled = requirePointSelection && !scorePointId;

  return (
    <section className="flex h-full flex-col">
      {fullscreenOverlay}
      <ConfirmDialog
        open={clearConfirmOpen}
        title="清空全部笔画"
        message="将清空当前画布上所有手写内容，此操作不可撤销。"
        confirmText="清空"
        cancelText="取消"
        danger
        onConfirm={() => {
          activeCanvas()?.clear();
          setClearConfirmOpen(false);
        }}
        onCancel={() => setClearConfirmOpen(false)}
      />
      <ConfirmDialog
        open={deleteTargetId !== null}
        title="删除备忘"
        message="确认删除该条备忘？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        danger
        onConfirm={async () => {
          const id = deleteTargetId;
          setDeleteTargetId(null);
          if (id) await handleDelete(id);
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-[var(--foreground)]">
          <PenLine size={15} strokeWidth={1.6} className="shrink-0 text-[var(--accent-strong)]" />
          <span className="truncate">{scorePointName ? `${scorePointName} · 批注记录` : '专家备忘'}</span>
          {scorePointName && (
            <span className="exp-pill max-w-[160px] truncate" style={{ '--c': 'var(--accent-strong)' } as React.CSSProperties}>
              {scorePointName}
            </span>
          )}
        </h3>
        <div className="neu-tab-bar flex-shrink-0">
          <button type="button" onClick={() => setMode('handwriting')} aria-pressed={mode === 'handwriting'}
            className={`neu-tab !py-2.5 ${mode === 'handwriting' ? 'is-active' : ''}`}>
            <PenLine size={13} strokeWidth={1.6} /> 手写
          </button>
          <button type="button" onClick={() => setMode('keyboard')} aria-pressed={mode === 'keyboard'}
            className={`neu-tab !py-2.5 ${mode === 'keyboard' ? 'is-active' : ''}`}>
            <Keyboard size={13} strokeWidth={1.6} /> 键盘
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        {/* P1-14：手写/键盘两块同时挂载，用 hidden 切换可见性，避免切键盘卸载画布丢墨迹 */}
        <div className={mode === 'handwriting' ? 'flex flex-col gap-2.5' : 'hidden'}>
            {inputDisabled && (
              <div className="flex items-center justify-center rounded-xl bg-[oklch(0.97_0.01_258/0.6)] py-8 text-sm font-semibold text-[var(--muted-foreground)]">
                ← 请先选择左侧得分点
              </div>
            )}
            {!inputDisabled && (
              <>
                {/* 工具栏（略缩页：去缩放，清屏占位） */}
                {renderToolbar({ zoom: false })}
                <div className="relative select-none [-webkit-touch-callout:none]" onContextMenu={e => e.preventDefault()}>
                  <AtramentCanvas ref={inlineCanvasRef} height={compact ? 260 : 420} onNonPenHint={() => toast.info('手写模式请使用触控笔')} />
                  <button type="button" onClick={enterFullscreen}
                    className="neu-btn-xs is-square absolute right-2 top-2 !h-10 !w-10"
                    title="全屏手写">
                    <Maximize2 size={15} strokeWidth={1.6} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={doSave} disabled={saving}
                    className="neu-btn-primary !h-11 flex-1">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} strokeWidth={1.6} />}
                    {saving ? '保存中…' : '保存手写'}
                  </button>
                </div>
              </>
            )}
          </div>
        <div className={mode === 'keyboard' ? 'flex flex-col gap-2.5' : 'hidden'}>
            <textarea
              value={text} onChange={e => setText(e.target.value)}
              rows={compact ? 5 : 7} placeholder={inputDisabled ? '请先选择得分点' : '键入备忘内容…'}
              disabled={inputDisabled}
              className="neu-input resize-none text-sm disabled:opacity-60"
            />
            <button type="button" onClick={doSave} disabled={saving || inputDisabled}
              className="neu-btn-primary !h-11 disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} strokeWidth={1.6} />}
              {saving ? '保存中…' : '保存文本'}
            </button>
          </div>
      </div>

      {/* 备忘列表（限制高度，内滚动，不挤压上方画布） */}
      <hr className="wb-section-rule mb-2 mt-3 flex-shrink-0" />
      <div className="max-h-[28%] min-h-0 flex-shrink-0 space-y-1.5 overflow-y-auto">
        {loading ? (
          <p className="py-3 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
        ) : memos.length === 0 ? (
          <p className="py-3 text-center text-xs text-[var(--muted-foreground)]">暂无备忘</p>
        ) : (
          memos.map(m => (
            <div key={m.id} className="neu-attachment-item cursor-pointer items-start" onClick={() => recallMemo(m)}>
              <div className="min-w-0 flex-1">
                {m.contentText ? (
                  <p className="line-clamp-2 break-words text-xs text-[var(--foreground)]">{m.contentText}</p>
                ) : m.inkFileId ? (
                  <button type="button" onClick={e => { e.stopPropagation(); openInkUrl(m.id); }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-strong)] hover:underline">
                    <ExternalLink size={11} strokeWidth={1.7} /> 查看墨迹原图
                  </button>
                ) : (
                  <span className="text-xs italic text-[var(--muted-foreground)]">（空备忘）</span>
                )}
                <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                  {new Date(m.createdAt).toLocaleString('zh-CN')}
                  {m.sourceDevice && ` · ${memoDeviceLabel(m.sourceDevice)}`}
                </div>
              </div>
              <button type="button" onClick={e => { e.stopPropagation(); setDeleteTargetId(m.id); }} aria-label="删除备忘"
                className="neu-btn-xs is-square is-danger shrink-0 !h-8 !w-8">
                <Trash2 size={13} strokeWidth={1.7} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
