/**
 * 注册查重命中 → 状态感知引导（临时/正式两页共用，2026-10-16）。
 *
 * 背景：信用代码命中的干巴巴「已被注册，请核对后重试」对临时过期供应商是误导——
 * 到期不改 status（仍 APPROVED），正确出路是登录页续期面板（?reactivate=1 预展开）。
 * 本模块把 checkDuplicate 返回的事实字段映射为带出路的引导对象，文案矩阵只此一份。
 */

export interface DedupCheckResult {
  creditCode: boolean;
  legalPersonIdCard: boolean;
  contactIdCard: boolean;
  phone: boolean;
  creditCodeStatus: string | null;
  creditCodeIsTemporary: boolean;
  creditCodeTemporaryExpired: boolean;
}

/** 语义类别：渲染样式与埋点用；message/link 为唯一文案出口 */
export type CreditCodeGuidanceKind = "renew" | "pending" | "returned" | "rejected" | "login" | "blocked";

export interface CreditCodeGuidance {
  /** 是否阻断注册提交（当前矩阵全部阻断——临时页无放行口径） */
  blocking: boolean;
  kind: CreditCodeGuidanceKind;
  message: string;
  link?: { label: string; href: string };
}

/**
 * 信用代码命中 → 引导。未命中返回 null。
 * 注意：正式注册页对 REJECTED/RETURNED 有自身的壳重开/补正流程（放行口径），
 * 调用方须在那两条分支之前自行处理，本矩阵不替它决策。
 */
export function creditCodeGuidance(res: Pick<DedupCheckResult, "creditCode" | "creditCodeStatus" | "creditCodeIsTemporary" | "creditCodeTemporaryExpired">): CreditCodeGuidance | null {
  if (!res.creditCode) return null;
  const status = res.creditCodeStatus;

  if (res.creditCodeIsTemporary && res.creditCodeTemporaryExpired) {
    return {
      blocking: true,
      kind: "renew",
      message: "该企业临时供应商资格已过期，请到登录页凭新邀请码续期（续期需账号密码）",
      link: { label: "去登录续期", href: "/login?reactivate=1" },
    };
  }
  switch (status) {
    case "PENDING":
      return {
        blocking: true,
        kind: "pending",
        message: "该企业注册申请正在审核中，请等待审核结果后登录",
        link: { label: "去查询审核进度", href: "/login?registered=1" },
      };
    case "RETURNED":
      return {
        blocking: true,
        kind: "returned",
        message: "该企业有退回补正中的注册申请，请到正式注册页通过「进入补正」完成验证后重新提交",
        link: { label: "改走正式注册", href: "/register" },
      };
    case "REJECTED":
      return {
        blocking: true,
        kind: "rejected",
        message: "贵司此前注册申请已被驳回，请改走正式注册重新建档（正式注册支持驳回后重新注册）",
        link: { label: "改走正式注册", href: "/register" },
      };
    case "APPROVED":
      return res.creditCodeIsTemporary
        ? {
            blocking: true,
            kind: "login",
            message: "该企业临时供应商资格有效期内，请直接登录",
            link: { label: "去登录", href: "/login" },
          }
        : {
            blocking: true,
            kind: "login",
            message: "该企业已是平台注册供应商，请直接登录；忘记密码请联系管理员重置",
            link: { label: "去登录", href: "/login" },
          };
    case "DISABLED":
    case "BLACKLIST":
      return {
        blocking: true,
        kind: "blocked",
        message: "该企业账号状态异常（已停用/黑名单），请联系采购中心管理员",
      };
    default:
      // 兜底：未知状态按传统重复口径处理
      return {
        blocking: true,
        kind: "blocked",
        message: "该统一社会信用代码已被注册，请核对后重试",
      };
  }
}
