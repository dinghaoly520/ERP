import { Module } from '@nestjs/common';
import { PrequalController } from './prequal.controller';
import { PrequalService } from './prequal.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [PrequalController],
  providers: [PrequalService],
  exports: [PrequalService],
})
export class PrequalModule {}
