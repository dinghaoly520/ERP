import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';
import {
  CreateKnowledgeBaseDto,
  UpdateKnowledgeBaseDto,
} from './dto/knowledge.dto';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@ApiTags('Knowledge')
@Controller('knowledge')
@UseGuards(AuthGuard)
@Roles('leader', 'admin', 'staff')
export class KnowledgeController {
  constructor(private knowledge: KnowledgeService) {}

  @Post()
  @ApiOperation({ summary: 'Create knowledge base (ownerId = current user)' })
  create(
    @Body() dto: CreateKnowledgeBaseDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.knowledge.create(dto, user);
  }

  @Get()
  @ApiOperation({
    summary: 'List knowledge bases (自己创建的 + 别人共享的；admin 全部)',
  })
  findAll(@CurrentUser() user: AuthenticatedUser | undefined) {
    return this.knowledge.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get knowledge base detail (创建者/共享/admin 可见)' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.knowledge.findOne(id, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update knowledge base (name/description/isShared/isActive；创建者/admin)',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.knowledge.update(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete knowledge base (创建者/admin)' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.knowledge.remove(id, user);
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload file to knowledge base (创建者/admin)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  uploadFile(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException(
        '未找到上传文件，请确保使用 multipart/form-data 格式且文件字段名为 file',
      );
    }
    // Fix multer Latin-1 encoding for Chinese filenames
    if (file.originalname) {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString(
        'utf-8',
      );
    }
    return this.knowledge.uploadFile(id, file, user);
  }

  @Delete(':id/files/:fileId')
  @ApiOperation({ summary: 'Delete file from knowledge base (创建者/admin)' })
  deleteFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.knowledge.deleteFile(id, fileId, user);
  }

  @Post(':id/reindex')
  @ApiOperation({ summary: 'Reindex knowledge base (创建者/admin)' })
  reindex(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.knowledge.reindex(id, user);
  }
}
