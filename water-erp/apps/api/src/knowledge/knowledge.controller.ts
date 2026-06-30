import {
  Controller,
  Get,
  Post,
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
import { CreateKnowledgeBaseDto } from './dto/knowledge.dto';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Knowledge')
@Controller('knowledge')
@UseGuards(AuthGuard)
export class KnowledgeController {
  constructor(private knowledge: KnowledgeService) {}

  @Post()
  @ApiOperation({ summary: 'Create knowledge base' })
  create(@Body() dto: CreateKnowledgeBaseDto) {
    return this.knowledge.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List knowledge bases' })
  findAll() {
    return this.knowledge.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get knowledge base detail' })
  findOne(@Param('id') id: string) {
    return this.knowledge.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete knowledge base' })
  remove(@Param('id') id: string) {
    return this.knowledge.remove(id);
  }

  @Post(':id/files')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload file to knowledge base' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 500 * 1024 * 1024 },
    }),
  )
  uploadFile(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
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
    return this.knowledge.uploadFile(id, file);
  }

  @Delete(':id/files/:fileId')
  @ApiOperation({ summary: 'Delete file from knowledge base' })
  deleteFile(@Param('id') id: string, @Param('fileId') fileId: string) {
    return this.knowledge.deleteFile(id, fileId);
  }

  @Post(':id/reindex')
  @ApiOperation({ summary: 'Reindex knowledge base' })
  reindex(@Param('id') id: string) {
    return this.knowledge.reindex(id);
  }
}
