import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AUTHENTICATED_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { UploadService } from './upload.service';

@ApiTags('文件上传')
@ApiCookieAuth('token')
@Controller('upload')
@Roles(...AUTHENTICATED_ROLES)
export class UploadController {
  constructor(private uploadService: UploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        category: { type: 'string', description: '文件分类: qualification|bid_document|announcement|profile|general' },
      },
    },
  })
  @ApiOperation({ summary: '上传文件' })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('category') category: string = 'general',
    @Query('clientEncrypted') clientEncrypted = 'false',
    @Query('plaintextSha256') plaintextSha256?: string,
    @Request() req?: any,
  ) {
    if (!file) {
      throw new BadRequestException({ error: '请选择文件', code: 'NO_FILE' });
    }
    return this.uploadService.upload(file, category, req.user?.sub, clientEncrypted === 'true', plaintextSha256);
  }

  @Get('files/:id')
  @ApiCookieAuth('token')
  @ApiOperation({ summary: '下载/预览文件（鉴权）' })
  async download(@Param('id') id: string, @Request() req: any, @Res() res: any) {
    return this.uploadService.streamFile(id, req.user, res);
  }

  @Delete(':key')
  @ApiOperation({ summary: '删除文件' })
  async delete(@Param('key') key: string, @Request() req: any) {
    return this.uploadService.delete(key, req.user);
  }
}
