/**
 * 端口-角色强绑定映射。
 *
 * L3 登录校验：login 时角色不在当前端口允许列表 → 403 拒绝。
 * L4 运行时校验：AuthGuard 验证 JWT 后角色与端口不匹配 → 403 拒绝。
 */

/** 每个门户允许的角色集 */
export const PORT_ALLOWED_ROLES: Record<string, ReadonlySet<string>> = {
  // 公开门户：所有角色都能登录后跳转
  public: new Set([
    'admin', 'leader', 'staff', 'bid_host', 'bid_expert', 'supplier', 'mall',
  ]),
  // 采购管理端 :3005
  web: new Set(['leader', 'staff', 'admin']),
  // 专家门户 :3006（专家 + 主持人/admin + 采购人员登录入口）
  expert: new Set(['bid_expert', 'bid_host', 'admin', 'leader', 'staff']),
  // 开评标端 :3007——允许所有内部角色（注册审批后即可在两端登录）
  bid: new Set(['leader', 'staff', 'bid_host', 'admin']),
  // 采购商城 :3003
  mall: new Set(['mall']),
  // 供应商门户 :3004
  supplier: new Set(['supplier']),
};

/** 端口对应的中文描述，用于错误提示 */
const PORT_LABEL: Record<string, string> = {
  web: '采购管理端(:3005)',
  bid: '开评标管理端(:3007)',
  expert: '专家门户(:3006)',
  mall: '采购商城(:3003)',
  supplier: '供应商门户(:3004)',
  public: '信息门户(:3002)',
};

/** 角色建议跳转的端口 */
const ROLE_PREFERRED_PORT: Record<string, string> = {
  leader: 'web',
  staff: 'web',
  admin: 'web',
  bid_host: 'bid',
  bid_expert: 'expert',
  mall: 'mall',
  supplier: 'supplier',
};

/**
 * 校验角色是否允许在该端口登录/访问。
 * 返回 null = 允许；返回 string = 拒绝原因（含建议端口）。
 */
export function checkPortRole(
  role: string,
  portal: string | undefined,
): string | null {
  if (!portal) return null;

  const allowed = PORT_ALLOWED_ROLES[portal];
  if (!allowed) return null; // 未知门户不拦截（向后兼容）

  if (allowed.has(role)) return null;

  // 角色不匹配 → 构造提示
  const portLabel = PORT_LABEL[portal] ?? portal;
  const preferredPort = ROLE_PREFERRED_PORT[role];
  const suggestLabel = preferredPort ? PORT_LABEL[preferredPort] : null;

  if (suggestLabel) {
    return `角色不支持在${portLabel}登录，请到${suggestLabel}`;
  }
  return `角色(${role})不支持在${portLabel}登录`;
}
