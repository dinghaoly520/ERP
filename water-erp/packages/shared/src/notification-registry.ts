/* ─────────────────────────────────────────────────────────────
 * 通知类型注册表（单一事实源，2026-09-26 规范化）
 *
 * 设计：每个通知类型在此登记一条完整定义，各端派生取数——
 *  - 管理端 (:3005) 通知中心/工作台：NOTIFICATION_META / NOTIFICATION_LABEL / DOMAIN_TABS
 *    全部从注册表派生（constants.ts 转发，导出签名不变）；
 *  - 供应商门户 (:3004) 保留独立的双视角覆盖层（分组/操作按钮/面向供应商的措辞），
 *    仅做成员对齐审计，不从注册表派生（视角刻意不同，如"拉黑"vs"信用状态变更"）；
 *  - API (apps/api)：NotificationService 按注册表校验未知类型（warn 不阻断），
 *    bid 域产生点改用 render()/link() 统一措辞与跳转。
 *
 * 范围说明（2026-09-26 用户裁定）：本期只巩固 bid 域（开标现场矩阵——
 * bid_host/bid_expert 为场内角色，仅收场内必要通知与 :3004/:3005 开标过程操作知会）；
 * 其余域 audience 一律 LEGACY 挂起，待进一步思考后再收口。
 * ───────────────────────────────────────────────────────────── */

export type NotificationDomain =
  | 'bid' // 采购执行 / 开评标（场内矩阵）
  | 'expert' // 专家（指派/替补/澄清，场内相关）
  | 'supplier' // 供应商（注册/审批/信用/资质）
  | 'account' // 账号（注册审核/改密/资料变更/安全）
  | 'archive' // 归档
  | 'announcement' // 公告
  | 'contract' // 合同履约
  | 'catalog' // 集中目录
  | 'system'; // 系统兜底（legacy）

export type NotificationChannelKind = 'in_app' | 'email' | 'sms' | 'phone';

/** 收件人策略（本期 bid 域真实策略；其余域 LEGACY 挂起） */
export type NotificationAudience =
  | { kind: 'SUBJECT_USER' } // 发事件主体本人（被邀请供应商/中标供应商/被澄清方…）
  | { kind: 'ROLE'; roles: string[] } // 指定内部角色
  | { kind: 'INVITED_SUPPLIERS' } // 本项目/本轮受邀供应商
  | { kind: 'SUBMITTED_SUPPLIERS' } // 已投递（已提交）供应商
  | { kind: 'CONFIRMED_EXPERTS' } // 已确认正选专家
  | { kind: 'COMPANY_LEADER_STAFF' } // 归属公司 leader+staff（无人回退平台 admin）
  | { kind: 'MANUAL_TARGETS' } // 主持人/操作者手动圈选的群发对象
  | { kind: 'LEGACY'; note: string }; // 收件策略挂起待议（2026-09-26 冻结域，产生点维持现状）

export interface NotificationRenderCtx {
  [key: string]: string | number | undefined;
}

export interface NotificationTypeSpec {
  code: string;
  /** 管理端中文标签（:3004 供应商视角标签以其覆盖层为准） */
  label: string;
  domain: NotificationDomain;
  /** Lucide 图标名（前端按名动态解析，缺省 Bell） */
  icon: string;
  tone: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray';
  /** 是否进「待办」分段（未读且未 resolve 时计入待办数） */
  actionable: boolean;
  audiences: NotificationAudience[];
  /** 投递渠道：本期一律站内（框架留位，渠道策略后续按类型打开） */
  channels: NotificationChannelKind[];
  /** 标题/正文模板（bid 域稳定文案收口；无 render 的类型文案在调用点） */
  render?: (ctx: NotificationRenderCtx) => { title: string; content: string };
  /** 跳转链接构建器（链接目标是"该类型受众所在门户"的路径） */
  link?: (ctx: NotificationRenderCtx) => string;
  /** 幽灵/历史类型：代码不再产生，仅为存量数据显示保留 */
  deprecated?: boolean;
}

const IN_APP: NotificationChannelKind[] = ['in_app'];

