import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** A-109：法定最少投标人家数（单一来源；bid.service.getMinBidders 委托此处） */
export function getMinBiddersForMethod(procurementMethod: string | null): number {
  if (procurementMethod === '直接采购') return 1;
  return 3;
}

/**
 * A-109a：解密 quorum 闸门——「已签到且已递交」家数不足法定最少家数时禁止进入解密。
 * 挂四个解密入口：旧轨主持端代解密 decryptSupplier、外层解密 decryptOuterOne、
 * 供应商取包 getOpeningPackage、供应商自解 decryptUpload。
 * 出口=等待签到/流标/延长窗口，不提供 force 绕过。
 */
export async function assertDecryptCheckInQuorum(prisma: PrismaService, projectId: string): Promise<void> {
  const project = await prisma.bidProject.findUnique({
    where: { id: projectId },
    select: { name: true, procurementMethod: true },
  });
  if (!project) throw new NotFoundException('项目不存在');
  const min = getMinBiddersForMethod(project.procurementMethod);
  const signedIn = await prisma.bidSupplier.count({
    where: { projectId, submitStatus: '已提交', checkInAt: { not: null } },
  });
  if (signedIn < min) {
    throw new BadRequestException({
      error: `已签到且已递交的投标人仅 ${signedIn} 家，不足法定最少 ${min} 家（${project.procurementMethod ?? '未知采购方式'}），暂不得进入解密；请等待其余投标人签到，确实不足的请按流标处理`,
      code: 'INSUFFICIENT_CHECKIN',
    });
  }
}
