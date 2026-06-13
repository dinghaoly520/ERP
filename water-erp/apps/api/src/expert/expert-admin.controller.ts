import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpertAdminService } from './expert-admin.service';

@ApiTags('专家管理')
@ApiCookieAuth('token')
@Controller('expert-admin')

@Roles('admin', 'bid_host', 'procurement_staff')
export class ExpertAdminController {
  constructor(private expertAdminService: ExpertAdminService) {}

  @Get()
  @ApiOperation({ summary: '专家库列表' })
  listExperts(@Query('search') search?: string) {
    return this.expertAdminService.listExperts(search);
  }

  @Get(':id')
  @ApiOperation({ summary: '专家详情' })
  getExpert(@Param('id') id: string) {
    return this.expertAdminService.getExpert(id);
  }

  @Get(':id/projects')
  @ApiOperation({ summary: '专家评审项目列表' })
  listExpertProjects(@Param('id') id: string) {
    return this.expertAdminService.listExpertProjects(id);
  }
}