/* ── bid 域链接构建器（:3004 供应商端 / :3005+:3007 管理与主持端 / :3006 专家端） ── */
const LINKS = {
  supplierOpeningHall: (projectId: string) => `/my-bids/${projectId}/opening-hall`,
  supplierRoundQuote: (projectId: string) => `/bids/${projectId}/round-quote`,
  expertEvaluate: (projectId: string) => `/evaluate/${projectId}`,
  hostProject: (projectId: string) => `/bid/project/${projectId}`,
  mgmtBidList: (projectId: string) => `/bid?id=${projectId}`,
  mgmtBidConfirm: (pmItemId: string) => `/projects?projectId=${pmItemId}&panel=bid-confirm`,
  mgmtProjects: () => '/projects',
  supplierDashboard: () => '/dashboard',
};

/* ═══════════════════════════════════════════════════════════
 * bid 域（开标现场矩阵，2026-09-26 巩固）
 * 矩阵见会话定稿：签到/解密在场内走 WS 实时层（bid.gateway），
 * 站内信只承载跨门户触达的阶段流转与定向结果。
 * ═══════════════════════════════════════════════════════════ */
const BID_SPECS: NotificationTypeSpec[] = [
  {
    code: 'BID_OPENING_CONFIRMED',
    label: '开标确认',
    domain: 'bid',
    icon: 'Gavel',
    tone: 'blue',
    actionable: false,
    audiences: [{ kind: 'ROLE', roles: ['bid_host'] }],
    channels: IN_APP,
    render: ctx => ({
      title: `项目${ctx.projectName}已确定开标`,
      content: '请前往开标大厅组建会话（填写主持人、监督人与解密窗口）',
    }),
    link: ctx => LINKS.hostProject(String(ctx.projectId)),
  },
  {
    code: 'BID_OPENING_STARTED',
    label: '开标启动',
    domain: 'bid',
    icon: 'Gavel',
    tone: 'blue',
    actionable: false,
    audiences: [{ kind: 'SUBMITTED_SUPPLIERS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `开标已启动：${ctx.projectName}`,
      content: '请前往开标大厅查看解密窗口时间并参与开标。',
    }),
    link: ctx => LINKS.supplierOpeningHall(String(ctx.projectId)),
  },
  {
    code: 'BID_EVALUATION_STARTED',
    label: '评标开始',
    domain: 'bid',
    icon: 'ClipboardList',
    tone: 'purple',
    actionable: false,
    audiences: [{ kind: 'CONFIRMED_EXPERTS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `项目${ctx.projectName}已启动评标`,
      content: `您被指派的评标项目「${ctx.projectName}」已启动，请登录专家门户查看投标文件并完成独立评分。`,
    }),
    link: ctx => LINKS.expertEvaluate(String(ctx.projectId)),
  },
  {
    code: 'BID_ROUND_OPEN',
    label: '报价轮开启',
    domain: 'bid',
    icon: 'Clock',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'INVITED_SUPPLIERS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `新报价轮次已开放（第${ctx.roundNo}轮）`,
      content: '请在截止时间前提交本轮报价。',
    }),
    link: ctx => LINKS.supplierRoundQuote(String(ctx.projectId)),
  },
  {
    code: 'BID_OPENING_HANDED_OVER',
    label: '开标移交',
    domain: 'bid',
    icon: 'PackageCheck',
    tone: 'green',
    actionable: true,
    audiences: [{ kind: 'ROLE', roles: ['leader', 'staff'] }],
    channels: IN_APP,
    render: ctx => ({
      title: ctx.auto
        ? `项目${ctx.projectName}开标完成，开标资料已自动固化移交`
        : `项目${ctx.projectName}开标完成，资料已移交`,
      content: ctx.auto
        ? `全部投标人已到终局态（触发：${ctx.trigger ?? '终局'}），开标文件包已自动生成固化`
        : '开标文件包已生成，可在开标确认面板启动评标或执行后续流程',
    }),
    link: ctx =>
      ctx.projectManagementItemId
        ? LINKS.mgmtBidConfirm(String(ctx.projectManagementItemId))
        : LINKS.mgmtProjects(),
  },
  {
    code: 'BID_DECRYPT_FAILED',
    label: '解密异常',
    domain: 'bid',
    icon: 'FileWarning',
    tone: 'red',
    actionable: true,
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
  },
  {
    code: 'BID_DECRYPT_ADJUDGED',
    label: '解密裁决',
    domain: 'bid',
    icon: 'Gavel',
    tone: 'orange',
    actionable: false,
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
    render: ctx => ({
      title: `${ctx.title}：${ctx.supplierName}`,
      content: String(ctx.content),
    }),
    link: ctx => LINKS.supplierOpeningHall(String(ctx.projectId)),
  },
  {
    code: 'BID_DISPUTE_TIMEOUT',
    label: '异议超时',
    domain: 'bid',
    icon: 'Clock',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'ROLE', roles: ['bid_host'] }],
    channels: IN_APP,
    render: ctx => ({
      title: '开标异议处理已超时',
      content: `${ctx.names} 的异议已超过 ${ctx.timeoutMinutes} 分钟。请前往开标大厅强制裁决。`,
    }),
    link: ctx => LINKS.hostProject(String(ctx.projectId)),
  },
  {
    code: 'BID_CLARIFICATION_CREATED',
    label: '评标澄清',
    domain: 'bid',
    icon: 'MessageCircle',
    tone: 'purple',
    actionable: true,
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
  },
  {
    code: 'HALL_MESSAGE',
    label: '会场交流',
    domain: 'bid',
    icon: 'MessagesSquare',
    tone: 'blue',
    actionable: true,
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
    link: ctx => LINKS.supplierOpeningHall(String(ctx.projectId)),
  },
  {
    code: 'BID_OPENING_SOON',
    label: '开标临近',
    domain: 'bid',
    icon: 'CalendarClock',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'SUBMITTED_SUPPLIERS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `即将开标：${ctx.projectName}`,
      content: `项目将于 ${ctx.openTime} 开标，请提前上线进入开标大厅并完成签到。`,
    }),
    link: ctx => LINKS.supplierOpeningHall(String(ctx.projectId)),
  },
  {
    code: 'DECRYPT_WINDOW_CLOSING',
    label: '解密窗口即将关闭',
    domain: 'bid',
    icon: 'AlertTriangle',
    tone: 'red',
    actionable: true,
    // 超时视为撤回/撤销投标，强时效；供应商解密成功后 resolveActionableForUser 消音
    audiences: [{ kind: 'INVITED_SUPPLIERS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `解密窗口即将关闭：${ctx.projectName}`,
      content: `解密窗口将于 ${ctx.closesAt} 关闭，逾期未解密将按招标文件规定处理，请立即操作。`,
    }),
    link: ctx => LINKS.supplierOpeningHall(String(ctx.projectId)),
  },
  {
    code: 'BOND_REFUND_RESULT',
    label: '保证金退还',
    domain: 'bid',
    icon: 'HandCoins',
    tone: 'green',
    actionable: false,
    // 逐家/项目级退还登记（GB/T 43711 7.5.4.4）：退还知会；不予退还带理由
    audiences: [{ kind: 'INVITED_SUPPLIERS' }],
    channels: IN_APP,
  },
  {
    code: 'BID_DEADLINE_NUDGE',
    label: '投标截止提醒',
    domain: 'bid',
    icon: 'Clock',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'INVITED_SUPPLIERS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `投标即将截止：${ctx.projectName}`,
      content: `项目「${ctx.projectName}」投标将于 ${ctx.deadline} 截止，请尽快提交投标文件。`,
    }),
    link: () => LINKS.supplierDashboard(),
  },
  {
    code: 'BID_SCHEDULE_CHANGE',
    label: '开标时间变更',
    domain: 'bid',
    icon: 'CalendarClock',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'MANUAL_TARGETS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `开标时间变更：${ctx.projectName}`,
      content: `项目 ${ctx.projectCode}（${ctx.projectName}）开标时间已调整为 ${ctx.openTime}，请留意最新安排。`,
    }),
    link: () => LINKS.supplierDashboard(),
  },
  {
    code: 'BID_OPENING_DECISION',
    label: '开标安排',
    domain: 'bid',
    icon: 'CalendarClock',
    tone: 'blue',
    actionable: false,
    // 主持人手动群发（支持 {专家姓名} 变量），文案由主持人自定，不收口模板
    audiences: [{ kind: 'MANUAL_TARGETS' }],
    channels: IN_APP,
  },
  {
    code: 'BID_NUDGE_SUPPLIER',
    label: '供应商催办',
    domain: 'bid',
    icon: 'Clock',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'INVITED_SUPPLIERS' }],
    channels: IN_APP,
  },
  {
    code: 'BID_NUDGE_EXPERT',
    label: '专家催办',
    domain: 'bid',
    icon: 'Clock',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'CONFIRMED_EXPERTS' }],
    channels: IN_APP,
    render: ctx => ({
      title: `${ctx.kind === 'signin' ? '评审签到' : '评审进度'}提醒：${ctx.projectName}`,
      content: String(ctx.content),
    }),
    link: ctx => `/?projectId=${ctx.projectId}`,
  },
  {
    code: 'BID_AWARD_RESULT',
    label: '定标结果',
    domain: 'bid',
    icon: 'Award',
    tone: 'blue',
    actionable: false,
    // P1-6：法45条未中标人定向结果通知
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
  },
  {
    code: 'BID_ABORTED',
    label: '流标通知',
    domain: 'bid',
    icon: 'CircleX',
    tone: 'red',
    actionable: false,
    audiences: [{ kind: 'ROLE', roles: ['bid_host'] }, { kind: 'CONFIRMED_EXPERTS' }],
    channels: IN_APP,
  },
  {
    code: 'PROJECT_TERMINATED',
    label: '项目终止',
    domain: 'bid',
    icon: 'CircleX',
    tone: 'red',
    actionable: false,
    audiences: [{ kind: 'INVITED_SUPPLIERS' }],
    channels: IN_APP,
  },
  {
    code: 'EVAL_DEADLINE_EXPIRED',
    label: '评标超时',
    domain: 'bid',
    icon: 'AlertTriangle',
    tone: 'orange',
    actionable: true,
    audiences: [{ kind: 'ROLE', roles: ['leader'] }],
    channels: IN_APP,
  },
  {
    code: 'BID_PUBLISHED',
    label: '采购项目发布',
    domain: 'bid',
    icon: 'Megaphone',
    tone: 'blue',
    actionable: false,
    // 2026-09-26 场内矩阵裁定：发布知会不进 bid_host（主持人在"开标确认"才介入）
    audiences: [],
    channels: IN_APP,
    deprecated: true,
  },
  {
    code: 'AWARD_LETTER',
    label: '中标通知书',
    domain: 'bid',
    icon: 'Award',
    tone: 'green',
    actionable: true,
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
  },
  {
    code: 'BID_INVITED',
    label: '投标邀请',
    domain: 'bid',
    icon: 'Send',
    tone: 'blue',
    actionable: true,
    audiences: [{ kind: 'INVITED_SUPPLIERS' }],
    channels: IN_APP,
  },
];

