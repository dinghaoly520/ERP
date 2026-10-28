import { Controller, Get, Param, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { INTERNAL_ROLES } from '../auth/auth-scope';
import { AlertsService } from './alerts.service';

@ApiTags('告警')
@ApiCookieAuth('token')
@Controller('alerts')
@Roles(...INTERNAL_ROLES)
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get('overview')
  @ApiOperation({ summary: '仪表盘告警总览（临期资质/过载专家；公司视野+库内四态口径，2026-10-28 收口）' })
  overview(@Request() req: any = {}) { return this.alerts.overview(req.user); }

  @Get('supplier/:id')
  @ApiOperation({ summary: '某供应商告警（临期资质）' })
  supplierAlerts(@Param('id') id: string) { return this.alerts.supplierAlerts(id); }

  @Get('expert/:id')
  @ApiOperation({ summary: '某专家告警（过载/连续D级）' })
  expertAlerts(@Param('id') id: string) { return this.alerts.expertAlerts(id); }
}
