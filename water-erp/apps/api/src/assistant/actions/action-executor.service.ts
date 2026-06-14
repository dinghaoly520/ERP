import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActionExecutorService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    actionLogId: string,
  ): Promise<{ status: string; message: string }> {
    const log = await this.prisma.assistantActionLog.findUnique({
      where: { id: actionLogId },
    });

    if (!log || log.status !== 'confirmed') {
      return { status: 'failed', message: '操作未确认或不存在' };
    }

    try {
      const payload = log.payloadJson as Record<string, unknown>;
      const targetType = log.targetType || '';
      const actionType = log.actionType || '';

      // Supplier operations
      if (targetType === 'supplier' && actionType === 'update_status') {
        await this.prisma.supplier.update({
          where: { id: log.targetId! },
          data: { status: payload.newStatus as never },
        });
      } else if (targetType === 'supplier' && actionType === 'return') {
        await this.prisma.supplier.update({
          where: { id: log.targetId! },
          data: {
            status: 'RETURNED',
            returnReason: (payload.reason as string) || '退回补正',
          },
        });
      } else if (targetType === 'supplier' && actionType === 'approve') {
        await this.prisma.supplier.update({
          where: { id: log.targetId! },
          data: { status: 'APPROVED' },
        });
      } else if (targetType === 'supplier' && actionType === 'reject') {
        await this.prisma.supplier.update({
          where: { id: log.targetId! },
          data: {
            status: 'REJECTED',
            rejectReason: (payload.reason as string) || '审核不通过',
          },
        });
      }
      // Procurement operations
      else if (targetType === 'procurement' && actionType === 'approve') {
        await this.prisma.procurementProject.update({
          where: { id: log.targetId! },
          data: { status: 'APPROVED' },
        });
      } else if (targetType === 'procurement' && actionType === 'reject') {
        await this.prisma.procurementProject.update({
          where: { id: log.targetId! },
          data: {
            status: 'REJECTED',
            rejectReason: (payload.reason as string) || '审批驳回',
          },
        });
      }
      // Announcement operations
      else if (targetType === 'announcement' && actionType === 'publish') {
        await this.prisma.announcement.update({
          where: { id: log.targetId! },
          data: { status: 'PUBLISHED', publishDate: new Date() },
        });
      } else if (targetType === 'announcement' && actionType === 'archive') {
        await this.prisma.announcement.update({
          where: { id: log.targetId! },
          data: { status: 'ARCHIVED' },
        });
      }
      // Bid project operations
      else if (targetType === 'bid' && actionType === 'archive') {
        await this.prisma.bidProject.update({
          where: { id: log.targetId! },
          data: { stage: 'ARCHIVED' },
        });
      } else {
        return { status: 'failed', message: `不支持的操作: ${targetType}.${actionType}` };
      }

      await this.prisma.assistantActionLog.update({
        where: { id: actionLogId },
        data: {
          status: 'success',
          executedAt: new Date(),
          resultJson: { message: '操作成功' } as any,
        },
      });

      return { status: 'success', message: '操作成功' };
    } catch (e) {
      await this.prisma.assistantActionLog.update({
        where: { id: actionLogId },
        data: {
          status: 'failed',
          resultJson: { error: (e as Error).message } as any,
        },
      });
      return { status: 'failed', message: `操作执行失败: ${(e as Error).message}` };
    }
  }
}
