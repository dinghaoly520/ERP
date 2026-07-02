import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto } from './dto/contacts.dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContactDto) {
    return this.prisma.contact.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
      },
    });
  }

  async findMany() {
    return this.prisma.contact.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException(`联系人不存在`);
    }

    return contact;
  }

  async update(id: string, dto: UpdateContactDto) {
    await this.findOne(id);

    return this.prisma.contact.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    await this.findOne(id);

    await this.prisma.contact.delete({
      where: { id },
    });

    return { id };
  }

  async findByName(name: string) {
    return this.prisma.contact.findFirst({
      where: { name },
    });
  }
}
