import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierBondReturnDto } from './dto/supplier-bond-return.dto';

/** 保证金域（F1a）——自 bid.service.ts 迁出（P1 审查 F 簇拆分，纯移动）。索引：markBondReturned / listBondReturns / markSupplierBondReturned */
@Injectable()
export class BidBondService {
  private readonly logger = new Logger(BidBondService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * C4（GB/T 43711 7.5.4.4）：登记响应担保退还 / 不予退还。
   * 不予退还必填理由（7.5.3.3 情形：弄虚作假/串通/失去履约能力/不交履约担保/拒签）→ 监督日志高风险留痕。
   */
  async markBondReturned(
    projectId: string,
    dto: { returned: boolean; reason?: string },
  ) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, projectCode: true, bondRequired: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (!project.bondRequired) throw new BadRequestException({ error: '该项目未要求响应担保', code: 'NO_BOND' });
    if (!dto.returned && !dto.reason?.trim()) {
      throw new BadRequestException({ error: '不予退还必须填写理由（对应 7.5.3.3 情形）', code: 'REASON_REQUIRED' });
    }

    const updated = await this.prisma.bidProject.update({
      where: { id: projectId },
      data: { bondReturnedAt: dto.returned ? new Date() : null },
      select: { id: true, projectCode: true, bondReturnedAt: true },
    });

    if (!dto.returned) {
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '采购人',
          action: '响应担保不予退还', target: project.name,
          result: dto.reason!.trim(), riskFlag: '高',
        },
      }).catch(e => this.logger.warn(`保证金不退留痕失败: ${(e as Error).message}`));
    }
    return updated;
  }

  /** A-105：保证金逐家退还清单——花名册行 × 唱标 bondStatus × 逐家退还态 × 中标标识（实施条例第57条：向中标人和未中标人退还） */
  async listBondReturns(projectId: string) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, bondRequired: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const [suppliers, openings, winner] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId },
        select: { supplierName: true, bondReturnedAt: true, bondReturnReason: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.bidOpeningRecord.findMany({
        where: { projectId },
        select: { supplierName: true, bondStatus: true },
      }),
      this.prisma.bidEvaluationResult.findFirst({
        where: { projectId, recommended: true, rank: 1 },
        select: { supplierName: true },
      }),
    ]);
    const bondStatusByName = new Map(openings.map(o => [o.supplierName, o.bondStatus]));
    return {
      bondRequired: project.bondRequired,
      rows: suppliers.map(s => ({
        supplierName: s.supplierName,
        bondStatus: bondStatusByName.get(s.supplierName) ?? null,
        bondReturnedAt: s.bondReturnedAt,
        bondReturnReason: s.bondReturnReason,
        isWinner: !!winner && winner.supplierName === s.supplierName,
      })),
    };
  }

  /**
   * A-105（GB/T 43711 7.5.4.4 / 实施条例第57条）：保证金逐家退还登记（替代项目级 markBondReturned）。
   * 三写单事务（C2 原子）：BidSupplier 逐家退还态 + 开标记录 bondStatus 同步（已退还/不予退还）+ 监督日志
   * （不予退还必填理由，对应 7.5.3.3 情形：弄虚作假/串通/失去履约能力/不交履约担保/拒签 → 高风险留痕）。
   */
  async markSupplierBondReturned(projectId: string, dto: SupplierBondReturnDto) {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, bondRequired: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (!project.bondRequired) throw new BadRequestException({ error: '该项目未要求响应担保', code: 'NO_BOND' });
    const supplier = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierName: dto.supplierName },
      select: { id: true, supplierName: true },
    });
    if (!supplier) throw new BadRequestException({ error: '供应商不在本项目花名册', code: 'SUPPLIER_NOT_IN_ROSTER' });
    if (!dto.returned && !dto.reason?.trim()) {
      throw new BadRequestException({ error: '不予退还必须填写理由（对应 7.5.3.3 情形）', code: 'REASON_REQUIRED' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.bidSupplier.update({
        where: { id: supplier.id },
        data: {
          bondReturnedAt: dto.returned ? new Date() : null,
          bondReturnReason: dto.returned ? null : dto.reason!.trim(),
        },
      });

      // 同步开标记录（唱标口径）bondStatus——两处口径合一；无开标记录（未唱标/补录缺）不阻断（0 行匹配不抛错，
      // 真正的 DB 错误向外抛 → 整个事务回滚，避免退还态与唱标口径脱节）
      await tx.bidOpeningRecord.updateMany({
        where: { projectId, supplierName: dto.supplierName },
        data: { bondStatus: dto.returned ? '已退还' : '不予退还' },
      });

      await tx.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '采购人',
          action: dto.returned ? '响应担保退还（逐家）' : '响应担保不予退还（逐家）',
          target: project.name,
          result: dto.returned ? `${dto.supplierName}：已退还` : `${dto.supplierName}：${dto.reason!.trim()}`,
          riskFlag: dto.returned ? '无' : '高',
        },
      }).catch(e => this.logger.warn(`保证金逐家退还留痕失败: ${(e as Error).message}`));
    });
    return { success: true };
  }
}
