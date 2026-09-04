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
  ForbiddenException,
  Body,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiCookieAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AUTHENTICATED_ROLES } from '../auth/auth-scope';
import { Roles } from '../common/decorators/roles.decorator';
import { UploadService } from './upload.service';
import { UPLOAD_CATEGORIES, isUploadCategoryAllowedForRole } from './upload-categories';
import { Public } from '../common/decorators/public.decorator';
import { VerificationService } from '../verification/verification.service';
import { isValidRegistrationUploadFile, registrationUploadNamespace } from './registration-upload';

@ApiTags('文件上传')
@ApiCookieAuth('token')
@Controller('upload')
@Roles(...AUTHENTICATED_ROLES)
export class UploadController {
  constructor(
    private uploadService: UploadService,
    private verificationService: VerificationService,
  ) {}

  /** 注册页专用上传：短信码校验 + 手机哈希命名空间；验证码在最终注册时才消费。 */
  @Post('registration')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '注册附件上传（需有效短信验证码，10MB）' })
  async uploadRegistration(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { phone?: string; code?: string; category?: string },
  ) {
    const phone = body.phone?.trim() ?? '';
    const code = body.code?.trim() ?? '';
    const category = body.category?.trim() ?? '';
    if (!['qualification', 'general'].includes(category)) {
      throw new BadRequestException({ error: '注册附件分类不正确', code: 'REGISTRATION_UPLOAD_CATEGORY_INVALID' });
    }
    if (!file) throw new BadRequestException({ error: '请选择文件', code: 'NO_FILE' });
    if (!isValidRegistrationUploadFile(file, category)) {
      throw new BadRequestException({
        error: category === 'general'
          ? '公司 logo 仅支持 5MB 内的 JPG 或 PNG 图片'
          : '注册证明仅支持 10MB 内的 PDF、JPG 或 PNG 文件',
        code: 'REGISTRATION_UPLOAD_FILE_INVALID',
      });
    }
    if (!/^1[3-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) {
      throw new BadRequestException({ error: '请先完成手机号验证码填写', code: 'REGISTRATION_CODE_REQUIRED' });
    }
    await this.verificationService.assertRegistrationCodeForUpload(phone, code);
    return this.uploadService.upload(
      file, category, undefined, false, undefined, registrationUploadNamespace(phone),
    );
  }

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
        category: { type: 'string', description: '文件分类（白名单，完整清单见 upload-categories.ts）: general|qualification|bid_document|announcement|profile|commercial|technical|procurement_document|bid_opening_handover|bid_evaluation_handover|bid_evaluation_sign_handover|bid_sign_packet|sign_packet_signature_page|expert_memo_ink|expert_sign_scan' },
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
    // 白名单校验（2026-08 审计）：category 曾为自由字符串，文档与实现漂移。
    // 新增分类请同步 upload-categories.ts 的 UPLOAD_CATEGORIES。
    if (!UPLOAD_CATEGORIES.has(category)) {
      throw new BadRequestException({
        error: `未知的文件分类: ${category}（允许值见 upload-categories.ts 的 UPLOAD_CATEGORIES）`,
        code: 'INVALID_CATEGORY',
      });
    }
    if (!isUploadCategoryAllowedForRole(category, req.user?.role)) {
      throw new ForbiddenException({
        error: '当前账号无权上传该业务分类的文件',
        code: 'UPLOAD_CATEGORY_FORBIDDEN',
      });
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
