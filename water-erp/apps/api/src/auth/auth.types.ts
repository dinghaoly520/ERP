export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}

// 采购中心兼容类型（从 procurement 项目迁入模块使用）
export type AuthenticatedUser = JwtPayload & {
  name?: string;
};
