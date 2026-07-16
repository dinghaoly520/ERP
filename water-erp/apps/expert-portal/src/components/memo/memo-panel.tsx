'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Eraser, ExternalLink, Keyboard, Loader2, PenLine,
  Save, Trash2,
} from 'lucide-react';
import { HandwritingCanvas, type HandwritingCanvasHandle } from './handwriting-canvas';
import {
  createMemo, deleteMemo, getMemoInkUrl, listMemos,
} from '@/lib/api';
import type { ExpertMemo } from '@water-erp/shared';

interface MemoPanelProps {
  projectId: string;
  /** 限定供应商上下文（可选） */
  supplierId?: string;
  /** 限定评分项上下文（可选） */
  scoreItemId?: string;
  /** 紧凑模式（tablet 用更小 padding） */
  compact?: boolean;
  /** 来源设备：tablet（默认手写）/ desktop（默认键盘）。
   *  影响默认输入模式 + 落库 sourceDevice 字段（`<device>_<mode>`）。 */
  sourceDevice?: 'tablet' | 'desktop';
  /** 强制覆盖默认输入模式（默认随 sourceDevice：tablet→handwriting, desktop→keyboard） */
  defaultMode?: Mode;
}

type Mode = 'handwriting' | 'keyboard';

/** 列表展示用：`tablet_handwriting` → 「平板·手写」、`desktop_keyboard` → 「桌面·键盘」 */
function memoDeviceLabel(sourceDevice: string): string {
  const [device, input] = sourceDevice.split('_');
  const deviceLabel = device === 'desktop' ? '桌面' : device === 'tablet' ? '平板' : device;
  const inputLabel = input === 'handwriting' ? '手写' : input === 'keyboard' ? '键盘' : input;
  return input ? `${deviceLabel}·${inputLabel}` : deviceLabel;
}

/**
 * 备忘面板（Phase ⑤ Task 6）
 *
 * - 手写模式：复用 HandwritingCanvas（Task 5），保存为 PNG Blob → createMemo(inkBlob)
 * - 键盘模式：textarea → createMemo(contentText)
 * - sourceDevice 区分来源（`<device>_<mode>`：tablet_handwriting / tablet_keyboard / desktop_keyboard …），后端落库用于审计
 * - 列表：listMemos 展示文本 + 墨迹原图链接（getMemoInkUrl）+ 删除
 *
 * 说明：ink URL 打开时仅用 `noopener`（不使用 noreferrer）——
 * 若返回的是 /api 下发的代理 URL，referrer 丢失会导致 portal 识别失败返回 401。
 */
