import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { BidSignPacketService } from './bid-sign-packet.service';
import { RegisterSignDto } from './dto/bid-sign-packet.dto';

@ApiTags('开评标管理·评标签字')
@ApiCookieAuth('token')
@Controller('bid/projects/:id/sign-packet')
export class BidSignPacketController {
  constructor(private readonly service: BidSignPacketService) {}

  @Post('generate')
  @Roles('bid_host', 'admin')
  @ApiOperation({ summary: '生成评标签字包（快照评标数据→PDF，重生成重置签字状态）' })
  generate(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.service.generate(id, userId);
  }

  @Get()
  @Roles('bid_host', 'admin', 'leader', 'staff')
  @ApiOperation({ summary: '签字包状态：包信息+指纹+每专家签字状态' })
  get(@Param('id') id: string) {
    return this.service.getStatus(id);
  }

  @Post('experts/:expertId/scan')
  @Roles('bid_host', 'admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传专家签字页/不同意见书扫描件（jpg/png/pdf ≤10MB）' })
  uploadExpertScan(
    @Param('id') id: string,
    @Param('expertId') expertId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.uploadExpertScan(id, expertId, { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname }, userId);
  }

  @Post('signature-page/scan')
  @Roles('bid_host', 'admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传主报告签字页扫描件（全员共签页）' })
  uploadSignaturePageScan(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.uploadSignaturePageScan(id, { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname }, userId);
  }

  @Post('experts/:expertId/register')
  @Roles('bid_host', 'admin')
  @ApiOperation({ summary: '登记专家签字状态（§43 语义：已签/拒绝附不同意见/视为同意）' })
  register(
    @Param('id') id: string,
    @Param('expertId') expertId: string,
    @Body() dto: RegisterSignDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.register(id, expertId, dto, userId);
  }

  @Post('experts/:expertId/unregister')
  @Roles('bid_host', 'admin')
  @ApiOperation({ summary: '撤销签字登记（仅闭环前）' })
  unregister(@Param('id') id: string, @Param('expertId') expertId: string, @CurrentUser('sub') userId: string) {
    return this.service.unregister(id, expertId, userId);
  }

  @Post('handover')
  @Roles('bid_host', 'admin')
  @ApiOperation({ summary: '生成评标回流包（签字闭环后，回传 :3005）' })
  generateHandover(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.service.generateHandover(id, userId);
  }
}
