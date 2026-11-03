import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../../local-ai/embedding.service';
import { VectorSearchService } from '../../knowledge/services/vector-search.service';

const TOP_K = 5;

/** 水叮当对话 RAG 检索（2026-11-03 设计 §4.1）：检索集=自己的∪共享（isActive）库，
 *  跨库合并按相似度取 top5 片段。降级铁律：无库/无命中/嵌入或检索任何异常 → null
 *  （调用方静默走普通流程，对话永不因 RAG 失败而报错）。 */
@Injectable()
export class AssistantRagService {
  private readonly logger = new Logger(AssistantRagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly vectorSearch: VectorSearchService,
  ) {}

  async buildContext(
    question: string,
    user: { sub: string; role: string },
  ): Promise<{ block: string; fileNames: string[] } | null> {
    try {
      const bases = await this.prisma.knowledgeBase.findMany({
        // 域隔离（2026-11-03 用户裁定）：水叮当只检索 assistant 域——与采购文件审查知识库互不互通
        where: { isActive: true, domain: 'assistant', OR: [{ ownerId: user.sub }, { isShared: true }] },
        select: { id: true, name: true },
      });
      if (bases.length === 0) return null;

      await this.embedding.embed([question]); // 探活+预热（search 内部会再嵌入查询词）
      const perBase = await Promise.all(
        bases.map((b) => this.vectorSearch.search(question, b.id, TOP_K).catch(() => [])),
      );
      const hits = perBase
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K);
      if (hits.length === 0) return null;

      const fileNames = [...new Set(hits.map((h) => String(h.metadata?.fileName ?? '未命名文件')))];
      const lines = hits.map(
        (h) => `【${String(h.metadata?.fileName ?? '未命名文件')}】${h.content}`,
      );
      const block =
        `【用户知识库资料——回答时优先参考以下片段，引用时注明来源文件】\n` +
        lines.join('\n');
      return { block, fileNames };
    } catch (e) {
      this.logger.warn(`RAG 检索降级（按普通流程回答）: ${(e as Error).message}`);
      return null;
    }
  }
}
