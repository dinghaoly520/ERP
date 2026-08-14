import { Controller, Get, Post, Query, Body, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RsvpService } from './rsvp.service';

/** 采购邀请回执（RSVP）—— 无登录签名链接的校验/回执 + 采购端看板。 */
@ApiTags('邀请回执 RSVP')
@Controller('supplier/rsvp')
export class RsvpController {
  constructor(private rsvp: RsvpService) {}

  private clientIp(req: any): string | undefined {
    const xff = req?.headers?.['x-forwarded-for'];
    const ip = (typeof xff === 'string' ? xff.split(',')[0] : req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress) || undefined;
    return ip ? String(ip).trim() : undefined;
  }

  @Public()
  @Get('verify')
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // 公开端点限流，防 token 探测
  @ApiOperation({ summary: '校验回执链接（公开，返回展示信息+当前状态）' })
  async verify(@Query('t') t?: string) {
    if (!t) throw new BadRequestException({ error: '缺少回执凭证', code: 'MISSING_TOKEN' });
    try {
      return await this.rsvp.verify(t);
    } catch (e: any) {
      const code = e?.response?.code || e?.message;
      if (code === 'RSVP_NOT_FOUND') throw new BadRequestException({ error: '回执链接无效或已失效', code: 'RSVP_NOT_FOUND' });
      if (code === 'RSVP_TOKEN_EXPIRED') throw new BadRequestException({ error: '回执链接已过期', code: 'RSVP_EXPIRED' });
      throw new BadRequestException({ error: '回执链接无效或已被篡改', code: 'RSVP_TOKEN_INVALID' });
    }
  }

  @Public()
  @Post('respond')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '提交回执（公开，幂等；接受且带项目→纳入项目，拒绝仅记录）' })
  async respond(@Query('t') t: string, @Body() body: { status?: 'ACCEPTED' | 'DECLINED'; note?: string }, @Req() req: any) {
    if (!t) throw new BadRequestException({ error: '缺少回执凭证', code: 'MISSING_TOKEN' });
    if (!body?.status) throw new BadRequestException({ error: '请选择是否参加', code: 'MISSING_STATUS' });
    try {
      return await this.rsvp.respond(t, { status: body.status, note: body.note, ip: this.clientIp(req), ua: req?.headers?.['user-agent'] });
    } catch (e: any) {
      const code = e?.response?.code || e?.message;
      if (code === 'RSVP_NOT_FOUND') throw new BadRequestException({ error: '回执链接无效或已失效', code: 'RSVP_NOT_FOUND' });
      if (code === 'RSVP_EXPIRED') throw new BadRequestException({ error: '回执链接已过期，请联系采购方重新发送邀请', code: 'RSVP_EXPIRED' });
      if (e?.response) throw e;
      throw new BadRequestException({ error: '回执链接无效或已被篡改', code: 'RSVP_TOKEN_INVALID' });
    }
  }

  @Get('list')
  @Roles('admin', 'leader', 'staff')
  @ApiOperation({ summary: '回执看板（采购端，按项目/批次聚合 接受/拒绝/未回复）' })
  async list(@Query('projectId') projectId?: string, @Query('invitationId') invitationId?: string) {
    return this.rsvp.list({ projectId, invitationId });
  }
}
