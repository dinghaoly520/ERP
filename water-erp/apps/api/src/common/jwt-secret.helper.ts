import { Logger } from '@nestjs/common';

const logger = new Logger('JwtSecret');

/**
 * 返回 JWT 签名密钥，并按环境做安全校验。
 *
 * - 生产环境 (NODE_ENV=production)：JWT_SECRET 缺失或短于 32 字符 → 抛错拒绝启动，
 *   避免用硬编码弱密钥签发可被伪造的 token。
 * - 开发/测试：缺失则回退到固定弱值（值刻意保持 'water-erp-jwt-secret' 不变，
 *   保证开发/seed 零破坏），并打印醒目告警。
 *
 * 之所以保留弱回退值而不是随机生成：随机值会导致每次重启密钥变化、
 * 已签发 token 全部失效；开发体验远不如固定弱值 + 告警。
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < 32) {
      throw new Error(
        'FATAL: 生产环境必须配置 JWT_SECRET 且长度 ≥32 字符，拒绝启动。',
      );
    }
    return secret;
  }

  // 开发 / 测试
  if (!secret) {
    logger.warn('未设置 JWT_SECRET，使用不安全的开发回退值（严禁用于生产）。');
    return 'water-erp-jwt-secret';
  }

  if (secret.length < 32) {
    logger.warn(
      `JWT_SECRET 仅 ${secret.length} 字符（<32），生产环境将被拒绝启动。`,
    );
  }

  return secret;
}
