import { Controller, Get, Put, Body, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';
import { HealthAggregateService } from './health-aggregate.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UpdateConfigDto } from './dto/update-config.dto';

@ApiTags('系统配置')
@Controller('system-config')
export class SystemConfigController {
  constructor(
    private configService: SystemConfigService,
    private readonly healthService: HealthAggregateService,
  ) {}

  /** 系统健康：组件实质指标 + 全量 24h 接口口径 + Top 榜 + 队列快照 + 分析服务心跳 */
  @Get('health')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '系统健康聚合读' })
  async health() {
    return this.healthService.read();
  }

  // 澄清说明文案：供应商端公开读取（非敏感信息，与公告 public 端点一致）
  @Get('clarification-notice')
  @Public()
  @ApiOperation({ summary: '澄清说明文案（公开）' })
  async getClarificationNotice() {
    const row = await this.configService.get('supplier_clarification_notice');
    return { value: row?.value ?? '' };
  }

  // 编辑发布澄清说明文案：仅采购管理方
  @Put('clarification-notice')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '编辑发布澄清说明文案' })
  async updateClarificationNotice(@Body() dto: UpdateConfigDto, @Request() req: any) {
    return this.configService.set('supplier_clarification_notice', dto.value, req.user?.sub);
  }

  // 异议联系方式（2026-09-11，源自澄清说明页）：公告发布向导带入、公告详情页单独展示；公开读取
  @Get('objection-contact')
  @Public()
  @ApiOperation({ summary: '异议联系方式（公开）' })
  async getObjectionContact() {
    const row = await this.configService.get('objection_contact');
    return { value: row?.value ?? '' };
  }

  // 编辑异议联系方式：仅采购管理方
  @Put('objection-contact')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '编辑异议联系方式' })
  async updateObjectionContact(@Body() dto: UpdateConfigDto, @Request() req: any) {
    return this.configService.set('objection_contact', dto.value, req.user?.sub);
  }
}
