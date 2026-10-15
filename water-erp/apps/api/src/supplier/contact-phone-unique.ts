import { BadRequestException } from '@nestjs/common';
import { blindIndexPii, openPii } from '../common/crypto/sm-field-crypto';

/**
 * 联系人手机号唯一性（2026-10-14 用户裁定口径）：
 * - 主联系人（isPrimary）：phone **全局唯一**——不得与任何其他供应商的账号手机号（User.phoneIdx）
 *   或其他供应商的主联系人手机号（SupplierContact.phoneIdx + isPrimary）重复；
 * - 额外联系人：phone **供应商内唯一**——同 supplierId 的联系人（含主联系人）不重复。
 *
 * 注意：主联系人全局唯一 + 额外联系人供应商内唯一 是跨表/部分唯一口径，DB 无法用单一
 * 唯一约束表达，故做**应用层软约束**（SupplierContact.phoneIdx 仅建普通索引供快速定位）。
 */

export interface ContactPhoneInput {
  phone?: string | null;
  isPrimary?: boolean;
}

/** 注册用：contacts 数组内 phone 去重（供应商尚未创建，DB 无本供应商联系人可查）。
 *  主联系人全局唯一已由注册流程的 User.phoneIdx 查重覆盖，此处仅需拦「数组内 + 主/额外之间」重复。 */
export function assertContactsArrayPhonesUnique(contacts: ContactPhoneInput[]): void {
  const seen = new Set<string>();
  for (const c of contacts) {
    const phone = (c.phone ?? '').trim();
    if (!phone) continue;
    if (seen.has(phone)) {
      throw new BadRequestException({
        error: `联系人手机号「${phone}」重复，请勿重复填写`,
        code: 'DUPLICATE_CONTACT_PHONE',
      });
    }
    seen.add(phone);
  }
}

/** supplier 已存在场景（转正/加联系人/改联系人）的 DB 查重。 */
export async function assertContactPhonesUnique(
  prisma: any,
  params: {
    supplierId: string;
    contacts: ContactPhoneInput[];
    /** 改联系人时排除自身 contactId（避免把自己当前 phone 判为重复） */
    excludeContactId?: string;
  },
): Promise<void> {
  for (const c of params.contacts) {
    const phone = (c.phone ?? '').trim();
    if (!phone) continue;
    const idx = blindIndexPii(phone);
    if (!idx) continue;

    if (c.isPrimary) {
      // 主联系人全局唯一：其他供应商账号 + 其他供应商主联系人
      const dupUser = await prisma.user.findFirst({
        where: { phoneIdx: idx },
        select: { id: true, supplier: { select: { id: true } } },
      });
      if (dupUser && dupUser.supplier?.id !== params.supplierId) {
        throw new BadRequestException({
          error: '该手机号已绑定其他供应商账号，请更换',
          code: 'DUPLICATE_CONTACT_PHONE',
        });
      }
      const dupContact = await prisma.supplierContact.findFirst({
        where: { phoneIdx: idx, isPrimary: true, NOT: { supplierId: params.supplierId } },
        select: { id: true },
      });
      if (dupContact) {
        throw new BadRequestException({
          error: '该手机号已是其他供应商的主要联系人，请更换',
          code: 'DUPLICATE_CONTACT_PHONE',
        });
      }
    } else {
      // 额外联系人供应商内唯一
      const dupContact = await prisma.supplierContact.findFirst({
        where: {
          phoneIdx: idx,
          supplierId: params.supplierId,
          ...(params.excludeContactId ? { NOT: { id: params.excludeContactId } } : {}),
        },
        select: { id: true },
      });
      if (dupContact) {
        throw new BadRequestException({
          error: '该手机号已在本供应商联系人中使用，请更换',
          code: 'DUPLICATE_CONTACT_PHONE',
        });
      }
    }
  }
}

/**
 * 钉死「主联系人 = 账号」不变量（2026-10-14 稳健性完善）：
 * 主联系人就是账号持有人，其 phone 必须等于账号手机号（User.phone，openPii 后明文）。
 * 如此主联系人手机号的全局唯一性完全由 User.phoneIdx 唯一约束兜底（硬约束），
 * 联系人层无需另建跨表主联系人唯一域——换主联系人手机号须走「改账号手机号」资料变更。
 */
export async function assertPrimaryContactMatchesAccount(
  prisma: any,
  params: { supplierId: string; contacts: ContactPhoneInput[] },
): Promise<void> {
  const primary = params.contacts.find((c) => c.isPrimary);
  if (!primary) return;
  const phone = (primary.phone ?? '').trim();
  if (!phone) return;

  const sup = await prisma.supplier.findUnique({
    where: { id: params.supplierId },
    select: { userId: true },
  });
  const user = sup?.userId
    ? await prisma.user.findUnique({ where: { id: sup.userId }, select: { phone: true } })
    : null;
  const accountPhone = (user?.phone ? openPii(user.phone) : '') ?? '';
  if (accountPhone && phone !== accountPhone) {
    throw new BadRequestException({
      error: `主要联系人手机号须与账号手机号一致（如需更换请走资料变更），当前账号手机号：${accountPhone}`,
      code: 'PRIMARY_CONTACT_PHONE_MISMATCH',
    });
  }
}
