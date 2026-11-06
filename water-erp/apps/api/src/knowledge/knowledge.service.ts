import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentParserService } from './services/document-parser.service';
import { TextSplitterService } from './services/text-splitter.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { VectorSearchService } from './services/vector-search.service';
import { CreateKnowledgeBaseDto, UpdateKnowledgeBaseDto } from './dto/knowledge.dto';
import { KNOWLEDGE_PARSE_QUEUE, parseJobOptions } from './queues/knowledge-queue.module';
import type { AuthenticatedUser } from '../auth/auth.types';

type User = AuthenticatedUser | undefined;

@Injectable()
export class KnowledgeService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private parser: DocumentParserService,
    private splitter: TextSplitterService,
    private embedding: EmbeddingService,
    private vectorSearch: VectorSearchService,
    @InjectQueue(KNOWLEDGE_PARSE_QUEUE) private parseQueue: Queue,
  ) {}

  // ── 权限：可见 = 创建者 或 共享 或 admin；可维护 = 创建者 或 admin ──
  private canUse(kb: { ownerId: string; isShared: boolean }, user: User): boolean {
    return !!user && (kb.ownerId === user.sub || kb.isShared || user.role === 'admin');
  }
  private canEdit(kb: { ownerId: string }, user: User): boolean {
    return !!user && (kb.ownerId === user.sub || user.role === 'admin');
  }

  async assertEditable(kbId: string, user: User) {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb) throw new NotFoundException(`知识库不存在或已被删除（id：${kbId}）`);
    if (!this.canEdit(kb, user)) throw new ForbiddenException('无权维护该知识库（仅创建者或管理员）');
    return kb;
  }

  async create(dto: CreateKnowledgeBaseDto, user: User) {
    if (!user) throw new ForbiddenException('未登录');
    return this.prisma.knowledgeBase.create({
      data: {
        name: dto.name,
        description: dto.description,
        ownerId: user.sub,
        isShared: dto.isShared ?? false,
        // 域隔离（2026-11-03 用户裁定）：审查端建库不带 domain（默认审查域）；
        // 水叮当面板建库显式传 assistant
        domain: dto.domain ?? 'tender_review',
      },
    });
  }

  async findAll(user: User) {
    // 审查域列表（2026-11-03 域隔离）：恒 domain=tender_review——水叮当知识库不在审查页出现
    const where =
      user?.role === 'admin'
        ? { isActive: true, domain: 'tender_review' as const }
        : { isActive: true, domain: 'tender_review' as const, OR: [{ ownerId: user?.sub }, { isShared: true }] };
    return this.prisma.knowledgeBase.findMany({
      where,
      include: {
        _count: { select: { files: true, rules: true } },
        files: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, user: User) {
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id },
      include: { files: { orderBy: { createdAt: 'desc' } } },
    });
    if (!kb) throw new NotFoundException(`知识库不存在或已被删除（id：${id}）`);
    if (!this.canUse(kb, user)) throw new ForbiddenException('无权访问该知识库');
    return kb;
  }

  async update(id: string, dto: UpdateKnowledgeBaseDto, user: User) {
    await this.assertEditable(id, user);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isShared !== undefined) data.isShared = dto.isShared;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.knowledgeBase.update({ where: { id }, data });
  }

  async remove(id: string, user: User) {
    await this.assertEditable(id, user);
    try {
      await this.vectorSearch.deleteByCollection(id);
    } catch (err) {
      console.error('Failed to delete vector chunks:', err);
      // Continue with deletion even if vector cleanup fails
    }
    return this.prisma.knowledgeBase.delete({ where: { id } });
  }

  /** 上传收件即返回（2026-11-06 异步化）：MinIO 落盘 + 建 PARSING 行 + 入队——
   *  响应时间与文件大小/页数/OCR 时长完全解耦（118MB 扫描件 <5s 返回 202）。
   *  同库 sha256 去重：PARSING/READY → 直接返回既有行（deduplicated:true）；
   *  FAILED → 复用该行重置重入队。跨库重复靠 OCR 内容哈希缓存兜底（第二库秒级）。
   *  解析/分块/嵌入/向量入库全部在 KnowledgeParseProcessor（ai-bid worker 进程）。 */
  async uploadFile(kbId: string, file: Express.Multer.File, user: User) {
    await this.assertEditable(kbId, user);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    // 去重第一步：活动行（PARSING/READY）直接复用（M-4 拆分查询——原「三态并查」等价全集、语义噪音）
    const active = await this.prisma.knowledgeFile.findFirst({
      where: { knowledgeBaseId: kbId, sha256, status: { in: ['PARSING', 'READY'] } },
    });
    if (active) return { ...active, deduplicated: true };

    const objectKey = `knowledge/${kbId}/${Date.now()}_${file.originalname}`;
    try {
      await this.storage.upload(objectKey, file.buffer, file.mimetype);
    } catch (err) {
      console.error('Storage upload error:', err);
      throw new Error('文件存储失败');
    }

    // 去重第二步：FAILED 同 sha 行复用（重置字段+换新对象），否则新建
    const failed = await this.prisma.knowledgeFile.findFirst({
      where: { knowledgeBaseId: kbId, sha256, status: 'FAILED' },
    });
    const data = {
      fileName: file.originalname,
      objectKey,
      mimeType: file.mimetype,
      fileSize: file.size,
      sha256,
      status: 'PARSING',
      error: null,
      processedPages: 0,
      totalPages: null,
      chunkCount: 0,
      indexed: true,
    };
    let kbFile;
    try {
      kbFile = failed
        ? await this.prisma.knowledgeFile.update({ where: { id: failed.id }, data })
        : await this.prisma.knowledgeFile.create({ data: { knowledgeBaseId: kbId, ...data } });
    } catch (err) {
      // 并发竞争输家（评审 I-1）：partial unique index (kbId,sha256 WHERE PARSING/READY) 撞唯一——
      // 重查赢家行返回 deduplicated，清自己刚传的孤儿对象（输家行未建成，无 job）
      if ((err as { code?: string })?.code === 'P2002') {
        const winner = await this.prisma.knowledgeFile.findFirst({
          where: { knowledgeBaseId: kbId, sha256, status: { in: ['PARSING', 'READY'] } },
        });
        if (winner) {
          void this.storage.delete(objectKey).catch(() => undefined);
          return { ...winner, deduplicated: true };
        }
      }
      // M-5：建行失败（非并发竞争）不留孤儿对象——best-effort 清刚传的 MinIO 件后原样抛出
      void this.storage.delete(objectKey).catch(() => undefined);
      throw err;
    }
    if (failed) {
      void this.storage.delete(failed.objectKey).catch(() => undefined); // best-effort 清旧对象
    }

    // jobId=fileId：并发重复上传的 BullMQ 层双保险（同 id 在队/运行中 add 被忽略）
    await this.parseQueue.add('parse', { fileId: kbFile.id }, parseJobOptions(kbFile.id));
    return kbFile;
  }

  /** FAILED 行重试（前端一键）：重置状态重新入队——OCR 批次缓存命中时秒级完成。
   *  PARSING 幂等返回当前行（M-3：retry 双击不 400、不重复入队——job 已在跑；
   *  死态 PARSING 由 worker 启动清扫器自愈）。READY 不受理。 */
  async retryFile(kbId: string, fileId: string, user: User) {
    await this.assertEditable(kbId, user);
    const file = await this.prisma.knowledgeFile.findFirst({
      where: { id: fileId, knowledgeBaseId: kbId },
    });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.status === 'PARSING') return file;
    if (file.status !== 'FAILED') throw new BadRequestException('仅解析失败的文件可重试');

    const row = await this.prisma.knowledgeFile.update({
      where: { id: fileId },
      data: { status: 'PARSING', error: null, processedPages: 0, totalPages: null },
    });
    await this.parseQueue.add('parse', { fileId }, parseJobOptions(fileId));
    return row;
  }

  async deleteFile(kbId: string, fileId: string, user: User) {
    await this.assertEditable(kbId, user);
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

  /** 重建索引：indexed=false 徽章（嵌入降级）指引的补救动作——成功后复位 indexed:true
   *  （评审 I-3）；嵌入/向量失败按文件降级（indexed:false 继续），不得中途 500
   *  （旧行为：全库向量已清而循环中断，徽章与实际脱节）。 */
  async reindex(kbId: string, user: User) {
    await this.assertEditable(kbId, user);
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      include: { files: { orderBy: { createdAt: 'desc' } } },
    });
    if (!kb) throw new NotFoundException(`知识库不存在或已被删除（id：${kbId}）`);

    await this.vectorSearch.deleteByCollection(kbId);

    let degradedCount = 0;
    for (const file of kb.files) {
      if (!file.content) continue;

      const textChunks = this.splitter.split(file.content);
      let embeddings: number[][] = [];
      let indexed = true;
      if (textChunks.length > 0) {
        try {
          embeddings = await this.embedding.embed(textChunks.map((c) => c.content));
        } catch (err) {
          console.error(`Embedding error (degraded) for ${file.fileName}:`, err);
          embeddings = [];
          indexed = false;
        }
      }

      if (textChunks.length > 0 && embeddings.length === textChunks.length) {
        try {
          await this.vectorSearch.insertChunks(
            textChunks.map((chunk, i) => ({
              collectionName: kbId,
              fileId: file.id,
              content: chunk.content,
              embedding: embeddings[i],
              metadata: { fileName: file.fileName, startOffset: chunk.startOffset },
            })),
          );
        } catch (err) {
          // 向量写入失败 = 无向量可检索 → 与嵌入降级同语义（indexed:false）
          console.error(`Vector insert error for ${file.fileName}:`, err);
          indexed = false;
        }
      } else if (textChunks.length > 0) {
        indexed = false;
      }
      if (!indexed) degradedCount++;

      await this.prisma.knowledgeFile.update({
        where: { id: file.id },
        data: { chunkCount: textChunks.length, indexed },
      });
    }

    return { reindexed: true, fileCount: kb.files.length, degradedCount };
  }

  /** 水叮当知识库面板取数（2026-11-03 设计 §4.3）：mine=本人库，shared=他人共享库
   *  （他人私有库与停用库不入——where 即检索集口径）。写操作仍走既有端点与
   *  assertEditable 闸。ownerName 经 User.displayName 批量解析（模型无 owner 关系）。 */
  async assistantOverview(user: User) {
    if (!user?.sub) throw new ForbiddenException('请登录后使用知识库');
    const rows = await this.prisma.knowledgeBase.findMany({
      // 域隔离（2026-11-03）：水叮当面只取 assistant 域——审查知识库不互通
      where: { isActive: true, domain: 'assistant', OR: [{ ownerId: user.sub }, { isShared: true }] },
      select: {
        id: true, name: true, isShared: true, ownerId: true,
        files: {
          orderBy: { createdAt: 'desc' },
          // 解析状态字段随行透出（2026-11-06 异步化）：前端徽章「解析中(x/y页)/失败可重试/已入库」轮询消费
          select: { id: true, fileName: true, fileSize: true, chunkCount: true, createdAt: true,
            status: true, processedPages: true, totalPages: true, error: true, indexed: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
    const owners = ownerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, displayName: true, username: true },
        })
      : [];
    const nameOf = new Map(owners.map((o) => [o.id, o.displayName || o.username]));
    const named = rows.map((r) => ({
      ...r,
      ownerName: r.ownerId === user.sub ? '我' : (nameOf.get(r.ownerId) ?? '其他成员'),
    }));
    return {
      mine: named.filter((r) => r.ownerId === user.sub),
      shared: named.filter((r) => r.ownerId !== user.sub),
    };
  }
}
