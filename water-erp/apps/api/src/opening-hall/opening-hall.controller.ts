import { Controller, Get, Post, Patch, Param, Body, Query, Request, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { OpeningHallService, HallActor } from './opening-hall.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { ExchangeControlDto } from './dto/exchange-control.dto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('opening-hall')
export class OpeningHallController {
  constructor(
    private readonly svc: OpeningHallService,
    private readonly prisma: PrismaService,
  ) {}

  /** 由 JWT 用户构造大厅 actor；supplier 角色解析 Supplier.id/名称（与 supplier-portal.controller.getSupplierId 同源）。 */
  private async actor(req: any): Promise<HallActor> {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) throw new BadRequestException({ error: '未登录', code: 'UNAUTHORIZED' });
    const base: HallActor = { userId, role, supplierName: req.user?.username };
    if (role === 'supplier') {
      const supplier = await this.prisma.supplier.findFirst({ where: { userId } });
      if (!supplier) throw new BadRequestException({ error: '供应商信息不存在', code: 'SUPPLIER_NOT_FOUND' });
      base.supplierId = supplier.id;
      base.supplierName = supplier.name;
    }
    return base;
  }

  @Post(':projectId/check-in')
  @Roles('supplier')
  async checkIn(@Request() req: any, @Param('projectId') projectId: string) {
    const ip = req.ip ?? req.connection?.remoteAddress;
    const ua = req.headers?.['user-agent'];
    return this.svc.checkIn(await this.actor(req), projectId, { ip, ua });
  }

  @Get(':projectId/presence')
  async presence(@Request() req: any, @Param('projectId') projectId: string) {
    return this.svc.presence(projectId, await this.actor(req));
  }

  @Post(':projectId/messages')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async send(@Request() req: any, @Param('projectId') projectId: string, @Body() dto: SendMessageDto) {
    return this.svc.sendMessage(await this.actor(req), projectId, dto);
  }

  @Get(':projectId/messages')
  async list(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Query('roomType') roomType: 'PUBLIC' | 'PRIVATE',
    @Query('supplierId') supplierId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    if (roomType !== 'PUBLIC' && roomType !== 'PRIVATE') {
      throw new BadRequestException({ error: 'roomType 须为 PUBLIC 或 PRIVATE', code: 'BAD_ROOM_TYPE' });
    }
    return this.svc.listMessages(await this.actor(req), projectId, {
      roomType, supplierId, cursor, limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':projectId/unread')
  async unread(@Request() req: any, @Param('projectId') projectId: string) {
    return this.svc.unreadCounts(await this.actor(req), projectId);
  }

  @Post(':projectId/read')
  async read(@Request() req: any, @Param('projectId') projectId: string, @Body() dto: MarkReadDto) {
    return this.svc.markRead(await this.actor(req), projectId, dto.roomKey, dto.lastMessageId);
  }

  @Patch(':projectId/exchange-control')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  async control(@Request() req: any, @Param('projectId') projectId: string, @Body() dto: ExchangeControlDto) {
    // byName 给监督日志留痕；actorUserId（JWT sub）作 SYSTEM 提示消息的 senderId
    return this.svc.setExchangeControl(projectId, dto.control, req.user?.username ?? req.user?.sub, req.user.sub);
  }
}
