import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentParserService } from './services/document-parser.service';
import { TextSplitterService, type TextChunk } from './services/text-splitter.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { VectorSearchService } from './services/vector-search.service';
import { CreateKnowledgeBaseDto } from './dto/knowledge.dto';

@Injectable()
export class KnowledgeService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private parser: DocumentParserService,
    private splitter: TextSplitterService,
    private embedding: EmbeddingService,
    private vectorSearch: VectorSearchService,
  ) {}

  async create(dto: CreateKnowledgeBaseDto) {
    return this.prisma.knowledgeBase.create({
      data: { name: dto.name, description: dto.description },
    });
  }

  async findAll() {
    return this.prisma.knowledgeBase.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { files: true, rules: true } },
        files: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: { files: { orderBy: { createdAt: 'desc' } } },
    });
    if (!kb) throw new NotFoundException(`Knowledge base ${id} not found`);
    return kb;
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.vectorSearch.deleteByCollection(id);
    } catch (err) {
      console.error('Failed to delete vector chunks:', err);
      // Continue with deletion even if vector cleanup fails
    }
    return this.prisma.knowledgeBase.delete({ where: { id } });
  }

  async uploadFile(kbId: string, file: Express.Multer.File) {
    await this.findOne(kbId);

    const objectKey = `knowledge/${kbId}/${Date.now()}_${file.originalname}`;
    try {
      await this.storage.upload(objectKey, file.buffer, file.mimetype);
    } catch (err) {
      console.error('Storage upload error:', err);
      throw new Error('文件存储失败');
    }

    let content: string;
    try {
      content = await this.parser.parse(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
    } catch (err) {
      console.error('Document parse error:', err);
      throw new Error('文档解析失败');
    }

    let textChunks: TextChunk[];
    try {
      textChunks = this.splitter.split(content);
    } catch (err) {
      console.error('Text split error:', err);
      throw new Error('文本分割失败');
    }

    let embeddings: number[][] = [];
    if (textChunks.length > 0) {
      try {
        embeddings = await this.embedding.embed(
          textChunks.map((c) => c.content),
        );
      } catch (err) {
        console.error('Embedding error:', err);
        throw new Error('文本嵌入失败，请检查嵌入服务是否正常运行');
      }
    }

    let kbFile;
    try {
      kbFile = await this.prisma.knowledgeFile.create({
        data: {
          knowledgeBaseId: kbId,
          fileName: file.originalname,
          objectKey,
          mimeType: file.mimetype,
          fileSize: file.size,
          content,
          chunkCount: textChunks.length,
        },
      });
    } catch (err) {
      console.error('KnowledgeFile create error:', err);
      throw new Error('文件记录保存失败');
    }

    if (textChunks.length > 0) {
      try {
        const chunks = textChunks.map((chunk, i) => ({
          collectionName: kbId,
          fileId: kbFile.id,
          content: chunk.content,
          embedding: embeddings[i],
          metadata: {
            fileName: file.originalname,
            startOffset: chunk.startOffset,
          },
        }));
        await this.vectorSearch.insertChunks(chunks);
      } catch (err) {
        console.error('Vector insert error:', err);
        // Continue even if vector insert fails - file is already saved
      }
    }

    return kbFile;
  }

  async deleteFile(kbId: string, fileId: string) {
    const file = await this.prisma.knowledgeFile.findFirst({
      where: { id: fileId, knowledgeBaseId: kbId },
    });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);

    try {
      await this.vectorSearch.deleteByFileId(fileId);
    } catch (err) {
      console.error('Vector delete error:', err);
      // Continue even if vector delete fails
    }

    try {
      await this.storage.delete(file.objectKey);
    } catch (err) {
      console.error('Storage delete error:', err);
      // Continue even if storage delete fails
    }

    await this.prisma.knowledgeFile.delete({ where: { id: fileId } });

    return { deleted: true };
  }

  async reindex(kbId: string) {
    const kb = await this.findOne(kbId);

    await this.vectorSearch.deleteByCollection(kbId);

    for (const file of kb.files) {
      if (!file.content) continue;

      const textChunks = this.splitter.split(file.content);
      let embeddings: number[][] = [];
      if (textChunks.length > 0) {
        embeddings = await this.embedding.embed(
          textChunks.map((c) => c.content),
        );
      }

      if (textChunks.length > 0) {
        const chunks = textChunks.map((chunk, i) => ({
          collectionName: kbId,
          fileId: file.id,
          content: chunk.content,
          embedding: embeddings[i],
          metadata: {
            fileName: file.fileName,
            startOffset: chunk.startOffset,
          },
        }));
        await this.vectorSearch.insertChunks(chunks);
      }

      await this.prisma.knowledgeFile.update({
        where: { id: file.id },
        data: { chunkCount: textChunks.length },
      });
    }

    return { reindexed: true, fileCount: kb.files.length };
  }
}