/* ═══════════════════════════════════════════════════════════
 * expert 域（场内相关：指派/替补/异议）
 * ═══════════════════════════════════════════════════════════ */
const EXPERT_SPECS: NotificationTypeSpec[] = [
  { code: 'EXPERT_ASSIGNED', label: '专家指派', domain: 'expert', icon: 'UserCheck', tone: 'blue', actionable: true, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'EXPERT_AUTO_PROMOTED', label: '专家自动递补', domain: 'expert', icon: 'UserCheck', tone: 'blue', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'EXPERT_SWAP_PROMOTED', label: '专家替补上岗', domain: 'expert', icon: 'UserCheck', tone: 'blue', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'EXPERT_SWAP_RELEASED', label: '专家替补释放', domain: 'expert', icon: 'UserMinus', tone: 'gray', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'EXPERT_DISPUTE_RESOLVED', label: '专家异议结果', domain: 'expert', icon: 'CheckCircle2', tone: 'green', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'EXPERT_RETIRE_CANDIDATE', label: '专家退库预警', domain: 'expert', icon: 'UserMinus', tone: 'orange', actionable: true,
    // 2026-09-26 超界修复：专家库管理事件归 :3005（leader+staff 复核），不进 bid_host/admin；link 指 :3005 退库复核页
    audiences: [{ kind: 'ROLE', roles: ['leader', 'staff'] }], channels: IN_APP, link: () => '/expert/retirement' },
];

