import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AnnouncementService } from './announcement.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';

@ApiTags('信息公告')
@Controller('announcements')
export class AnnouncementController {
  constructor(private announcementService: AnnouncementService) {}

  // ─── 公开接口 ───

  @Get('public')
  @Public()
  @ApiOperation({ summary: '公开公告列表' })
  async publicList(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.announcementService.publicList({ type, search, page, pageSize });
  }

  @Get('public/:id')
  @Public()
  @ApiOperation({ summary: '公开公告详情' })
  async getPublic(@Param('id') id: string) {
    return this.announcementService.getPublic(id);
  }

  // ─── 管理接口 ───

  @Get()
  @ApiOperation({ summary: '公告列表（管理端）' })
  async list(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.announcementService.list({ type, status, search, page, pageSize });
  }

  @Get('stats')
  @ApiOperation({ summary: '公告统计' })
  async getStats() {
    return this.announcementService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: '公告详情' })
  async get(@Param('id') id: string) {
    return this.announcementService.get(id);
  }

  @Post()
  @Roles('admin', 'bid_host', 'procurement_staff')
  @ApiOperation({ summary: '创建公告' })
  async create(@Body() dto: CreateAnnouncementDto, @Request() req: any) {
    return this.announcementService.create(dto, req.user.sub);
  }

  @Put(':id')
  @Roles('admin', 'bid_host', 'procurement_staff')
  @ApiOperation({ summary: '更新公告' })
  async update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcementService.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin', 'procurement_staff')
  @ApiOperation({ summary: '删除公告' })
  async remove(@Param('id') id: string) {
    return this.announcementService.remove(id);
  }
}
