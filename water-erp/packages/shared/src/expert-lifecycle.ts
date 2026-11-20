/**
 * 专家库况呈现态——跨端单源（2026-11-20 跨端待办收口，E5/E7 批次终章）。
 *
 * 四态引擎（正在评标 ＞ 已被抽取 ＞ 候补待命 ＞ 空闲，按在途项目阶段派生；declined 行
 * 由调用方查询侧过滤）与池外优先链（已退库 ＞ 已停用 ＞ 四态）在此单源，双端共同消费：
 *  - api：expert-busy-state.util re-export（AI 批注 expert-ai-evaluation / 水叮当 expert.tool /
 *    getExpert 详情 busyState / deriveBusyCounts 派生面）
 *  - web：:3005 详情页徽标 stateBadgeOf → lifecycleLabelOf（接后端四态串，不再手写链）
 *
 * 语义锚：镜像列「占用」值写入路径已封死（2026-11-19 E2）；「停用」是人口过滤语义
 * （临时需求代表/手工停用/退库不入池），不是库况状态。
 *
 * 纯函数（无 Prisma/DOM 依赖）——deriveBusyCounts 等带查询的留在 api 侧 util。
 */

/** 在途项目阶段（终局 ARCHIVED/ABORTED 不占库况；与库页状态列 2026-11-16 裁定同口径） */
export const IN_FLIGHT_STAGES = ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING'] as const;

/** 库况六态呈现标签（改措辞须双端同步意识——web tone 映射按此常量比较） */
export const LIFECYCLE_LABELS = {
  retired: '已退库',
  disabled: '已停用',
  evaluating: '正在评标',
  assigned: '已被抽取',
  alternate: '候补待命',
  idle: '空闲',
} as const;

export type BusyStateLabel =
  | typeof LIFECYCLE_LABELS.evaluating
  | typeof LIFECYCLE_LABELS.assigned
  | typeof LIFECYCLE_LABELS.alternate
  | typeof LIFECYCLE_LABELS.idle;

export type LifecycleState = BusyStateLabel | typeof LIFECYCLE_LABELS.retired | typeof LIFECYCLE_LABELS.disabled;

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

export function busyStateLabel(userId: string, sets: BusySets): BusyStateLabel {
  if (sets.evaluating.has(userId)) return LIFECYCLE_LABELS.evaluating;
  if (sets.assigned.has(userId)) return LIFECYCLE_LABELS.assigned;
  if (sets.alternate.has(userId)) return LIFECYCLE_LABELS.alternate;
  return LIFECYCLE_LABELS.idle;
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

/** 池外优先链（唯一实现，跨端单源）：**已退库 ＞ 已停用 ＞ 四态**。
 *  退库正门写 RETIRED+停用 两列（并存是常态，RETIRED 先判）；停用-ACTIVE 是临时需求
 *  代表/手工停用人群——不入抽取池，其 BidExpert 在途行只是绑定痕迹，不得冒充库况四态。
 *  web 消费形态：接后端四态串（getExpert busyState）——详情页徽标不再各自手写。
 *  空串透传（busyState 缺失且非池外 → ''，调用方自行决定不渲染）。 */
export function lifecycleLabelOf(
  profile: { entryStatus?: string | null; availability?: string | null },
  busyState: string,
): LifecycleState | '' {
  if (profile.entryStatus === 'RETIRED') return LIFECYCLE_LABELS.retired;
  if (profile.availability === '停用') return LIFECYCLE_LABELS.disabled;
  return busyState as LifecycleState | '';
}

/** api 消费形态：由在途行派生四态后套池外优先链（AI 批注 / 水叮当行状态）。 */
export function lifecycleStateOf(
  profile: { entryStatus?: string | null; availability?: string | null },
  inFlightRows: Array<{ expertRole: string | null; project: { stage: string } }>,
): LifecycleState | '' {
  return lifecycleLabelOf(profile, busyStateOf(inFlightRows));
}
