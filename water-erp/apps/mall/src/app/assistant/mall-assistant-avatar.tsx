'use client';

import type { MallAssistantExpression } from './types';
import { motion } from 'framer-motion';

const imageByExpression: Record<MallAssistantExpression, string> = {
  normal: 'normal',
  thinking: 'thinking',
  serious: 'serious',
};

interface MallAssistantAvatarProps {
  expression?: MallAssistantExpression;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  animated?: boolean;
}

const sizeClasses: Record<NonNullable<MallAssistantAvatarProps['size']>, string> = {
  sm: 'h-9 w-9',
  md: 'h-14 w-14',
  lg: 'h-20 w-20',
};

export function MallAssistantAvatar({ expression = 'normal', size = 'md', className = '', animated = false }: MallAssistantAvatarProps) {
  const src = `/DingDang/${imageByExpression[expression]}_${size}.webp`;

  const isThinking = expression === 'thinking';
  const isSerious = expression === 'serious';

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${sizeClasses[size]} ${className}`}>
      {/* 外层流光扫描环 */}
      {animated && (
        <motion.span
          className="absolute -inset-[6px] rounded-full pointer-events-none"
          animate={{ rotate: 360 }}
          transition={{ duration: isThinking ? 4 : 8, repeat: Infinity, ease: 'linear' }}
          style={{
            background: 'conic-gradient(from 0deg, transparent 0deg, rgba(91,155,213,.18) 40deg, rgba(139,92,246,.12) 90deg, transparent 140deg, transparent 360deg)',
            mask: 'radial-gradient(circle, transparent 64%, black 65%, black 70%, transparent 71%)',
            WebkitMask: 'radial-gradient(circle, transparent 64%, black 65%, black 70%, transparent 71%)',
          }}
        />
      )}

      {/* 第二层反向旋转环 */}
      {animated && isThinking && (
        <motion.span
          className="absolute -inset-[3px] rounded-full pointer-events-none"
          animate={{ rotate: -360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          style={{
            background: 'conic-gradient(from 180deg, transparent 0deg, rgba(99,102,241,.15) 30deg, rgba(59,130,246,.10) 70deg, transparent 120deg, transparent 360deg)',
            mask: 'radial-gradient(circle, transparent 61%, black 62%, black 66%, transparent 67%)',
            WebkitMask: 'radial-gradient(circle, transparent 61%, black 62%, black 66%, transparent 67%)',
          }}
        />
      )}

      {/* 四角信号点 */}
      {animated && (
        <>
          {[0, 90, 180, 270].map(angle => (
            <motion.span
              key={angle}
              className="absolute h-1.5 w-1.5 rounded-full pointer-events-none"
              style={{
                background: isThinking ? 'rgba(99,102,241,.7)' : 'rgba(91,155,213,.55)',
                top: '50%',
                left: '50%',
                transform: `rotate(${angle}deg) translateY(-${size === 'lg' ? 44 : size === 'md' ? 31 : 20}px) translateX(-50%)`,
                boxShadow: isThinking
                  ? '0 0 6px rgba(99,102,241,.5), 0 0 12px rgba(99,102,241,.25)'
                  : '0 0 4px rgba(91,155,213,.4), 0 0 8px rgba(91,155,213,.2)',
              }}
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
              transition={{ duration: 2 + angle * 0.02, repeat: Infinity, delay: angle * 0.002, ease: 'easeInOut' }}
            />
          ))}
        </>
      )}

      {/* 主头像 - 磨砂玻璃底 */}
      <span
        className={`relative inline-flex shrink-0 items-center justify-center rounded-full p-[2px] shadow-[0_8px_24px_rgba(6,78,162,.15),0_0_0_1px_rgba(255,255,255,.25)_inset] ${sizeClasses[size]} ${animated ? 'animate-dingdang-breathe' : ''}`}
        style={{
          background: isSerious
            ? 'linear-gradient(135deg, rgba(249,115,22,.3), rgba(234,179,8,.2), rgba(91,155,213,.3))'
            : isThinking
            ? 'linear-gradient(135deg, rgba(139,92,246,.35), rgba(99,102,241,.25), rgba(59,130,246,.3), rgba(139,92,246,.35))'
            : 'radial-gradient(circle at 35% 25%, rgba(232,244,255,.95), rgba(120,184,255,.75) 48%, rgba(54,116,214,.65))',
        }}
      >
        {/* 镜面高光 */}
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,.7),transparent_34%)]" />
        <img src={src} alt="水叮当" className="relative h-full w-full rounded-full object-contain" />
      </span>
    </span>
  );
}
