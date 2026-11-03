import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BidService } from '../../bid/bid.service';

/** 目标实体 → 公司归属列（写动作公司断言用；与 assistant/tools/company-filter 口径一致） */
const TARGET_COMPANY: Record<string, (id: string) => { model: string; where: Record<string, string> }> = {
  supplier: (id) => ({ model: 'supplier', where: { id } }),
  procurement: (id) => ({ model: 'procurementProject', where: { id } }),
  announcement: (id) => ({ model: 'announcement', where: { id } }),
  bid: (id) => ({ model: 'bidProject', where: { id } }),
};

@Injectable()
export class ActionExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bidService: BidService,
  ) {}

  /** 写动作目标公司断言（2026-11-03 稳健收口）：执行按 id 裸写四域——属主闸
   *  （assertActionOwnership）只认会话属主，不看目标归属。现要求非 admin 操作人
   *  公司与目标归属一致（目标无归属/操作人无公司=拒）；admin 直通；缺操作人上下文=拒
   *  （防御纵深：当前唯一调用方 confirmAction 恒带 user）。 */
  private async assertTargetInActorScope(
    targetType: string,
    targetId: string | null | undefined,
    actor?: { sub?: string; role?: string },
  ): Promise<string | null> {
    if (!actor?.sub) return '缺少操作人上下文，拒绝执行';
    if (actor.role === 'admin') return null;
    const probeFn = TARGET_COMPANY[targetType];
    if (!probeFn) return null; // 未知类型由下方「不支持的操作」分支拦
    if (!targetId) return '操作目标缺失';
    const me = await this.prisma.user.findUnique({ where: { id: actor.sub }, select: { companyId: true } });
    if (!me?.companyId) return '操作人无归属公司，拒绝跨公司写操作';
    const probe = probeFn(targetId);
    const target = await (this.prisma as any)[probe.model].findUnique({
      where: probe.where,
      select: { companyId: true },
    });
    if (!target) return '操作目标不存在';
    if (target.companyId !== me.companyId) return '目标不属于操作人所属公司，已拒绝（公司隔离）';
    return null;
  }

  async execute(
    actionLogId: string,
    actor?: { sub?: string; role?: string },
  ): Promise<{ status: string; message: string }> {
    const log = await this.prisma.assistantActionLog.findUnique({
      where: { id: actionLogId },
    });

    if (!log || log.status !== 'confirmed') {
      return { status: 'failed', message: '操作未确认或不存在' };
    }

    // 写动作公司断言：不通过即落 failed 留痕（经对话呈现可读原因），不触任何写
    const scopeError = await this.assertTargetInActorScope(log.targetType || '', log.targetId, actor);
    if (scopeError) {
      await this.prisma.assistantActionLog.update({
        where: { id: actionLogId },
        data: { status: 'failed', resultJson: { error: scopeError } as any },
      });
      return { status: 'failed', message: scopeError };
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