/* ═══════════════════════════════════════════════════════════
 * 以下域 2026-09-26 冻结：产生点不动；audience 记录现状快照
 * （ROLE=当前真实收件角色；LEGACY=收件动态/多处混杂），目标策略待用户进一步思考后收口
 * ═══════════════════════════════════════════════════════════ */
const LEGACY = (note: string): NotificationAudience[] => [{ kind: 'LEGACY', note }];

const SUPPLIER_SPECS: NotificationTypeSpec[] = [
  { code: 'SUPPLIER_PENDING', label: '供应商审批', domain: 'supplier', icon: 'UserCheck', tone: 'blue', actionable: true, audiences: [{ kind: 'COMPANY_LEADER_STAFF' }], channels: IN_APP }, // 2026-09-26 已实施：归属公司 leader+staff，无人回退 admin
  { code: 'SUPPLIER_APPROVED', label: '供应商入库', domain: 'supplier', icon: 'CheckCircle2', tone: 'green', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'SUPPLIER_REJECTED', label: '供应商驳回', domain: 'supplier', icon: 'XCircle', tone: 'red', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'SUPPLIER_RETURNED', label: '退回补正', domain: 'supplier', icon: 'RotateCcw', tone: 'orange', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'SUPPLIER_BLACKLISTED', label: '供应商拉黑', domain: 'supplier', icon: 'Ban', tone: 'red', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'SUPPLIER_UNBLACKLISTED', label: '供应商解除拉黑', domain: 'supplier', icon: 'CircleCheck', tone: 'green', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'SUPPLIER_ELIMINATE_CANDIDATE', label: '供应商淘汰预警', domain: 'supplier', icon: 'UserMinus', tone: 'orange', actionable: true, audiences: [{ kind: 'ROLE', roles: ['admin', 'leader', 'staff'] }], channels: IN_APP },
  { code: 'SUPPLIER_REVIEW_URGE', label: '供应商催审', domain: 'supplier', icon: 'Clock', tone: 'orange', actionable: true, audiences: LEGACY('现按归属公司工作人员+回退全体，挂起待议'), channels: IN_APP },
  { code: 'PREQUAL_RESULT', label: '资格预审结果', domain: 'supplier', icon: 'FileCheck2', tone: 'blue', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'QUALIFICATION_EXPIRING', label: '资质到期', domain: 'supplier', icon: 'AlertTriangle', tone: 'orange', actionable: true, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'SELECTION_SHARED', label: '候选名单分享', domain: 'supplier', icon: 'Share2', tone: 'blue', actionable: true, audiences: [{ kind: 'ROLE', roles: ['leader'] }], channels: IN_APP },
];

