import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from '../../local-ai/embedding.service';
import { createId } from '@paralleldrive/cuid2';

export interface ChunkSearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  fileId: string;
  score: number;
}

export interface InsertChunk {
  collectionName: string;
  fileId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class VectorSearchService {
  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
  ) {}

  private validateVector(vector: number[]): string {
    // Validate all values are finite numbers to prevent SQL injection
    for (const val of vector) {
      if (!Number.isFinite(val)) {
        throw new Error('Invalid embedding vector: contains non-finite values');
      }
    }
    return `[${vector.map((v) => v.toFixed(6)).join(',')}]`;
  }

  async search(
    query: string,
    collectionName: string,
    topK = 10,
  ): Promise<ChunkSearchResult[]> {
    const [queryVector] = await this.embedding.embed([query]);
    const vectorStr = this.validateVector(queryVector);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        content: string;
        metadata: Record<string, unknown>;
        file_id: string;
        score: number;
      }>
    >(
      `SELECT id, content, metadata, "fileId" AS file_id,
              1 - (embedding <=> '${vectorStr}'::vector) AS score
       FROM "DocumentChunk"
       WHERE "collectionName" = $1
       ORDER BY embedding <=> '${vectorStr}'::vector
       LIMIT $2`,
      collectionName,
      topK,
    );

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata,
      fileId: row.file_id,
      score: Number(row.score),
    }));
  }

  async insertChunks(chunks: InsertChunk[]): Promise<void> {
    for (const chunk of chunks) {
      const id = createId();
      const vectorStr = this.validateVector(chunk.embedding);
      const metadataJson = JSON.stringify(chunk.metadata ?? {});

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentChunk" (id, "collectionName", "fileId", content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5::jsonb, '${vectorStr}'::vector)`,
        id,
        chunk.collectionName,
        chunk.fileId,
        chunk.content,
        metadataJson,
      );
    }
  }

  async deleteByFileId(fileId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "DocumentChunk" WHERE "fileId" = $1`,
      fileId,
    );
  }

  async deleteByCollection(collectionName: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM "DocumentChunk" WHERE "collectionName" = $1`,
      collectionName,
    );
  }

  async getChunkCountByFileId(fileId: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::int AS count FROM "DocumentChunk" WHERE "fileId" = $1`,
      fileId,
    );
    return Number(rows[0]?.count ?? 0);
  }
}
