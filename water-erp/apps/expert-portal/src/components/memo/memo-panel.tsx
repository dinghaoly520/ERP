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
  projectId, supplierId, scorePointId, scorePointName,
  compact, sourceDevice = 'tablet', defaultMode,
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
      const list = await listMemos(projectId, supplierId, scorePointId);
      setMemos(list);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '加载备忘失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, supplierId, scorePointId]);

  useEffect(() => { load(); }, [load]);

  // P1-13：切换（供应商, 得分点）复合追踪——供应商切换也走「捕获旧→清屏→恢复新」，消除跨供应商串用墨迹
  const prevRef = useRef({ supplierId, scorePointId });
  const switchToken = useRef(0);
  useEffect(() => {
    const prev = prevRef.current;
    const cur = { supplierId, scorePointId };
    prevRef.current = cur;
    const prevKey = `${prev.supplierId}:${prev.scorePointId}`;
    const curKey = `${cur.supplierId}:${cur.scorePointId}`;
    // 首次渲染（供应商与得分点均未变）→ 尝试恢复缓存墨迹
    if (prevKey === curKey) {
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
    // ★ 同步捕获：矢量笔触（全屏切换用）+ dataURL（API 保存用）
    let capturedStrokes: Stroke[] | null = null;
    let dataURL = '';
    if (mode === 'handwriting' && c && !c.isEmpty()) {
      capturedStrokes = c.captureStrokes();
      dataURL = c.captureDataURL();
    }
    // ★ 同步清屏
    c?.clear();

    // 异步：保存到旧（供应商, 得分点）+ 恢复新（供应商, 得分点）墨迹
    (async () => {
      // 保存旧（供应商, 得分点）（upsert：先删旧墨迹，再建新的，避免复制）
      if (dataURL) {
        try {
          const blob = await (await fetch(dataURL)).blob();
          if (switchToken.current === token && prev.scorePointId) {
            inkCache.current.set(prevKey, { strokes: capturedStrokes ?? [], blob });
          }
          // 删除旧（供应商, 得分点）已有的 ink 备忘（同一(供应商,得分点)只保留一条最新墨迹）
          if (prev.scorePointId) {
            const oldInk = memosRef.current.find(m => m.supplierId === prev.supplierId && m.scorePointId === prev.scorePointId && m.inkFileId);
            if (oldInk) {
              try { await deleteMemo(projectId, oldInk.id); } catch { /* del silent */ }
            }
          }
          await createMemo(projectId, {
            inkBlob: blob,
            sourceDevice: `${sourceDevice}_handwriting`,
            supplierId: prev.supplierId,
            scorePointId: prev.scorePointId,
          });
          // 保存后刷新列表（让删除的旧备忘 + 新备忘同步到 UI）
          load();
        } catch { /* auto-save silent */ }
      }
      // 被新切换打断 → 放弃恢复
      if (switchToken.current !== token) return;
      // 恢复新（供应商, 得分点）墨迹
      if (mode === 'handwriting' && scorePointId) {
        const cached = inkCache.current.get(curKey);
        if (cached?.strokes.length) {
          // 矢量恢复（填充 strokes.current，后续全屏切换可用）
          c?.restoreStrokes(cached.strokes);
        } else if (cached?.blob) {
          await c?.restoreBlob(cached.blob);
        } else {
          // API 兜底（位图，无 strokes）
          try {
            const list = await listMemos(projectId, supplierId, scorePointId);
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

  // 全屏 vs 内嵌 的缩放比例：坐标 0.4（字占左上角），笔触 0.6（视觉粗细一致）
  // 互逆：进全屏 *0.4/*0.6，出全屏 *2.5/*1.667 还原
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
        // upsert：先删该（供应商, 得分点）旧 ink 备忘，再建新的（同一(供应商,得分点)只留一条墨迹）—— P1-13
        if (scorePointId) {
          const oldInk = memosRef.current.find(m => m.supplierId === supplierId && m.scorePointId === scorePointId && m.inkFileId);
          if (oldInk) {
            try { await deleteMemo(projectId, oldInk.id); } catch { /* del silent */ }
          }
        }
        await createMemo(projectId, {
          inkBlob: blob,
          sourceDevice: `${sourceDevice}_handwriting`,
          supplierId, scorePointId,
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
          supplierId, scorePointId,
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
  }, [saving, mode, projectId, sourceDevice, supplierId, scorePointId, text, load]);

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

  const padY = compact ? 'py-1.5' : 'py-2';

  // 新拟态按钮共享样式（tooltip/inline 型——无外凸阴影，仅 hover/active 反馈）
  const btnBase = `rounded-lg border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] px-1.5 ${padY} text-[10px] font-semibold
    transition-all duration-150
    shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
    hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]
    active:shadow-[inset_0_1px_3px_oklch(0.55_0.03_258_/_.12),inset_0_-1px_0_oklch(1_0_0_/_.5)] active:translate-y-px`;

  const sliderCls = `h-1 cursor-pointer appearance-none rounded-full
    bg-[oklch(0.92_0.004_265)]
    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer
    [&::-webkit-slider-thumb]:shadow-[0_1px_2px_oklch(0.55_0.03_258_/_.15),inset_0_1px_0_oklch(1_0_0_/_.7)]`;

  // 工具栏：全屏带缩放(zoom:true)，略缩页去缩放、清屏占位(zoom:false)；清屏统一居末，点击弹 ConfirmDialog
  const renderToolbar = ({ zoom }: { zoom: boolean }) => (
    <div className="flex items-center gap-1.5">
      {/* 颜色 */}
      {COLORS.map(c => (
        <button
          key={c.value}
          type="button" title={c.label}
          onClick={() => { setCurrentColor(c.value); activeCanvas()?.setColor(c.value); }}
          className={`size-[10px] rounded-full transition-all duration-150
            shadow-[0_1px_1.5px_oklch(0.55_0.03_258_/_.12),inset_0_1px_0_oklch(1_0_0_/_.5)]
            hover:scale-110
            ${currentColor === c.value
              ? 'ring-2 ring-[#064ea2] ring-offset-1 ring-offset-white scale-110 shadow-[0_1px_2px_oklch(0.55_0.03_258_/_.2),inset_0_1px_0_oklch(1_0_0_/_.6)]'
              : ''}`}
          style={{ backgroundColor: c.value }}
        />
      ))}
      <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
      {/* 线宽滑块 */}
      <input type="range" min={2} max={12} value={currentWeight}
        onChange={e => { const v=Number(e.target.value); setCurrentWeight(v); activeCanvas()?.setWeight(v); }}
        className={`w-16 ${sliderCls} [&::-webkit-slider-thumb]:bg-[#064ea2]`}
        title="笔触粗细"
      />
      <span className="inline-flex items-center justify-center w-5 h-5 shrink-0">
        <span className="rounded-full transition-all duration-100"
          style={{ backgroundColor: currentColor, width: Math.max(2, currentWeight / 2), height: Math.max(2, currentWeight / 2) }} />
      </span>
      <span className="text-[10px] font-mono tabular-nums text-[oklch(0.45_0.01_264)] w-4 text-right">{currentWeight}</span>
      <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
      {/* 画笔/橡皮 */}
      <button
        type="button"
        onClick={() => { const next = !eraseMode; setEraseMode(next); activeCanvas()?.setMode(next ? 'erase' : 'draw'); if(next) activeCanvas()?.setEraserMul(eraserSize); }}
        className={`${btnBase} ${eraseMode ? 'text-amber-600 border-amber-200 bg-amber-50' : 'text-[oklch(0.45_0.01_265)]'}`}
      >
        <Eraser size={11} strokeWidth={1.5} />
      </button>
      {/* 橡皮大小（仅擦除模式） */}
      {eraseMode && (
        <>
          <input type="range" min={1} max={20} value={eraserSize}
            onChange={e => { const v=Number(e.target.value); setEraserSize(v); activeCanvas()?.setEraserMul(v); }}
            className={`w-14 ${sliderCls} [&::-webkit-slider-thumb]:bg-amber-500`}
            title="橡皮大小"
          />
          <span className="inline-flex items-center justify-center w-5 h-5 shrink-0">
            <span className="rounded-full border border-amber-400/60 transition-all duration-100"
              style={{ width: Math.max(3, eraserSize * 1.5), height: Math.max(3, eraserSize * 1.5) }} />
          </span>
          <span className="text-[10px] font-mono tabular-nums text-amber-600 w-4 text-right">{eraserSize}</span>
        </>
      )}
      <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
      {/* 撤销 */}
      <button type="button" onClick={() => activeCanvas()?.undo()}
        className={`${btnBase} text-[oklch(0.45_0.01_265)]`} title="撤销上一笔">
        <Undo2 size={11} strokeWidth={1.5} />
      </button>
      {/* 缩放（仅全屏） */}
      {zoom && (
        <>
          <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
          <button type="button"
            onClick={() => { const v = Math.max(0.5, zoomLevel - 0.25); setZoomLevel(v); activeCanvas()?.setZoom(v); }}
            className={`${btnBase} text-[oklch(0.45_0.01_265)]`}>
            <ZoomOut size={11} strokeWidth={1.5} />
          </button>
          <span className="text-[10px] font-mono tabular-nums text-[oklch(0.45_0.01_264)] w-[26px] text-center">{Math.round(zoomLevel * 100)}%</span>
          <button type="button"
            onClick={() => { const v = Math.min(3, zoomLevel + 0.25); setZoomLevel(v); activeCanvas()?.setZoom(v); }}
            className={`${btnBase} text-[oklch(0.45_0.01_265)]`}>
            <ZoomIn size={11} strokeWidth={1.5} />
          </button>
        </>
      )}
      <span className="w-px h-3.5 bg-[oklch(0.88_0.005_264)]" />
      {/* 清屏：弹 ConfirmDialog */}
      <button type="button"
        onClick={() => setClearConfirmOpen(true)}
        className={`${btnBase} flex items-center gap-0.5 text-[oklch(0.45_0.01_265)] hover:border-[#e74c3c]/40 hover:text-[#e74c3c]`}
        title="清空全部笔画">
        <Trash2 size={11} strokeWidth={1.5} /> 清屏
      </button>
    </div>
  );

  const fullscreenOverlay = fullscreen && mode === 'handwriting'
    ? createPortal(
      <div className="fixed inset-0 z-50 flex flex-col bg-white"
        style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        onContextMenu={e => e.preventDefault()}
        onTouchStart={e => e.preventDefault()}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2 border-b border-[oklch(0.92_0.004_265)]">
          {/* 左：退出全屏 */}
          <button
            type="button" onClick={exitFullscreen}
            className="justify-self-start flex items-center gap-1 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] px-3 py-1.5 text-xs font-semibold text-[oklch(0.45_0.01_265)]
              shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
              hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]
              active:shadow-[inset_0_1px_3px_oklch(0.55_0.03_258_/_.12)] active:translate-y-px transition-all duration-150"
          >
            <Minimize2 size={13} strokeWidth={1.5} /> 退出全屏
          </button>
          {/* 中：工具栏（含清屏），顶部居中 */}
          <div className="justify-self-center">{renderToolbar({ zoom: true })}</div>
          {/* 右：保存 */}
          <button
            type="button" onClick={doSave} disabled={saving}
            className="justify-self-end flex items-center gap-1 rounded-xl bg-[#064ea2] px-3 py-1.5 text-xs font-bold text-white
              shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.25)]
              hover:shadow-[0_2px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.3)]
              active:shadow-[inset_0_1px_3px_oklch(0.3_0.08_264_/_.4)] active:translate-y-px
              disabled:opacity-50 transition-all duration-150"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.5} />}
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        <AtramentCanvas ref={fullscreenCanvasRef} width={800} height={560} fillContainer
          className="flex-1 min-h-0 rounded-none border-0" />
      </div>,
      document.body,
    )
    : null;

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
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[oklch(0.18_0.012_265)]">
          <PenLine size={14} strokeWidth={1.5} /> 专家备忘
          {scorePointName && <span className="text-[11px] font-normal text-[#064ea2]">· {scorePointName}</span>}
        </h3>
        <div className="flex items-center gap-0 rounded-xl border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)] p-0.5
          shadow-[inset_0_1px_2px_oklch(0.55_0.03_258_/_.06)]">
          <button type="button" onClick={() => setMode('handwriting')} aria-pressed={mode === 'handwriting'}
            className={`flex items-center gap-1 rounded-lg px-2.5 ${padY} text-xs font-semibold transition-all duration-150 ${
              mode === 'handwriting'
                ? 'bg-[#064ea2] text-white shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.2)]'
                : 'text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.35_0.01_264)]'
            }`}>
            <PenLine size={12} strokeWidth={1.5} /> 手写
          </button>
          <button type="button" onClick={() => setMode('keyboard')} aria-pressed={mode === 'keyboard'}
            className={`flex items-center gap-1 rounded-lg px-2.5 ${padY} text-xs font-semibold transition-all duration-150 ${
              mode === 'keyboard'
                ? 'bg-[#064ea2] text-white shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.2)]'
                : 'text-[oklch(0.55_0.01_264)] hover:text-[oklch(0.35_0.01_264)]'
            }`}>
            <Keyboard size={12} strokeWidth={1.5} /> 键盘
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        {/* P1-14：手写/键盘两块同时挂载，用 hidden 切换可见性，避免切键盘卸载画布丢墨迹 */}
        <div className={mode === 'handwriting' ? 'flex flex-col gap-2' : 'hidden'}>
            {/* 工具栏（略缩页：去缩放，清屏占位） */}
            {renderToolbar({ zoom: false })}
            <div className="relative" style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
              onContextMenu={e => e.preventDefault()}>
              <AtramentCanvas ref={inlineCanvasRef} height={compact ? 260 : 420} />
              <button type="button" onClick={enterFullscreen}
                className="absolute right-2 top-2 rounded-lg border border-[oklch(0.92_0.004_265)] bg-[oklch(0.98_0.003_265)]/80 p-1 text-[oklch(0.45_0.01_264)] transition-all duration-150
                  shadow-[0_1px_0_oklch(1_0_0),inset_0_1px_0_oklch(1_0_0)]
                  hover:text-[#064ea2] hover:shadow-[0_2px_0_oklch(0.92_0.004_265),inset_0_1px_0_oklch(1_0_0)]"
                title="全屏手写">
                <Maximize2 size={14} strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={doSave} disabled={saving}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#064ea2] px-3 py-2.5 text-xs font-bold text-white
                  shadow-[0_1px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.25)]
                  hover:shadow-[0_2px_0_oklch(0.3_0.05_264),inset_0_1px_0_oklch(1_0_0_/_.3)]
                  active:shadow-[inset_0_1px_3px_oklch(0.3_0.08_264_/_.4)] active:translate-y-px
                  disabled:opacity-50 transition-all duration-150">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.5} />}
                {saving ? '保存中…' : '保存手写'}
              </button>
            </div>
          </div>
        <div className={mode === 'keyboard' ? 'flex flex-col gap-2' : 'hidden'}>
            <textarea
              value={text} onChange={e => setText(e.target.value)}
              rows={compact ? 5 : 7} placeholder="键入备忘内容…"
              className="w-full resize-none rounded-xl border border-[oklch(0.91_0.006_264)] px-3 py-2 text-sm focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2]"
            />
            <button type="button" onClick={doSave} disabled={saving}
              className="flex items-center justify-center gap-1 rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white hover:bg-[#054280] disabled:opacity-50">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.7} />}
              {saving ? '保存中…' : '保存文本'}
            </button>
          </div>
      </div>

      {/* 备忘列表（限制高度，内滚动，不挤压上方画布） */}
      <div className="mt-2 max-h-[28%] min-h-0 flex-shrink-0 space-y-1.5 overflow-y-auto border-t border-[oklch(0.91_0.006_264)] pt-2">
        {loading ? (
          <p className="py-3 text-center text-xs text-[oklch(0.62_0.008_264)]">加载中…</p>
        ) : memos.length === 0 ? (
          <p className="py-3 text-center text-xs text-[oklch(0.62_0.008_264)]">暂无备忘</p>
        ) : (
          memos.map(m => (
            <div key={m.id} className="rounded-lg border border-[oklch(0.91_0.006_264)] bg-white px-2.5 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {m.contentText ? (
                    <p className="line-clamp-2 break-words text-xs text-[oklch(0.18_0.012_265)]">{m.contentText}</p>
                  ) : m.inkFileId ? (
                    <button type="button" onClick={() => openInkUrl(m.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#064ea2] hover:underline">
                      <ExternalLink size={11} strokeWidth={1.7} /> 查看墨迹原图
                    </button>
                  ) : (
                    <span className="text-xs italic text-[oklch(0.62_0.008_264)]">（空备忘）</span>
                  )}
                  <div className="mt-0.5 text-[10px] text-[oklch(0.62_0.008_264)]">
                    {new Date(m.createdAt).toLocaleString('zh-CN')}
                    {m.sourceDevice && ` · ${memoDeviceLabel(m.sourceDevice)}`}
                  </div>
                </div>
                <button type="button" onClick={() => setDeleteTargetId(m.id)} aria-label="删除备忘"
                  className="shrink-0 rounded p-1 text-[oklch(0.62_0.008_264)] hover:bg-red-50 hover:text-red-500">
                  <Trash2 size={12} strokeWidth={1.7} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
