export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  /** :3005 单设备会话 ID（仅 web 门户签发的 token 携带；AuthGuard 与 User.webSessionId 比对） */
  sid?: string;
}

// 采购中心兼容类型（从 procurement 项目迁入模块使用）
export type AuthenticatedUser = JwtPayload & {
  name?: string;
};