const ACCOUNT_SPECS: NotificationTypeSpec[] = [
  { code: 'USER_REGISTRATION_PENDING', label: '注册审核', domain: 'account', icon: 'UserPlus', tone: 'blue', actionable: true, audiences: [{ kind: 'ROLE', roles: ['admin'] }], channels: IN_APP },
  { code: 'PROFILE_CHANGE_PENDING', label: '资料变更待审', domain: 'account', icon: 'IdCard', tone: 'blue', actionable: true, audiences: [{ kind: 'ROLE', roles: ['admin'] }], channels: IN_APP },
  { code: 'PROFILE_CHANGE_REVIEWED', label: '资料变更审批', domain: 'account', icon: 'IdCard', tone: 'blue', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'PASSWORD_CHANGE_REVIEWED', label: '密码变更审批', domain: 'account', icon: 'KeyRound', tone: 'blue', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'PASSWORD_RESET_APPROVED', label: '密码重置审批', domain: 'account', icon: 'KeyRound', tone: 'green', actionable: false, audiences: [{ kind: 'SUBJECT_USER' }], channels: IN_APP },
  { code: 'ACCOUNT_SECURITY_FEEDBACK', label: '账号安全反馈', domain: 'account', icon: 'ShieldAlert', tone: 'red', actionable: true, audiences: [{ kind: 'ROLE', roles: ['admin'] }], channels: IN_APP },
];

