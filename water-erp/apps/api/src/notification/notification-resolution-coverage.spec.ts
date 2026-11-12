import { NOTIFICATION_REGISTRY } from '@water-erp/shared';

/**
 * 消解路径全集守护（2026-11-12 举一反三收敛）：
 * 每个 actionable 类型必须有至少一个消解出口，否则待办只能靠本人手点「已办」、
 * 业务侧永不收口——群发型即「02 办结 01 仍挂」僵尸类，个人型即永挂待办。
 *
 * 新增 actionable 类型时三选一（或 PERSONAL 声明）：
 *  ① 群发复核型 → 注册表打 sharedResolve（铁律：同签名=同一工作项，见注册表注释）
 *  ② 镜像某队列/阶段 → stale-sweep 加对账规则（并同步下方 SWEEP_EXIT）
 *  ③ 业务动作收口 → 动作侧调 resolveActionable*（并同步下方 HOOK_EXIT）
 *  ④ 单收件人、真值=用户自身待办（如到期提醒）→ PERSONAL_EXIT 声明并注释理由
 */
describe('通知消解覆盖守护', () => {
  const ACTIONABLE = NOTIFICATION_REGISTRY.filter(s => s.actionable).map(s => s.code);

  /** 注册表 live 派生——整组消解（同 type+link+content 任一人办结全组清） */
  const SHARED_EXIT = NOTIFICATION_REGISTRY.filter(s => s.sharedResolve).map(s => s.code);

  /** stale-sweep 对账消解（规则见 stale-sweep.ts 分节注释，重构搬规则时同步本清单） */
  const SWEEP_EXIT = [
    'USER_REGISTRATION_PENDING', // 1) 注册审核按 userId/队列对账
    'SUPPLIER_PENDING', // 2) 供应商注册/标签按 supplierId/队列对账
    'SUPPLIER_LINK_PENDING', // 3) 加入/退库审批队列空全清
    'SUPPLIER_CHANGE_PENDING', // 4b) 变更审批按在审供应商名对账
    'PROFILE_CHANGE_PENDING', 'PASSWORD_CHANGE_PENDING', 'PASSWORD_RESET_PENDING', // 4c) 安全审批按 requestId 对账
    'SUPPLIER_REVIEW_URGE', // 4d0) 催审按供应商审结消解
    'BID_OPENING_HANDED_OVER', 'BID_DECRYPT_FAILED', // 4d) 开标域他端待办按项目 stage
    'BID_INVITED', 'BID_DEADLINE_NUDGE', 'BID_NUDGE_SUPPLIER', 'BID_SCHEDULE_CHANGE', // 4e) 截标窗口
    'BID_OPENING_SOON', 'DECRYPT_WINDOW_CLOSING', 'HALL_MESSAGE', 'BID_DISPUTE_TIMEOUT', // 4e) 开标窗口
    'EVAL_DEADLINE_EXPIRED', 'EXPERT_ASSIGNED', 'BID_NUDGE_EXPERT', 'BID_CLARIFICATION_CREATED', 'BID_ROUND_OPEN', // 4e) 评标窗口
  ];

  /** 业务动作侧消解钩子（resolveActionable* 调用点；此处为清单快照防漂移） */
  const HOOK_EXIT = [
    'SUPPLIER_PENDING', 'SUPPLIER_LINK_PENDING', 'SUPPLIER_CHANGE_PENDING', // 供应商审批流转
    'PROFILE_CHANGE_PENDING', 'PASSWORD_CHANGE_PENDING', 'PASSWORD_RESET_PENDING', // password-requests.service
    'CONTRACT_READY_TO_SIGN', 'BID_OPENING_HANDED_OVER', 'BID_DECRYPT_FAILED', // 合同/开标域动作
    'ARCHIVE_READY', 'ARCHIVE_TRANSFER_DUE', 'ARCHIVE_OVERDUE', // archive-flow.service 归档动作
  ];

  /** 单收件人、真值=用户自身待办——本人 resolveOwn 即设计语义，无僵尸类（到期提醒类：底态不消解，待办长期在是事实） */
  const PERSONAL_EXIT = [
    'AWARD_LETTER', // 供应商下载/确认中标通知书
    'BOND_REFUND_DUE', // 创建人记录保证金退还（归档后仍是真实工作，禁入阶段窗口）
    'QUALIFICATION_EXPIRING', // 资质到期提醒：底态（资质有效期）持续存在
    'CERT_EXPIRY_REMINDER', // 证照到期提醒：同上
    'CA_CERT_EXPIRY', // CA 证书到期提醒：同上
  ];

  it('每个 actionable 类型至少有一个消解出口（shared/sweep/hook/personal）', () => {
    const covered = new Set([...SHARED_EXIT, ...SWEEP_EXIT, ...HOOK_EXIT, ...PERSONAL_EXIT]);
    const uncovered = ACTIONABLE.filter(t => !covered.has(t));
    // 声明口径：SHARED_EXIT 从注册表 live 派生不可能空集失败；SWEEP/HOOK/PERSONAL 为
    // 人工同步清单——uncovered 非空即新类型裸奔，按文件头注释四选一收口。
    expect(uncovered).toEqual([]);
  });

  it('消解清单自身不漂移：SWEEP/HOOK/PERSONAL 声明的类型必须真实存在且 actionable', () => {
    const actionable = new Set(ACTIONABLE);
    for (const t of [...SWEEP_EXIT, ...HOOK_EXIT, ...PERSONAL_EXIT]) {
      expect(actionable.has(t)).toBe(true); // 删类型/改 actionable 时清清单，防僵尸声明
    }
  });
});
