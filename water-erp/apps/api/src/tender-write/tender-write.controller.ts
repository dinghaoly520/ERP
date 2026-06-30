import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ExportTenderWriteDto, ExportAnnouncementDto, ExportNotificationLetterDto } from './tender-write.dto';
import { ImportAutofillDto } from './import-autofill.dto';
import { TenderWriteService } from './tender-write.service';

@Controller('tender-write')
export class TenderWriteController {
  constructor(private readonly tenderWriteService: TenderWriteService) {}

  @Post('export')
  async export(@Body() dto: ExportTenderWriteDto, @Res() res: Response) {
    const { buffer, fileName } = await this.tenderWriteService.exportDocument(dto);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.send(buffer);
  }

  @Post('export-announcement')
  async exportAnnouncement(
    @Body() dto: ExportAnnouncementDto,
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.tenderWriteService.exportAnnouncement(dto);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.send(buffer);
  }

  @Post('import-autofill')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importAutofill(
    @Body() dto: ImportAutofillDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('请至少上传一个文件。');
    }

    return this.tenderWriteService.importAutofill(
      dto.documentType,
      files.map((f) => ({
        buffer: f.buffer,
        // Multer encodes multipart filenames as Latin1; convert back to UTF-8
        originalname: Buffer.from(f.originalname, 'latin1').toString('utf-8'),
      })),
    );
  }

  @Post('import-winning-bid')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importWinningBid(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请上传定标审批表文件。');
    }

    return this.tenderWriteService.importWinningBidFromBuffer(
      file.buffer,
      // Multer encodes multipart filenames as Latin1; convert back to UTF-8
      Buffer.from(file.originalname, 'latin1').toString('utf-8'),
    );
  }

  @Post('extract-notification-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async extractNotificationData(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请上传定标审批表文件。');
    }

    return this.tenderWriteService.extractNotificationDataFromBuffer(
      file.buffer,
      Buffer.from(file.originalname, 'latin1').toString('utf-8'),
    );
  }

  @Post('export-notification')
  async exportNotification(
    @Body() dto: ExportNotificationLetterDto,
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.tenderWriteService.exportNotificationLetter(dto);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.send(buffer);
  }

  @Post('export-notification-ledger')
  async exportNotificationLedger(
    @Body() dto: ExportNotificationLetterDto,
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.tenderWriteService.exportNotificationLedger(dto);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.send(buffer);
  }

  @Get('notification-ledger')
  async getNotificationLedger() {
    return this.tenderWriteService.getNotificationLedger();
  }

  @Post('notification-ledger')
  async updateNotificationLedger(
    @Body() dto: { rows: unknown[][] },
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.tenderWriteService.updateAndExportNotificationLedger(dto.rows);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.send(buffer);
  }
}
