import { Injectable, Optional } from '@nestjs/common';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertPairingRegistry } from '../auth/expert-pairing.registry';
import { BidGateway } from './bid.gateway';

/**
 * TAB-SYNC-02 P2-4：主持端远程解绑——:3007 现场」（核验矩阵）对配对中平板的
 * 远程处置。与专家桌面自解绑（expert.service unpair）同轨：registry.revoke + 监督日志；
 * 差异点=操作人为主持方（日志注明）、并即时广播 pairing:revoked + 踢除 scoped socket
 * （P2-2 网关能力）。独立文件不并入 bid.controller（并行会话共享高危文件避让 +
 * 单一职责）；权限面 AssignedHostGuard 与既有 host 端点同款（admin/被指派主持人）。
 */
@Injectable()
export class BidPairingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly gateway?: BidGateway,
    @Optional() private readonly pairingRegistry?: ExpertPairingRegistry,
  ) {}

  /** 主持端远程解绑：revoke + 监督日志（操作人留痕）+ 即时广播/踢除（P2-2）。
   *  无活动配对 → 幂等 ok（与桌面自解绑同语义，不写日志）。 */
  async unpairExpert(projectId: string, expertId: string, operatorUserId: string): Promise<{ ok: true }> {
    const expert = await this.prisma.bidExpert.findFirst({
      where: { id: expertId, projectId },
      select: { id: true, expertName: true },
    });
    if (!expert) throw new ForbiddenException({ error: '专家不在该项目', code: 'NOT_PROJECT_EXPERT' });
    if (!this.pairingRegistry) throw new ServiceUnavailableException('Redis 不可用，解除配对暂不可用');
    const active = await this.pairingRegistry.getActive(expert.id, projectId);
    if (!active) return { ok: true };
    const revoked = await this.pairingRegistry.revoke(active.pairingId);
    if (revoked) {
      const operator = await this.prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { displayName: true },
      }).catch(() => null);
      await this.prisma.bidSupervisionLog.create({
        data: {
          projectId, time: new Date(), role: '评审专家', target: expert.expertName,
          action: '平板解除配对',
          result: `主持端远程解绑（操作人 ${operator?.displayName ?? operatorUserId}）`,
          riskFlag: '无',
        },
      }).catch(() => {});
      // P2-2：即时断连——平板收事件断开/回配对页，scoped socket 直接踢除
      this.gateway?.notifyPairingRevoked(projectId, expert.id);
      this.gateway?.kickPairingSockets(expert.id);
    }
    return { ok: true };
  }
}
