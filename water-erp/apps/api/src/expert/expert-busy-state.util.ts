import type { Prisma, PrismaClient } from '@prisma/client';
import {
  IN_FLIGHT_STAGES,
  deriveBusySets,
  BusyRow,
} from '@water-erp/shared';

/**
 * 专家库况四态派生——api 侧算法源（2026-11-18 用户裁定弃 availability 镜像列；
 * 2026-11-19 审查⑵收口单源化；**2026-11-20 跨端待办收口：四态引擎与池外优先链
 * 上移 @water-erp/shared/expert-lifecycle（web 详情页徽标同链消费），本文件 re-export**）。
 *
 * 镜像列「占用」值写入路径已封（2026-11-19 E2：PATCH profile 删 availability 字段——
 * 详情页编辑器同步下线；抽取新轨本就不回写，曾致 6 名在册只显 2）；「停用」仍由三条
 * 正门写（setAvailability/退库/临时代表建档）——它是「不入池/不入分母」的人口过滤语义，
 * 不是库况状态。库况一律按在途项目阶段派生：
 * 正在评标 ＞ 已被抽取（正选在途）＞ 候补待命（仅候补在途）＞ 空闲。
 *
 * deriveBusyCounts 消费端（改口径须同步意识）：
 *  - ExpertAdminService.getStatistics（:3005 统计页）
 *  - ExpertAdminService.getBigscreenStats（:3010 大屏，公开全库）
 *  - assistant/tools/expert.tool（水叮当 stats 概览 + search/list 状态列）
 *  - assistant/assistant.service getQuickStats（水叮当首页磁贴，E6 新增——deriveBusyCounts 第 4 调用方）
 * 生命周期态消费端（shared 单源，见 expert-lifecycle.ts 头注）：
 *  - expert-ai-evaluation collectExpertFacts（AI 综合评价输入）
 *  - web :3005 详情页 stateBadgeOf（跨端——经 @water-erp/shared 同链，非镜像）
 *
 * 本文件保留带 Prisma 查询的 deriveBusyCounts；纯函数部分在 shared（api 内消费方经下方
 * re-export 零改动）。
 */

export {
  IN_FLIGHT_STAGES,
  LIFECYCLE_LABELS,
  busyStateOf,
  busyStateLabel,
  deriveBusySets,
  lifecycleLabelOf,
  lifecycleStateOf,
} from '@water-erp/shared';
export type { BusyRow, BusySets, BusyStateLabel, LifecycleState } from '@water-erp/shared';

type BusyPrisma = Pick<PrismaClient, 'expertProfile' | 'bidExpert'>;

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
 *  userWhere = 视野过滤片段（专家库公司隔离 f / 水叮当 companyWhere / 大屏空视野）。
 *  **契约（E10 2026-11-20）**：userWhere 禁传 `expertProfile` 键（类型已 Omit；传了抛错）——
 *  人口过滤由本函数单源注入并同注两侧；需收窄库内人口请扩展本函数 API，勿调用方自带。 */
export async function deriveBusyCounts(
  prisma: BusyPrisma,
  userWhere: Omit<Prisma.UserWhereInput, 'expertProfile'>,
): Promise<BusyCounts> {
  // E10 入口守卫（与 Omit 类型互补——Omit 只拦字面量直写，spread/动态构造/as 断言全绕过，
  // 运行时守卫是第二道闸，勿以「类型已禁」为由删除）。判据用 !== undefined 而非 truthy：
  // null 是有语义的 Prisma 过滤（关系为空），放行 null 会造成分母 0 而 occupied>0 的病理态。
  // 嵌套走私（AND/OR/NOT 数组内 expertProfile）两侧对称良性，不深遍历。
  if ((userWhere as { expertProfile?: unknown }).expertProfile !== undefined) {
    throw new Error(
      'EXPERT_PROFILE_KEY_FORBIDDEN: deriveBusyCounts 的 userWhere 不接受 expertProfile 键——' +
      '人口过滤（ACTIVE+非停用）由本函数单源注入并同注两侧（裁定⑴）；需收窄库内人口请扩展本函数 API',
    );
  }
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
          // 单源注入人口过滤（spread 后本键覆盖 userWhere 同名键——入口守卫已禁传入，
          // 此处覆盖即安全；裁定⑴两侧同滤保证 idle+occupied 还原分母）
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
