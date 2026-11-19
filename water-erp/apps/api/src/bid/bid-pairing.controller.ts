import { Controller, Delete, Param, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AssignedHostGuard } from './assigned-host.guard';
import { BidPairingService } from './bid-pairing.service';

/**
 * TAB-SYNC-02 P2-4：主持端（:3007）平板配对处置端点——核验矩阵「解绑平板」操作的数据面。
 * 权限与既有 host 端点同款：四内部角色 + AssignedHostGuard（admin 或被指派主持人，
 * 未指派的同公司 bid_host 403 NOT_ASSIGNED_HOST——2026-10-15 指派跟随口径）。
 * 独立控制器文件（不并入 bid.controller.ts——共享高危文件避让）。
 */
@Controller('bid')
export class BidPairingController {
  constructor(private readonly pairing: BidPairingService) {}

  @Delete('projects/:id/experts/:expertId/pairing')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseGuards(AssignedHostGuard)
  unpairExpert(
    @Param('id') id: string,
    @Param('expertId') expertId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.pairing.unpairExpert(id, expertId, userId);
  }
}
