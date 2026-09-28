import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VectorDbService } from './vector-db.service';

@Injectable()
export class VectorInitService implements OnModuleInit {
  private readonly logger = new Logger(VectorInitService.name);

  constructor(
    private vectorDb: VectorDbService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>('PGVECTOR_ENABLED') !== 'true') {
      this.logger.log('PGVector disabled, skipping vector extension init');
      return;
    }

    const pool = this.vectorDb.getPool();
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.logger.log(
        `pgvector extension ensured @ ${this.vectorDb.describeTarget()}`,
      );
    } catch (e) {
      this.logger.error(
        'Failed to create pgvector extension on vector DB. Check VECTOR_DATABASE_URL.',
        e,
      );
      return;
    }

    // sidecar 形态：目标库可能为空库（金仓主库无此表）——幂等建全套
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "DocumentChunk" (
          "id" TEXT NOT NULL,
          "collectionName" TEXT NOT NULL,
          "fileId" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "metadata" JSONB NOT NULL DEFAULT '{}',
          "embedding" vector(1024),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
      )`);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS "DocumentChunk_collectionName_idx" ON "DocumentChunk"("collectionName")`,
    );
    await pool.query(`
      CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_idx" ON "DocumentChunk"
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)`);

    this.logger.log(
      `HNSW embedding indexes ensured @ ${this.vectorDb.describeTarget()}`,
    );
  }
}
