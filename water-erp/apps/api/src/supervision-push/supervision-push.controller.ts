// apps/api/src/supervision-push/supervision-push.controller.ts
import { Body, Controller, Get, Param, Post, Req, Request } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SupervisionPushService } from './supervision-push.service';
import { PlatformSigningService } from './platform-signing.service';
import { SaveSupervisionConfigDto, SupervisionPushDto } from './dto/supervision-push.dto';

@Controller('supervision-push')
export class SupervisionPushController {
  constructor(
    private readonly svc: SupervisionPushService,
    private readonly platformSigning: PlatformSigningService,
  ) {}

  @Get('config')
  @Roles('admin', 'leader', 'staff')
  getConfig() { return this.svc.getMaskedConfig(); }

  @Post('config')
  @Roles('admin')
  saveConfig(@Body() dto: SaveSupervisionConfigDto, @Request() req: any) {
    return this.svc.saveConfig(dto, req.user?.sub);
  }

  @Get('platform-cert')
  @Roles('admin', 'leader', 'staff')
  platformCert() { return this.platformSigning.ensureKey(); }

  @Post('projects/:id/push')
  @Roles('admin', 'leader', 'staff')
  push(@Param('id') id: string, @Body() dto: SupervisionPushDto, @Req() req: any) {
    return this.svc.push(id, dto.payloadType ?? 'EVALUATION_REPORT', req.user?.sub);
  }

  @Get('projects/:id/status')
  @Roles('admin', 'leader', 'staff')
  status(@Param('id') id: string) { return this.svc.getStatus(id); }

  @Get('projects/:id/logs')
  @Roles('admin', 'leader', 'staff')
  logs(@Param('id') id: string) { return this.svc.listLogs(id); }

  @Post('projects/:id/voucher')
  @Roles('admin', 'leader', 'staff')
  voucher(@Param('id') id: string, @Body() dto: SupervisionPushDto, @Req() req: any) {
    return this.svc.exportVoucher(id, dto.payloadType ?? 'EVALUATION_REPORT', req.user?.sub);
  }
}
