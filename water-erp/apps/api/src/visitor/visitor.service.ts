import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import type { CreateVisitorRegistrationDto } from './dto/create-visitor-registration.dto';

/**
 * 供应商来访接待登记（2026-09-30）：
 * 门户匿名提交 → 解析「访问单位」归属公司 → 通知该公司全部 staff 账号（:3005 通知中心 + WS 实时弹窗）。
 * 公司未建档或该公司无 staff → 回退平台 admin（与 COMPANY_LEADER_STAFF「无人回退平台 admin」惯例一致）。
 */
@Injectable()
export class VisitorService {
  private readonly logger = new Logger(VisitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
  ) {}

  async register(dto: CreateVisitorRegistrationDto) {
    const company = await this.prisma.company.findUnique({
      where: { name: dto.visitUnit },
      select: { id: true, name: true },
    });

    let recipients = company
      ? await this.prisma.user.findMany({
          where: { role: 'staff', companyId: company.id, isActive: true },
          select: { id: true },
        })
      : [];
    let fallbackToAdmin = false;
    if (recipients.length === 0) {
      fallbackToAdmin = true;
      recipients = await this.prisma.user.findMany({
        where: { role: 'admin', isActive: true },
        select: { id: true },
      });
      this.logger.warn(
        `访问单位「${dto.visitUnit}」未匹配到 staff 账号（company=${company ? '已建档' : '未建档'}），回退通知 ${recipients.length} 名 admin`,
      );
    }

    const title = `供应商来访登记：${dto.organization || dto.name}`;
    const content = this.renderContent(dto);
    await Promise.all(
      recipients.map(u =>
        this.notification.create({
          userId: u.id,
          type: 'SUPPLIER_VISIT_REGISTERED',
          title,
          content,
        }),
      ),
    );

    this.logger.log(`供应商来访登记已通知 ${recipients.length} 人：${title}（visitUnit=${dto.visitUnit}）`);
    return {
      notified: recipients.length,
      companyMatched: company?.name ?? null,
      fallbackToAdmin,
    };
  }

  private renderContent(dto: CreateVisitorRegistrationDto): string {
    return [
      `来访人：${dto.name}（${dto.phone}）`,
      dto.organization ? `供应商单位：${dto.organization}` : null,
      `访问单位：${dto.visitUnit}`,
      dto.visitorCount ? `来访人数：${dto.visitorCount} 人` : null,
      `来访日期：${dto.visitDate}`,
      `来访事由：${dto.purpose}`,
      dto.remark ? `备注：${dto.remark}` : null,
    ]
      .filter((x): x is string => !!x)
      .join('\n');
  }
}
