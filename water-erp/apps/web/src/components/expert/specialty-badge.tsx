'use client';

import { specialtySwatch } from '@/lib/expert-specialty-tone';

/** 专业标签（2026-11-04）：12 色专业专属色板——不同专业不同色、同专业恒同色。
 *  样式结构与 StatusBadge 同构（浅底+深字+描边胶囊），但色相更丰富；
 *  专家库/排名/退库三页统一用本组件，勿各自内联。 */
export function SpecialtyBadge({ specialty }: { specialty: string }) {
  const sw = specialtySwatch(specialty);
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-5"
      style={{ color: sw.color, background: sw.bg, border: `1px solid ${sw.border}` }}
      title={specialty}
    >
      {specialty}
    </span>
  );
}
