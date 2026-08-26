import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * P3 审批留痕件生成器（附录 B 7.2「流程审批记录」）：
 * 聚合 PMI 阶段流转 + 审批意见 + 操作日志摘录 → 机器可读 JSON 存证
 * （档案系统解析友好；需要人读版式件时由 ASIP「其他」目录的移交清单承载概览）。
 */
@Injectable()
export class ApprovalTrailExporter {
  constructor(private readonly prisma: PrismaService) {}

  async build(pmiId: string): Promise<Buffer> {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: {
        title: true, projectCode: true, requesterName: true, requesterDepartment: true,
        procurementMethod: true, procurementCategory: true, budgetAmount: true,
        contractAmount: true, awardedSupplier: true, createdAt: true, archivedAt: true,
        currentStage: true,
        stages: {
          orderBy: { stageOrder: 'asc' },
          select: { stageKey: true, stageName: true, status: true, note: true, completedAt: true, updatedAt: true },
        },
      },
    });
    if (!item) throw new Error('项目不存在');

    const stageLogs = await this.prisma.operationLog.findMany({
      where: { path: { contains: '/project-management/' }, method: { in: ['POST', 'PATCH'] } },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { createdAt: true, username: true, method: true, path: true, statusCode: true },
    });

    const payload = {
      documentType: '招标投标流程审批留痕',
      standard: 'DA/T 103-2024 附录B 7.2',
      generatedAt: new Date().toISOString(),
      project: {
        title: item.title,
        projectCode: item.projectCode,
        requester: `${item.requesterDepartment}/${item.requesterName}`,
        procurementMethod: item.procurementMethod,
        procurementCategory: item.procurementCategory,
        budgetAmount: item.budgetAmount ? Number(item.budgetAmount) : null,
        contractAmount: item.contractAmount ? Number(item.contractAmount) : null,
        awardedSupplier: item.awardedSupplier,
        currentStage: item.currentStage,
      },
      stageTrail: item.stages.map((s) => ({
        stageKey: s.stageKey,
        stageName: s.stageName,
        status: s.status,
        note: s.note,
        completedAt: s.completedAt?.toISOString() ?? null,
        updatedAt: s.updatedAt.toISOString(),
      })),
      operationTrail: stageLogs.map((l) => ({
        at: l.createdAt.toISOString(),
        actor: l.username,
        method: l.method,
        path: l.path,
        statusCode: l.statusCode,
      })),
    };
    return Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
  }
}
