import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * W8（CTS-EBS01 A-115 开标记录模板 / A-147 评标模板，★★★）。
 * 通用模板仓库：kind=opening_record（导出列预设）/ evaluation（评分项预设）。
 * 同 kind 同一时刻仅一个 isActive 生效（取最新 active）；无 active 时调用方回退内置默认。
 */
@Injectable()
export class WorkTemplateService {
  private readonly logger = new Logger(WorkTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  listForKind(kind: string) {
    return this.prisma.workTemplate.findMany({
      where: { kind },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async create(kind: string, name: string, content: object, createdBy?: string) {
    // 同 kind 首个模板自动置活跃；后续默认非活跃（须手动 activate）
    const existingCount = await this.prisma.workTemplate.count({ where: { kind } });
    try {
      return await this.prisma.workTemplate.create({
        data: { kind, name, content: content as Prisma.InputJsonValue, isActive: existingCount === 0, createdBy: createdBy ?? null },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new BadRequestException({ error: '同名模板已存在（kind+name 唯一）', code: 'TEMPLATE_DUPLICATE' });
      }
      throw e;
    }
  }

  /** 设置生效模板：先停用同 kind 全部，再置目标为 active。 */
  async activate(id: string) {
    const tpl = await this.prisma.workTemplate.findUnique({ where: { id } });
    if (!tpl) throw new BadRequestException({ error: '模板不存在', code: 'NOT_FOUND' });
    await this.prisma.workTemplate.updateMany({ where: { kind: tpl.kind }, data: { isActive: false } });
    await this.prisma.workTemplate.update({ where: { id }, data: { isActive: true } });
    return this.prisma.workTemplate.findUnique({ where: { id } });
  }

  async activeForKind(kind: string) {
    return this.prisma.workTemplate.findFirst({ where: { kind, isActive: true }, orderBy: { updatedAt: 'desc' } });
  }
}