const ARCHIVE_SPECS: NotificationTypeSpec[] = [
  { code: 'ARCHIVE_READY', label: '归档待办', domain: 'archive', icon: 'FileArchive', tone: 'orange', actionable: true, audiences: [{ kind: 'ROLE', roles: ['leader'] }], channels: IN_APP }, // 2026-09-26 已实施：业务通知不进 admin
  { code: 'ARCHIVE_TRANSFER_DUE', label: '归档移交临期', domain: 'archive', icon: 'CalendarClock', tone: 'orange', actionable: true, audiences: [{ kind: 'ROLE', roles: ['staff', 'leader'] }], channels: IN_APP },
  { code: 'ARCHIVE_OVERDUE', label: '归档严重逾期', domain: 'archive', icon: 'AlertTriangle', tone: 'red', actionable: true, audiences: [{ kind: 'ROLE', roles: ['leader'] }], channels: IN_APP }, // 2026-09-26 已实施
];

/* ── 合同履约域（2026-09-26 补齐：合同签约此前零通知） ── */
const CONTRACT_SPECS: NotificationTypeSpec[] = [
  {
    code: 'CONTRACT_READY_TO_SIGN',
    label: '合同待签署',
    domain: 'contract',
    icon: 'FileSignature',
    tone: 'blue',
    actionable: true,
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
    render: ctx => ({
      title: `合同已通过内审，待签署：${ctx.projectName}`,
      content: '合同文本已定稿并通过内审（一致性校验 7.5.4.3），请查看合同条款并配合完成签署。',
    }),
    link: () => '/contracts',
  },
  {
    code: 'CONTRACT_SIGNED',
    label: '合同已签署',
    domain: 'contract',
    icon: 'CheckCircle2',
    tone: 'green',
    actionable: false,
    audiences: [{ kind: 'SUBJECT_USER' }],
    channels: IN_APP,
    render: ctx => ({
      title: `合同已签署：${ctx.projectName}`,
      content: '双方签署已登记归档，合同生效，请留意履约节点安排。',
    }),
    link: () => '/contracts',
  },
];

const ANNOUNCEMENT_SPECS: NotificationTypeSpec[] = [
  { code: 'ANNOUNCEMENT_PUBLISHED', label: '公告发布', domain: 'announcement', icon: 'Megaphone', tone: 'blue', actionable: false, audiences: LEGACY('公告订阅供应商定向，挂起待议'), channels: IN_APP },
];

const CATALOG_SPECS: NotificationTypeSpec[] = [
  { code: 'CATALOG_APPLICATION', label: '目录申请', domain: 'catalog', icon: 'ShoppingBag', tone: 'gray', actionable: false, audiences: LEGACY('挂起待议'), channels: IN_APP },
  { code: 'CATALOG_PRICE_ALERT', label: '目录价格预警', domain: 'catalog', icon: 'Tag', tone: 'orange', actionable: true, audiences: LEGACY('挂起待议'), channels: IN_APP },
];

const SYSTEM_SPECS: NotificationTypeSpec[] = [
  // legacy 垃圾桶：5 处产生点语义各异（资格预审结果/定时任务/bid），拆解归入具体类型待其余域解冻
  { code: 'SYSTEM', label: '系统通知', domain: 'system', icon: 'Bell', tone: 'gray', actionable: false, audiences: LEGACY('catch-all，待拆解'), channels: IN_APP },
  // 历史类型：代码已不产生，仅为存量数据显示
  { code: 'SELECTION_NOTIFY', label: '候选名单通知', domain: 'supplier', icon: 'Share2', tone: 'blue', actionable: false, audiences: LEGACY('历史类型'), channels: IN_APP, deprecated: true },
  { code: 'CLARIFICATION', label: '澄清答疑', domain: 'bid', icon: 'MessageCircle', tone: 'purple', actionable: true, audiences: LEGACY('历史类型'), channels: IN_APP, deprecated: true },
];

