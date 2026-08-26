/**
 * CTS-EBS01 4.8 安全性：口令强度统一策略。
 * 规则：≥8 位，且须同时包含字母与数字（存量口令不受影响，仅约束新注册与改密）。
 */
import { Matches } from 'class-validator';

export const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PASSWORD_POLICY_MESSAGE = '口令须至少 8 位且同时包含字母与数字';

/** DTO 字段装饰器组合（与 @IsString 搭配使用） */
export function IsStrongPassword() {
  return Matches(PASSWORD_PATTERN, { message: PASSWORD_POLICY_MESSAGE });
}
