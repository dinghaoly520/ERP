'use client';

import { useState, useRef, useEffect } from 'react';
import { Camera, Check, ScanFace } from 'lucide-react';

export type FaceRecognitionState = 'idle' | 'scanning' | 'success';

interface FaceRecognitionProps {
  userName?: string;
  onSuccess: () => void;
}

/**
 * 人脸识别核验组件（仅 UI 占位，不做实际功能）
 *
 * - 桌面端身份核验 tab：替换原短信验证码
 * - 平板端登录后独立页面
 *
 * 三态：idle（取景框）→ scanning（扫描动画 1.5s）→ success（通过）
 */
export function FaceRecognition({ userName, onSuccess }: FaceRecognitionProps) {
  const [state, setState] = useState<FaceRecognitionState>('idle');
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
  }, []);

  const handleStart = () => {
    if (state !== 'idle') return;
    setState('scanning');
    scanTimer.current = setTimeout(() => {
      setState('success');
      // 成功后短暂延迟再回调，让用户看到成功态
      setTimeout(() => onSuccess(), 600);
    }, 1800);
  };

  return (
    <div className="flex flex-col items-center">
      {/* 标题 */}
      <div className="mb-5 flex items-center gap-2.5">
        <ScanFace size={20} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
        <span className="text-sm font-bold text-[var(--foreground)]">人脸识别核验</span>
      </div>

      {/* 取景框 */}
      <div className="relative mx-auto mb-5 flex h-[200px] w-[200px] items-center justify-center">
        {/* 外框 */}
        <div
          className={`absolute inset-0 rounded-[32px] border-2 transition-colors duration-500 ${
            state === 'success'
              ? 'border-[var(--success)]'
              : state === 'scanning'
                ? 'border-[var(--accent-strong)]'
                : 'border-[var(--muted-foreground)]/30'
          }`}
        />

        {/* 四角装饰 */}
        {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => {
          const isTop = corner[0] === 't';
          const isLeft = corner[1] === 'l';
          return (
            <span
              key={corner}
              className={`absolute h-8 w-8 transition-colors duration-500 ${
                state === 'success'
                  ? 'border-[var(--success)]'
                  : state === 'scanning'
                    ? 'border-[var(--accent-strong)]'
                    : 'border-[var(--muted-foreground)]/40'
              }`}
              style={{
                [isTop ? 'top' : 'bottom']: '-1px',
                [isLeft ? 'left' : 'right']: '-1px',
                [isTop ? 'borderTop' : 'borderBottom']: `3px solid`,
                [isLeft ? 'borderLeft' : 'borderRight']: `3px solid`,
                [`${isTop ? 'borderTop' : 'borderBottom'}${isLeft ? 'Left' : 'Right'}Radius`]: '14px',
              }}
            />
          );
        })}

        {/* 内容区 */}
        <div className="relative z-10 flex flex-col items-center gap-3">
          {state === 'idle' && (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[oklch(0.96_0.01_258)]">
                <Camera size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]" />
              </div>
              <span className="text-xs text-[var(--muted-foreground)]">请将面部置于取景框内</span>
            </>
          )}

          {state === 'scanning' && (
            <>
              {/* 扫描动画 — 绿色扫描线上下移动 */}
              <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[oklch(0.96_0.03_164/0.3)]">
                <ScanFace size={28} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
                <span
                  className="absolute left-0 h-0.5 w-full animate-pulse rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, transparent, var(--success), transparent)',
                    animation: 'face-scan-line 1.2s ease-in-out infinite',
                  }}
                />
              </div>
              <span className="text-xs font-semibold text-[var(--accent-strong)]">识别中…</span>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[oklch(0.96_0.05_164/0.4)]">
                <Check size={28} strokeWidth={2.5} className="text-[var(--success)]" />
              </div>
              <span className="text-xs font-semibold text-[var(--success)]">人脸识别通过</span>
              {userName && (
                <span className="text-[11px] text-[var(--muted-foreground)]">{userName}</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      {state === 'idle' && (
        <button
          type="button"
          onClick={handleStart}
          className="neu-btn-primary !h-[42px] !px-8"
        >
          <ScanFace size={16} strokeWidth={1.5} />
          开始人脸识别
        </button>
      )}

      {state === 'scanning' && (
        <button
          type="button"
          disabled
          className="neu-btn-primary !h-[42px] !px-8 opacity-60"
        >
          <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          识别中…
        </button>
      )}

      {state === 'success' && (
        <div className="exp-alert exp-alert--success flex items-center gap-2 !px-4 !py-2.5">
          <Check size={16} strokeWidth={2} className="shrink-0" />
          <span className="text-sm font-semibold">核验通过</span>
        </div>
      )}
    </div>
  );
}
