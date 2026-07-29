import { Controller, Get, Put, Body, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UpdateConfigDto } from './dto/update-config.dto';

@ApiTags('系统配置')
@Controller('system-config')
export class SystemConfigController {
  constructor(private configService: SystemConfigService) {}

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
}