export function MemoPanel({ projectId, supplierId, scoreItemId, compact, sourceDevice = 'tablet', defaultMode }: MemoPanelProps) {
  const [mode, setMode] = useState<Mode>(defaultMode ?? (sourceDevice === 'desktop' ? 'keyboard' : 'handwriting'));
  const [text, setText] = useState('');
  const [memos, setMemos] = useState<ExpertMemo[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HandwritingCanvasHandle>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMemos(projectId, supplierId);
      setMemos(list);
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '加载备忘失败');
    } finally {
      setLoading(false);
    }
  }, [projectId, supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (mode === 'handwriting') {
        if (canvasRef.current?.isEmpty()) {
          toast.warning('请先在手写区书写内容');
          return;
        }
        const blob = await canvasRef.current?.toBlob();
        if (!blob) {
          toast.error('墨迹导出失败');
          return;
        }
        await createMemo(projectId, {
          inkBlob: blob,
          sourceDevice: `${sourceDevice}_handwriting`,
          supplierId,
          scoreItemId,
        });
        canvasRef.current?.clear();
      } else {
        const trimmed = text.trim();
        if (!trimmed) {
          toast.warning('请输入备忘内容');
          return;
        }
        await createMemo(projectId, {
          contentText: trimmed,
          sourceDevice: `${sourceDevice}_keyboard`,
          supplierId,
          scoreItemId,
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
  };

  const handleDelete = async (memoId: string) => {
    if (!confirm('确认删除该条备忘？')) return;
    try {
      await deleteMemo(projectId, memoId);
      toast.success('已删除');
      setMemos(prev => prev.filter(m => m.id !== memoId));
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '删除失败');
    }
  };

  const openInkUrl = async (memoId: string) => {
    try {
      const { url } = await getMemoInkUrl(projectId, memoId);
      // 注意：保留 Referer 以便代理下载端点识别 portal（见组件注释）
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      const err = e as { message?: string };
      toast.error(err?.message || '获取墨迹失败');
    }
  };

  const padY = compact ? 'py-1.5' : 'py-2';

  return (
    <section className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-[oklch(0.18_0.012_265)]">
          <PenLine size={14} strokeWidth={1.5} /> 专家备忘
        </h3>
        <div className="flex items-center gap-1 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white p-0.5">
          <button
            type="button"
            onClick={() => setMode('handwriting')}
            aria-pressed={mode === 'handwriting'}
            className={`flex items-center gap-1 rounded-md px-2 ${padY} text-xs font-semibold transition ${
              mode === 'handwriting'
                ? 'bg-[#064ea2] text-white'
                : 'text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]'
            }`}
          >
            <PenLine size={12} strokeWidth={1.7} /> 手写
          </button>
          <button
            type="button"
            onClick={() => setMode('keyboard')}
            aria-pressed={mode === 'keyboard'}
            className={`flex items-center gap-1 rounded-md px-2 ${padY} text-xs font-semibold transition ${
              mode === 'keyboard'
                ? 'bg-[#064ea2] text-white'
                : 'text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.97_0.005_264)]'
            }`}
          >
            <Keyboard size={12} strokeWidth={1.7} /> 键盘
          </button>
        </div>
      </div>

      {/* 输入区 */}
      <div className="flex min-h-0 flex-col">
        {mode === 'handwriting' ? (
          <div className="flex flex-col gap-2">
            <HandwritingCanvas ref={canvasRef} height={compact ? 200 : 280} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => canvasRef.current?.clear()}
                className={`flex items-center gap-1 rounded-lg border border-[oklch(0.91_0.006_264)] ${padY} px-3 text-xs font-semibold text-[oklch(0.55_0.01_264)] transition hover:bg-[oklch(0.97_0.005_264)]`}
              >
                <Eraser size={12} strokeWidth={1.7} /> 清空
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#054280] disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.7} />}
                {saving ? '保存中…' : '保存手写'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={compact ? 5 : 7}
              placeholder="键入备忘内容…"
              className="w-full resize-none rounded-xl border border-[oklch(0.91_0.006_264)] px-3 py-2 text-sm focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2]"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center justify-center gap-1 rounded-lg bg-[#064ea2] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#054280] disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} strokeWidth={1.7} />}
              {saving ? '保存中…' : '保存文本'}
            </button>
          </div>
        )}
      </div>

      {/* 列表 */}
      <div className="mt-3 max-h-[40%] flex-shrink-0 space-y-1.5 overflow-y-auto border-t border-[oklch(0.91_0.006_264)] pt-2">
        {loading ? (
          <p className="py-3 text-center text-xs text-[oklch(0.62_0.008_264)]">加载中…</p>
        ) : memos.length === 0 ? (
          <p className="py-3 text-center text-xs text-[oklch(0.62_0.008_264)]">暂无备忘</p>
        ) : (
          memos.map(m => (
            <div
              key={m.id}
              className="rounded-lg border border-[oklch(0.91_0.006_264)] bg-white px-2.5 py-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {m.contentText ? (
                    <p className="line-clamp-2 break-words text-xs text-[oklch(0.18_0.012_265)]">
                      {m.contentText}
                    </p>
                  ) : m.inkFileId ? (
                    <button
                      type="button"
                      onClick={() => openInkUrl(m.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#064ea2] hover:underline"
                    >
                      <ExternalLink size={11} strokeWidth={1.7} /> 查看墨迹原图
                    </button>
                  ) : (
                    <span className="text-xs italic text-[oklch(0.62_0.008_264)]">（空备忘）</span>
                  )}
                  <div className="mt-0.5 text-[10px] text-[oklch(0.62_0.008_264)]">
                    {new Date(m.createdAt).toLocaleString('zh-CN')}
                    {m.sourceDevice &&
                      ` · ${memoDeviceLabel(m.sourceDevice)}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(m.id)}
                  aria-label="删除备忘"
                  className="shrink-0 rounded p-1 text-[oklch(0.62_0.008_264)] transition hover:bg-red-50 hover:text-red-500"
                >
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
