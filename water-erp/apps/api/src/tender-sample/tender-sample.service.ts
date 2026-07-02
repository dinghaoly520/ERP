import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTenderFieldSampleDto,
  UpdateTenderFieldSampleDto,
  QueryTenderFieldSampleDto,
} from './dto/tender-field-sample.dto';

@Injectable()
export class TenderSampleService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTenderFieldSampleDto) {
    return this.prisma.tenderFieldSample.create({
      data: {
        fieldKey: dto.fieldKey,
        content: dto.content,
        isFavorite: dto.isFavorite ?? false,
        sourceType: dto.sourceType ?? 'manual',
        context: dto.context
          ? JSON.parse(JSON.stringify(dto.context))
          : undefined,
      },
    });
  }

  async findByFieldKey(dto: QueryTenderFieldSampleDto) {
    const where: Record<string, unknown> = { fieldKey: dto.fieldKey };
    if (dto.isFavorite !== undefined) {
      where.isFavorite = dto.isFavorite;
    }

    return this.prisma.tenderFieldSample.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, dto: UpdateTenderFieldSampleDto) {
    const existing = await this.prisma.tenderFieldSample.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`TenderFieldSample with id ${id} not found`);
    }

    return this.prisma.tenderFieldSample.update({
      where: { id },
      data: {
        content: dto.content,
        isFavorite: dto.isFavorite,
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.tenderFieldSample.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`TenderFieldSample with id ${id} not found`);
    }

    await this.prisma.tenderFieldSample.delete({ where: { id } });
    return { success: true };
  }

  async toggleFavorite(id: string) {
    const existing = await this.prisma.tenderFieldSample.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`TenderFieldSample with id ${id} not found`);
    }

    return this.prisma.tenderFieldSample.update({
      where: { id },
      data: { isFavorite: !existing.isFavorite },
    });
  }
}
