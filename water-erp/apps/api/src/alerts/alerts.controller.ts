import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';

@ApiTags('告警')
@ApiCookieAuth('token')
@Controller('alerts')
export class AlertsController {
  constructor(private alerts: AlertsService) {}

  @Get('overview')
  @ApiOperation({ summary: '仪表盘告警总览（临期资质/过载专家）' })
  overview() { return this.alerts.overview(); }

  @Get('supplier/:id')
  @ApiOperation({ summary: '某供应商告警（临期资质）' })
  supplierAlerts(@Param('id') id: string) { return this.alerts.supplierAlerts(id); }

  @Get('expert/:id')
  @ApiOperation({ summary: '某专家告警（过载/连续D级）' })
  expertAlerts(@Param('id') id: string) { return this.alerts.expertAlerts(id); }
}
