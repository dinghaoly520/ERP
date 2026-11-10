import { BadRequestException } from '@nestjs/common';

/**
 * 统一社会信用代码变更闸（2026-11-10 用户裁定放开变更）。
 *
 * 提交（:3004 门户 / :3005 代提两入口）与审批（approveChange）共用：
 * - 18 位大写字母/数字格式（与注册/转正 correction 同一正则口径）
 * - 同值拦截（前端 dirty 已拦，此处后端兜底）
 * - 全库查重（Supplier.creditCode @unique——新代码被他司占用提交时即拦，
 *   不等审批时 P2002 兜底炸事务）
 * - 登录名占用查重：username=信用代码是注册三处强制口径（正式/临时/Excel 导入），
 *   新代码被其他账号占用为登录名时，改码同步 username 必失败——提交时提前暴露。
 *
 * 审批时点应再调一次（不信任提交时点：期间他司可能已注册占用新代码）。
 */

/** 结构化最小依赖：PrismaService 与 $transaction 内 tx 均满足 */
interface CreditCodeChangeDb {
  supplier: { findFirst(args: any): Promise<any> };
  user: { findFirst(args: any): Promise<any> };
}

/** 校验新信用代码可用性，通过则返回规范化（trim）后的代码 */
export async function assertCreditCodeChangeable(
  db: CreditCodeChangeDb,
  supplier: { id: string; userId: string; creditCode: string | null },
  newCode: string | null | undefined,
): Promise<string> {
  const code = String(newCode ?? '').trim();
  if (!/^[0-9A-Z]{18}$/.test(code)) {
    throw new BadRequestException({ error: '统一社会信用代码格式不正确（18 位大写字母/数字）', code: 'INVALID_CREDIT_CODE' });
  }
  if (supplier.creditCode && code === supplier.creditCode.trim()) {
    throw new BadRequestException({ error: '统一社会信用代码与当前值一致，无需变更', code: 'NO_CHANGE' });
  }
  const dupSupplier = await db.supplier.findFirst({
    where: { creditCode: code, NOT: { id: supplier.id } },
    select: { id: true },
  });
  if (dupSupplier) {
    throw new BadRequestException({ error: '该统一社会信用代码已被其他供应商占用', code: 'DUPLICATE_CREDIT_CODE' });
  }
  const dupUser = await db.user.findFirst({
    where: { username: code, role: 'supplier', NOT: { id: supplier.userId } },
    select: { id: true },
  });
  if (dupUser) {
    throw new BadRequestException({ error: '该统一社会信用代码已被其他账号占用为登录名', code: 'DUPLICATE_USERNAME' });
  }
  return code;
}
