import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ExpertAdminService } from '../expert/expert-admin.service';
import { SupplierService } from '../supplier/supplier.service';

export function buildExpiryNotification(input: { qualificationName: string; validTo: Date; daysLeft: number }) {
  const date = input.validTo.toISOString().slice(0, 10);
  return {
    type: 'QUALIFICATION_EXPIRING',
    title: '资质即将到期提醒',
    content: `您的资质材料「${input.qualificationName}」将于 ${date} 到期（剩 ${input.daysLeft} 天），请及时更新以免影响投标资格。`,
    link: '/supplier/qualifications',
  };
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private notification: NotificationService,
    private expertAdmin: ExpertAdminService,
    private supplierService: SupplierService,
  ) {}

  /** 每日 09:00 扫描未来 N 天内到期且未通知的资质，向供应商发站内信（经多渠道分发）。 */
  @Cron('0 9 * * *')
  async scanExpiringQualifications() {
    const horizon = Number(process.env.QUALIFICATION_EXPIRY_DAYS ?? 30);
    const now = new Date();
    const cutoff = new Date(now.getTime() + horizon * 24 * 3600 * 1000);

    const expiring = await this.prisma.supplierQualification.findMany({
      where: { validTo: { gte: now, lte: cutoff }, status: '有效' },
      include: { supplier: { select: { userId: true, name: true } } },
    });

    for (const q of expiring) {
      const daysLeft = Math.ceil((q.validTo!.getTime() - now.getTime()) / (24 * 3600 * 1000));
      const dto = buildExpiryNotification({ qualificationName: q.name, validTo: q.validTo!, daysLeft });
      await this.notification.create({ userId: q.supplier.userId, ...dto });
    }

    this.logger.log(`资质到期扫描完成：通知 ${expiring.length} 条`);
  }

  /** 每周一 01:00 扫描专家退库 / 供应商淘汰候选（仅预警通知，不自动改状态——决策 #3）。 */
  @Cron('0 1 * * 1')
  async scanRetirementAndEliminationCandidates() {
    const [experts, suppliers] = await Promise.all([
      this.expertAdmin.reviewRetirementCandidates().catch((e: Error) => {
        this.logger.error(`专家退库扫描失败：${e.message}`);
        return [];
      }),
      this.supplierService.reviewEliminationCandidates().catch((e: Error) => {
        this.logger.error(`供应商淘汰扫描失败：${e.message}`);
        return [];
      }),
    ]);
    this.logger.log(`退库/淘汰预警扫描完成：专家候选 ${experts.length} 名，供应商候选 ${suppliers.length} 家`);
  }
}
