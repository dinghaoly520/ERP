import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertBondLedgerDto } from './dto/bond-ledger.dto';

@Injectable()
export class BondLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** A-102：登记/更正保证金到账（缴纳人/金额/到账时间/账户/支付形式） */
  async upsert(projectId: string, dto: UpsertBondLedgerDto, actorId?: string) {
    const project = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: { name: true, bondRequired: true } });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (!project.bondRequired) throw new BadRequestException({ error: '该项目未要求投标保证金', code: 'NO_BOND' });
    const roster = await this.prisma.bidSupplier.findFirst({ where: { projectId, supplierName: dto.supplierName }, select: { id: true } });
    if (!roster) throw new BadRequestException({ error: `投标名册中不存在供应商「${dto.supplierName}」`, code: 'SUPPLIER_NOT_IN_ROSTER' });
    const row = await this.prisma.bidBondLedger.upsert({
      where: { projectId_supplierName: { projectId, supplierName: dto.supplierName } },
      create: { projectId, supplierName: dto.supplierName, amount: dto.amount, arrivedAt: new Date(dto.arrivedAt), account: dto.account, payMethod: dto.payMethod, note: dto.note ?? null, createdBy: actorId ?? null },
      update: { amount: dto.amount, arrivedAt: new Date(dto.arrivedAt), account: dto.account, payMethod: dto.payMethod, note: dto.note ?? null },
    });
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: dto.supplierName,
        action: '保证金到账登记', result: `缴纳人 ${dto.supplierName}；金额 ${dto.amount} 元；到账 ${dto.arrivedAt}；收款账户 ${dto.account}；支付形式 ${dto.payMethod}${dto.note ? `；备注 ${dto.note}` : ''}`, riskFlag: '无' },
    }).catch(() => {});
    return row;
  }

  list(projectId: string) {
    return this.prisma.bidBondLedger.findMany({ where: { projectId }, orderBy: { arrivedAt: 'asc' } });
  }

  /** 错登纠正（高风险留痕）；正常核对无误的记录不得删 */
  async remove(projectId: string, ledgerId: string) {
    const row = await this.prisma.bidBondLedger.findUnique({ where: { id: ledgerId } });
    if (!row || row.projectId !== projectId) throw new BadRequestException({ error: '台账记录不存在', code: 'NOT_FOUND' });
    await this.prisma.bidBondLedger.delete({ where: { id: ledgerId } });
    await this.prisma.bidSupervisionLog.create({
      data: { projectId, time: new Date(), role: '系统', target: row.supplierName,
        action: '保证金到账台账删除', result: `删除记录：金额 ${row.amount} 元、到账 ${row.arrivedAt.toISOString()}`, riskFlag: '高风险' },
    }).catch(() => {});
    return { success: true };
  }
}