/** 全量注册表（代码顺序 = 域顺序：bid → expert → supplier → account → archive → announcement → catalog → system） */
export const NOTIFICATION_REGISTRY: NotificationTypeSpec[] = [
  ...BID_SPECS,
  ...EXPERT_SPECS,
  ...SUPPLIER_SPECS,
  ...ACCOUNT_SPECS,
  ...ARCHIVE_SPECS,
  ...ANNOUNCEMENT_SPECS,
  ...CONTRACT_SPECS,
  ...CATALOG_SPECS,
  ...SYSTEM_SPECS,
];

export const NOTIFICATION_REGISTRY_MAP: Record<string, NotificationTypeSpec> = Object.fromEntries(
  NOTIFICATION_REGISTRY.map(s => [s.code, s]),
);

export function getNotificationSpec(type: string): NotificationTypeSpec | undefined {
  return NOTIFICATION_REGISTRY_MAP[type];
}

/** 类型是否仍在产生（deprecated = 仅存量显示） */
export function isNotificationTypeActive(type: string): boolean {
  const spec = NOTIFICATION_REGISTRY_MAP[type];
  return !!spec && !spec.deprecated;
}

/** 按注册表渲染通知载荷（bid 域模板收口入口；无 render 的类型返回 null，由调用点自拟文案） */
export function renderNotificationPayload(
  type: string,
  ctx: NotificationRenderCtx,
): { title: string; content: string; link?: string } | null {
  const spec = NOTIFICATION_REGISTRY_MAP[type];
  if (!spec) return null;
  const out: { title: string; content: string; link?: string } | null = spec.render ? spec.render(ctx) : null;
  if (out && spec.link) out.link = spec.link(ctx);
  return out;
}

/** 角色 → 通知中心可见业务域（2026-09-26 用户裁定：admin 只显示账号相关通知；
 *  其余域对 admin 隐藏（Tab 也不出现）。leader/staff=全部业务域；未列角色=全量保底）。 */
export const NOTIFICATION_ROLE_DOMAINS: Record<string, NotificationDomain[] | undefined> = {
  admin: ['account'],
};

/** 按角色过滤 Tab 定义（:3005 通知中心/工作台共用）。 */
export function notificationDomainTabsForRole(role?: string | null) {
  const allowed = role ? NOTIFICATION_ROLE_DOMAINS[role] : undefined;
  if (!allowed) return NOTIFICATION_DOMAIN_TABS;
  return NOTIFICATION_DOMAIN_TABS.filter(t => t.domains.some(d => allowed.includes(d)));
}

/* ── 业务域分组（:3005 通知中心 Tab 派生源） ──
 * 多个业务域可并到一个 Tab（如 expert 并入开评标），Tab 数量与现版一致；
 * key 供前端路由/筛选参数复用。 */
export const NOTIFICATION_DOMAIN_TABS: { key: string; label: string; domains: NotificationDomain[] }[] = [
  { key: 'supplier', label: '供应商', domains: ['supplier'] },
  { key: 'bid', label: '开评标', domains: ['bid', 'expert'] },
  { key: 'account', label: '账号', domains: ['account', 'system'] },
  { key: 'archive', label: '归档', domains: ['archive'] },
  { key: 'contract', label: '合同履约', domains: ['contract'] },
  { key: 'ann', label: '公告与目录', domains: ['announcement', 'catalog'] },
];

/** 某 Tab key → 该 Tab 包含的全部类型 code 列表 */
export function notificationTypesForTab(tabKey: string): string[] {
  const tab = NOTIFICATION_DOMAIN_TABS.find(t => t.key === tabKey);
  if (!tab) return [];
  return NOTIFICATION_REGISTRY.filter(s => tab.domains.includes(s.domain)).map(s => s.code);
}
