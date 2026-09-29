/**
 * EXP-P2-07（2026-09-29 审查修复）：本端签发的工位迁移票据已被平板领取的模块级标志。
 * 背景：claimExpertTransfer 成功即 rotatePortalSession——桌面旧 token 15s 内必被心跳
 * 撞上 SESSION_REPLACED，但这是**自家发起的预期迁移**，不该呈现「异地登录疑似冒用」
 * 恐慌遮罩、不该向全体 admin 发虚假安全反馈、更不该 20s 强跳登录（重登被闸4 拒）。
 * 模块级标志（非 prop/context）：SessionWatchdog 挂在 (app)/(tablet) 布局层，
 * 迁移弹窗在 evaluate 页——prop 不可达，同 JS 运行时单例标志最简。
 */
let transferClaimed = false;

export const markTransferClaimed = (): void => {
  transferClaimed = true;
};

export const isTransferClaimed = (): boolean => transferClaimed;
