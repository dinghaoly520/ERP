import { ExpertLevel } from '@prisma/client';

/** 连续 3 次 E 级（不合格）触发淘汰预警 */
export function shouldAutoDisable(recent: Array<{ finalGrade: ExpertLevel }>): boolean {
  if (recent.length < 3) return false;
  return recent.slice(0, 3).every(e => e.finalGrade === 'E');
}
