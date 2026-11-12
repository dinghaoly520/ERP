import { BadRequestException, Body, Controller, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AssignedHostGuard } from './assigned-host.guard';
import { BidSignPacketService } from './bid-sign-packet.service';
import { RegisterSignDto, ReopenSignPacketDto } from './dto/bid-sign-packet.dto';

@ApiTags('开评标管理·评标签字')
@ApiCookieAuth('token')
@Controller('bid/projects/:id/sign-packet')
export class BidSignPacketController {
  constructor(private readonly service: BidSignPacketService) {}

  @Post('generate')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseGuards(AssignedHostGuard)
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
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseGuards(AssignedHostGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传专家签字页/不同意见书扫描件（jpg/png/pdf ≤10MB）' })
  uploadExpertScan(
    @Param('id') id: string,
    @Param('expertId') expertId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string,
  ) {
    if (!file) throw new BadRequestException({ error: '缺少上传文件（multipart field=file）', code: 'SIGN_SCAN_REQUIRED' });
    return this.service.uploadExpertScan(id, expertId, { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname }, userId);
  }

  @Post('signature-page/scan')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseGuards(AssignedHostGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '上传主报告签字页扫描件（全员共签页）' })
  uploadSignaturePageScan(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser('sub') userId: string,
  ) {
    if (!file) throw new BadRequestException({ error: '缺少上传文件（multipart field=file）', code: 'SIGN_SCAN_REQUIRED' });
    return this.service.uploadSignaturePageScan(id, { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname }, userId);
  }

  @Post('experts/:expertId/register')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseGuards(AssignedHostGuard)
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
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseGuards(AssignedHostGuard)
  @ApiOperation({ summary: '撤销签字登记（仅闭环前）' })
  unregister(@Param('id') id: string, @Param('expertId') expertId: string, @CurrentUser('sub') userId: string) {
    return this.service.unregister(id, expertId, userId);
  }

  @Post('handover')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @UseGuards(AssignedHostGuard)
  @ApiOperation({ summary: '生成评标回流包（签字闭环后，回传 :3005）' })
  generateHandover(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.service.generateHandover(id, userId);
  }

  @Post('reopen')
  @Roles('admin')
  @ApiOperation({ summary: '重开已闭环签字包（数据修正：解闭环+全员回待签；仅 admin，理由必填入监督日志）' })
  reopen(@Param('id') id: string, @Body() dto: ReopenSignPacketDto, @CurrentUser('sub') userId: string) {
    return this.service.reopen(id, dto, userId);
  }

  /** #115（2026-11-12 B+ 裁定）：评标证据包 zip 下载——分目录聚合回流清单/签字包/扫描件/
   *  开标移交/监督时间线/评标结果/AI 报告；裸 JSON 机器通道保留（:3005 fetch），人只触达 zip。 */
  @Get('evidence-zip')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '下载评标证据包（zip：00回流清单/01评标签字/02开标移交/03监督时间线/04评标结果/05AI辅助评标）' })
  async downloadEvidenceZip(@Param('id') id: string, @Res() res: any) {
    const { buffer, fileName } = await this.service.buildEvidenceZip(id);
    const enc = encodeURIComponent(fileName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `attachment; filename="${enc}"; filename*=UTF-8''${enc}`);
    res.send(buffer);
  }
}
