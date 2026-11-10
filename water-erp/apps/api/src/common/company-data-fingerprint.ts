import type { PrismaService } from '../prisma/prisma.service';

/**
 * AI 洞察服务端缓存公共件（2026-11-10 用户裁定：按公司视野存最新一份，数据指纹
 * 未变即时提取、不重请求 LLM 生成）。消费方：ai.service 仪表盘综合分析、
 * progress.service 进度洞察——键格式/指纹口径/读写行为三处同源。
 * 存储=SystemConfig（key-value，零迁移）。
 */

/** 公司视野归一：'all'/空/逗号多选 → 稳定键段（多选排序；'all' 不当字面 id——
 *  首版实录：漏归一致聚合过滤恒空、缓存永不失效） */
export function normalizeCompanyScope(companyId?: string | null): string {
  const ids = (companyId ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'all')
    .sort();
  return ids.length === 0 ? 'all' : ids.join(',');
}

/** 缓存键：命名空间+公司集（+可选日期区间段，空=默认全区间） */
export function insightCacheKey(
  namespace: string,
  companyId?: string | null,
  startDate?: string,
  endDate?: string,
): string {
  const range = startDate || endDate ? `:${(startDate ?? '').slice(0, 10)}~${(endDate ?? '').slice(0, 10)}` : '';
  return `${namespace}:${normalizeCompanyScope(companyId)}${range}`;
}

/** 公司数据版本指纹（变更探测器，非全量等价）：轮次/PMI 项目/供应商归属链接的
 *  count+max(updatedAt) 聚合按公司集过滤——任一表数据变动指纹即变 */
export async function companyDataFingerprint(prisma: PrismaService, companyId?: string | null): Promise<string> {
  const scope = normalizeCompanyScope(companyId);
  const companyFilter = scope === 'all' ? {} : { companyId: { in: scope.split(',') } };
  const [rounds, items, links] = await Promise.all([
    prisma.procurementRound.aggregate({ where: companyFilter, _count: true, _max: { updatedAt: true } }),
    prisma.projectManagementItem.aggregate({ where: companyFilter, _count: true, _max: { updatedAt: true } }),
    prisma.supplierCompanyLink.aggregate({ where: companyFilter, _count: true, _max: { updatedAt: true } }),
  ]);
  return [
    `r${rounds._count}@${rounds._max.updatedAt?.toISOString() ?? '-'}`,
    `p${items._count}@${items._max.updatedAt?.toISOString() ?? '-'}`,
    `s${links._count}@${links._max.updatedAt?.toISOString() ?? '-'}`,
  ].join('|');
}

/** 读缓存：指纹一致 → 命中返回最新结果；miss/stale/损坏 → hit=false（携带当前指纹） */
export async function readInsightCache<T = unknown>(
  prisma: PrismaService,
  namespace: string,
  companyId?: string | null,
  startDate?: string,
  endDate?: string,
): Promise<{ hit: true; fingerprint: string; result: T; generatedAt: string } | { hit: false; fingerprint: string }> {
  const key = insightCacheKey(namespace, companyId, startDate, endDate);
  const [fingerprint, row] = await Promise.all([
    companyDataFingerprint(prisma, companyId),
    prisma.systemConfig.findUnique({ where: { key } }),
  ]);
  if (row) {
    try {
      const cached = JSON.parse(row.value) as { fingerprint: string; result: T; generatedAt: string };
      if (cached.fingerprint === fingerprint && cached.result && typeof cached.result === 'object') {
        return { hit: true, fingerprint, result: cached.result, generatedAt: cached.generatedAt };
      }
    } catch { /* 损坏缓存按 miss 处理，下次生成时覆写 */ }
  }
  return { hit: false, fingerprint };
}

/** 写缓存：按当刻指纹落存（生成成功侧调用；AI 不可用兜底结果不入库） */
export async function writeInsightCache(
  prisma: PrismaService,
  namespace: string,
  companyId: string,
  result: unknown,
  startDate?: string,
  endDate?: string,
): Promise<void> {
  const key = insightCacheKey(namespace, companyId, startDate, endDate);
  const fingerprint = await companyDataFingerprint(prisma, companyId);
  const value = JSON.stringify({ fingerprint, result, generatedAt: new Date().toISOString() });
  await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
}
