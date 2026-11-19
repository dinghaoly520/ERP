import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * 专家库况四态派生——唯一算法源（2026-11-18 用户裁定弃 availability 镜像列；
 * 2026-11-19 审查⑵收口单源化）。
 *
 * 镜像列「占用」值写入路径已封（2026-11-19 E2：PATCH profile 删 availability 字段——
 * 详情页编辑器同步下线；抽取新轨本就不回写，曾致 6 名在册只显 2）；「停用」仍由三条
 * 正门写（setAvailability/退库/临时代表建档）——它是「不入池/不入分母」的人口过滤语义，
 * 不是库况状态。库况一律按在途项目阶段派生：
 * 正在评标 ＞ 已被抽取（正选在途）＞ 候补待命（仅候补在途）＞ 空闲。
 *
 * 消费端（改口径须同步意识）：
 *  - ExpertAdminService.getStatistics（:3005 统计页）
 *  - ExpertAdminService.getBigscreenStats（:3010 大屏，公开全库）
 *  - assistant/tools/expert.tool（水叮当 stats 概览 + search/list 状态列）
 *  - expert-ai-evaluation collectExpertFacts（AI 综合评价输入）
 *
 * 纯函数文件（仿 expert-ai-evaluation.ts）：不依赖 Nest DI，直调可测。
 */

type BusyPrisma = Pick<PrismaClient, 'expertProfile' | 'bidExpert'>;

/** 在途项目阶段（终局 ARCHIVED/ABORTED 不占库况；与库页状态列 2026-11-16 裁定同口径） */
export const IN_FLIGHT_STAGES = ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING'] as const;

/** 在途指派行（busyRows 查询产物 / BidExpert memberships 投影） */
export interface BusyRow {
  userId: string;
  expertRole: string | null;
  project: { stage: string };
}

export interface BusySets {
  evaluating: Set<string>;
  assigned: Set<string>;
  alternate: Set<string>;
  union: Set<string>;
}

/** 优先级链集合派生：同人多头衔只计高位（正在评标 supersede 一切；正选+候补双身份计正选，
 *  assigned+alternate 不超 union）。declined/终局项目行由查询侧过滤，纯函数不重复判。 */
export function deriveBusySets(rows: BusyRow[]): BusySets {
  const evaluating = new Set<string>();
  const assigned = new Set<string>();
  const alternate = new Set<string>();
  for (const b of rows) {
    if (b.project.stage === 'EVALUATING') evaluating.add(b.userId);
    else if (b.expertRole === '正选') assigned.add(b.userId);
    else alternate.add(b.userId);
  }
  for (const uid of evaluating) {
    assigned.delete(uid);
    alternate.delete(uid);
  }
  for (const uid of assigned) alternate.delete(uid);
  return {
    evaluating,
    assigned,
    alternate,
    union: new Set([...evaluating, ...assigned, ...alternate]),
  };
}

export type BusyStateLabel = '正在评标' | '已被抽取' | '候补待命' | '空闲';

export function busyStateLabel(userId: string, sets: BusySets): BusyStateLabel {
  if (sets.evaluating.has(userId)) return '正在评标';
  if (sets.assigned.has(userId)) return '已被抽取';
  if (sets.alternate.has(userId)) return '候补待命';
  return '空闲';
}

/** 单专家四态标签（list 行 / AI 评价输入用）：传入该专家的在途候选行——终局阶段行
 *  内部过滤（调用方只须滤 declined），无在途行 → 空闲。 */
export function busyStateOf(
  rows: Array<{ expertRole: string | null; project: { stage: string } }>,
): BusyStateLabel {
  const inFlight = rows.filter((r) => (IN_FLIGHT_STAGES as readonly string[]).includes(r.project.stage));
  const sets = deriveBusySets(inFlight.map((r) => ({ ...r, userId: 'me' })));
  return busyStateLabel('me', sets);
}

export interface BusyCounts {
  /** 空闲 = 库内可抽取人口 − 在途并集 */
  idle: number;
  assigned: number;
  evaluating: number;
  alternate: number;
  /** 在途并集人数（occupied） */
  occupied: number;
  /** 分母：库内可抽取人口（ACTIVE+非停用+在编，2026-11-19 裁定⑴） */
  inLibraryActive: number;
}

/** 库况数字派生：分母 groupBy（ACTIVE+非停用）与在途并集查询**两侧同人口过滤**
 *  （2026-11-19 裁定⑴——临时需求方代表经 BidExpert 绑定项目但非库内可抽取人口，单侧
 *  过滤会让 idle 被 Math.max 静默钳低、idle+occupied 不再还原分母）。
 *  userWhere = 视野过滤片段（专家库公司隔离 f / 水叮当 companyWhere / 大屏空视野）。 */
export async function deriveBusyCounts(
  prisma: BusyPrisma,
  userWhere: Prisma.UserWhereInput,
): Promise<BusyCounts> {
  const [availGroups, busyRows] = await Promise.all([
    prisma.expertProfile.groupBy({
      by: ['availability'],
      where: { entryStatus: 'ACTIVE', availability: { not: '停用' }, user: userWhere },
      _count: true,
    }),
    prisma.bidExpert.findMany({
      where: {
        invitationStatus: { not: 'declined' }, // 除名口径：婉拒不占状态
        project: { stage: { in: [...IN_FLIGHT_STAGES] } },
        user: {
          ...userWhere,
          expertProfile: { entryStatus: 'ACTIVE', availability: { not: '停用' } },
        },
      },
      select: { userId: true, expertRole: true, project: { select: { stage: true } } },
    }),
  ]);
  const inLibraryActive = availGroups.reduce(
    (sum, g) => sum + (g as unknown as { _count: number })._count,
    0,
  );
  const sets = deriveBusySets(busyRows as BusyRow[]);
  const idle = Math.max(0, inLibraryActive - sets.union.size);
  return {
    idle,
    assigned: sets.assigned.size,
    evaluating: sets.evaluating.size,
    alternate: sets.alternate.size,
    occupied: sets.union.size,
    inLibraryActive,
  };
}
