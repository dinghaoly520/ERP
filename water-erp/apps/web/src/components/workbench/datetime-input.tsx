'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * 跨浏览器日期时间输入（2026-11-26 用户裁定「不改变 Chrome 的前提下为 Safari 增加设计」）：
 * - Chrome/Edge：原生 datetime-local 原样直出（分段选择/日历带时间，体验零变化）；
 * - Safari：原生 datetime-local 的日历只落日期、时/分无面板可选（实录「无法选择时、分」）
 *   ——增强为「日期日历 + 时/分下拉」，值契约与原生控件一致（YYYY-MM-DDTHH:mm，空串=未选），
 *   调用方零改造。
 * - 浏览器检测在客户端 effect 内完成：SSR 首帧渲染原生控件，避免 hydration 错配
 *  （Safari 用户首帧见原生控件随即替换为增强形态）。
 * - 时/分用原生 select（固定数字枚举，非实体名单——瓷片选择器不适用，且 tender-write/
 *   notice 域有原生 select 保持裁定）。
 */

function detectSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Chrome/Edge 的 UA 也含 "Safari"——须排除；移动端 iOS 各浏览器均为 WebKit 内核，
  // 同样受益于增强形态
  return /Safari/i.test(ua) && !/Chrom(e|ium)|Edg\//i.test(ua);
}

const VALUE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

export function DatetimeInput({
  value,
  onChange,
  className,
  min,
  disabled,
  title,
  autoFocus,
  onKeyDown,
}: {
  /** YYYY-MM-DDTHH:mm；空串=未选（与原生 datetime-local 同契约） */
  value: string;
  onChange: (v: string) => void;
  className?: string;
  /** 同值格式；Safari 分支仅约束日期部分 */
  min?: string;
  disabled?: boolean;
  title?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  const [safari, setSafari] = useState(false);
  useEffect(() => setSafari(detectSafari()), []);

  // Safari 分支的半选状态：日期/时/分未选齐时父侧值仍为空串，本地保留已选部分
  // （否则每次重渲染会把用户刚选的日期清掉）
  const [partial, setPartial] = useState<{ d: string; h: string; mi: string } | null>(null);
  const composed = useMemo(() => value.match(VALUE_RE), [value]);
  useEffect(() => {
    if (composed) setPartial(null); // 父侧已有完整值：清本地半选，避免陈旧覆盖
  }, [composed]);

  if (!safari) {
    // Chrome/Edge：原生控件原样（不改类名/不改行为）
    return (
      <input
        type="datetime-local"
        value={value}
        min={min}
        disabled={disabled}
        title={title}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
        className={className}
      />
    );
  }

  const d = composed?.[1] ?? partial?.d ?? '';
  const h = composed?.[2] ?? partial?.h ?? '';
  const mi = composed?.[3] ?? partial?.mi ?? '';
  const setPart = (next: { d: string; h: string; mi: string }) => {
    if (next.d && next.h && next.mi) {
      setPartial(null);
      onChange(`${next.d}T${next.h}:${next.mi}`);
    } else {
      setPartial(next);
      onChange(''); // 未选齐：按契约回空（父侧校验按未填处理）
    }
  };

  const selCls = 'workbench-input !h-8 !w-auto !px-1.5 !text-xs';
  return (
    <div className="flex items-center gap-1" title={title}>
      <input
        type="date"
        value={d}
        min={min?.match(VALUE_RE)?.[1] ?? min}
        disabled={disabled}
        onChange={(e) => setPart({ d: e.target.value, h, mi })}
        className={className ? `${className} !w-auto` : className}
      />
      <select
        aria-label="时"
        value={h}
        disabled={disabled}
        onChange={(e) => setPart({ d, h: e.target.value, mi })}
        className={selCls}
      >
        <option value="">时</option>
        {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <span className="text-xs text-[var(--muted-foreground)]">:</span>
      <select
        aria-label="分"
        value={mi}
        disabled={disabled}
        onChange={(e) => setPart({ d, h, mi: e.target.value })}
        className={selCls}
      >
        <option value="">分</option>
        {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}
