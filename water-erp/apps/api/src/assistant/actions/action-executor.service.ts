import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BidService } from '../../bid/bid.service';

@Injectable()
export class ActionExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bidService: BidService,
  ) {}

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
      // 收编：不再裸写 stage，走 archiveAll 正规归档路径（守卫 + 归档材料 + 哈希链 + 阶段联动）。
      // 注意失败语义变化：存在已确认供应商但无评标结果的项目会 409 失败（设计意图），
      // 失败原因经下方 catch 落 assistantActionLog.resultJson，由助理对话呈现可读信息。
      else if (targetType === 'bid' && actionType === 'archive') {
        await this.bidService.archiveAll(log.targetId!, undefined, 'full');
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
