import { Controller, Get, Post, Param, Body, Query, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OpeningSignService } from './opening-sign.service';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

class SignScanDto {
  @IsString() @IsNotEmpty() @IsIn(['host', 'supervisor'])
  role!: 'host' | 'supervisor';
}

@ApiTags('开标签字')
@Controller('bid/projects/:id/opening')
// :3007 工作区准入同款角色集——被指派为主持人的 leader/staff 同样有资格办理开标记录签字
@Roles('admin', 'bid_host', 'leader', 'staff')
export class OpeningSignController {
  constructor(private readonly openingSignService: OpeningSignService) {}

  @Get('sign-status')
  @ApiOperation({ summary: '开标记录签字状态（P1-3）' })
  getStatus(@Param('id') id: string) {
    return this.openingSignService.getStatus(id);
  }

  @Post('sign-page')
  @ApiOperation({ summary: '生成开标记录签字页 PDF（主持人打印→签字→扫描回传）' })
  generateSignPage(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.openingSignService.generateSignPage(id, userId);
  }

  @Post('sign-scan')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传开标签字扫描件（host/supervisor）' })
  uploadSignScan(
    @Param('id') id: string,
    @Query('role') role: string,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser('sub') userId?: string,
  ) {
    if (!file) throw new BadRequestException({ error: '缺少扫描文件', code: 'FILE_MISSING' });
    if (role !== 'host' && role !== 'supervisor') {
      throw new BadRequestException({ error: 'role 须为 host 或 supervisor', code: 'INVALID_ROLE' });
    }
    return this.openingSignService.uploadSignScan(id, role, file, userId);
  }

  @Post('sign-register')
  @ApiOperation({ summary: '登记签字闭环（重建开标文件包含 signatures 段）' })
  registerSign(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return this.openingSignService.registerSign(id, userId);
  }
}
