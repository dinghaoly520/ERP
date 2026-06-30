import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VectorInitService implements OnModuleInit {
  private readonly logger = new Logger(VectorInitService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>('PGVECTOR_ENABLED') !== 'true') {
      this.logger.log('PGVector disabled, skipping vector extension init');
      return;
    }

    try {
      await this.prisma.$executeRawUnsafe(
        'CREATE EXTENSION IF NOT EXISTS vector',
      );
      this.logger.log('pgvector extension ensured');
    } catch (e) {
      this.logger.error(
        'Failed to create pgvector extension. Is pgvector installed?',
        e,
      );
      return;
    }

    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_idx" ON "DocumentChunk"
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);

    this.logger.log('HNSW embedding indexes ensured');
  }
}
