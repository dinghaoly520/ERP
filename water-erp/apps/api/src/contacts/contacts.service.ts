import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto, UpdateContactDto } from './dto/contacts.dto';

/** AuthGuard 挂到 req.user 的 JWT 载荷（本服务只消费 sub） */
type RequestUser = { sub?: string } | undefined;

/**
 * 外部联系人（2026-10-09 起按公司隔离）：编写采购文件/公告的联系人选择只显示本公司
 * 维护的联系人，不再全平台共享一张表。口径与既有隔离表一致——
 * - 有归属公司的账号：只见/只动本公司联系人（companyId 过滤 + 写时快照落 companyName）
 * - 未归属公司的账号（admin 管理视角）：全量可见可管
 * 存量回填见迁移 20261009100000；seed 重建段兜底见 prisma/seed.ts「联系人归属重建」。
 */
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前用户公司（隔离依据）：User.company 快照优先，缺失回退 Company 主数据；未归属返回 null */
  private async resolveUserCompany(user: RequestUser) {
    if (!user?.sub) return null;
    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { companyId: true, company: true },
    });
    if (!u?.companyId) return null;
    if (u.company?.trim()) {
      return { companyId: u.companyId, companyName: u.company.trim() };
    }
    const company = await this.prisma.company.findUnique({
      where: { id: u.companyId },
      select: { name: true },
    });
    return company ? { companyId: u.companyId, companyName: company.name } : null;
  }

  /** 取联系人并校验归属：有归属公司的账号只能操作本公司联系人（未归属=管理视角不受限） */
  private async assertContactInCompany(id: string, user: RequestUser) {
    const [contact, company] = await Promise.all([
      this.prisma.contact.findUnique({ where: { id } }),
      this.resolveUserCompany(user),
    ]);
    if (!contact) {
      throw new NotFoundException('联系人不存在');
    }
    if (company && contact.companyId !== company.companyId) {
      throw new ForbiddenException({
        code: 'CONTACT_NOT_IN_COMPANY',
        error: '该联系人不属于当前账号所在公司',
      });
    }
    return { contact, company };
  }

  async create(dto: CreateContactDto, user: RequestUser) {
    const company = await this.resolveUserCompany(user);
    if (!company) {
      throw new BadRequestException({
        code: 'CONTACT_COMPANY_REQUIRED',
        error: '当前账号未归属公司，无法维护联系人（请先在账号管理中归属公司）',
      });
    }
    return this.prisma.contact.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        companyId: company.companyId,
        companyName: company.companyName,
      },
    });
  }

  async findMany(user: RequestUser) {
    const company = await this.resolveUserCompany(user);
    return this.prisma.contact.findMany({
      where: company ? { companyId: company.companyId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByName(name: string, user: RequestUser) {
    const company = await this.resolveUserCompany(user);
    return this.prisma.contact.findFirst({
      where: { name, ...(company ? { companyId: company.companyId } : {}) },
    });
  }

  async findOne(id: string, user: RequestUser) {
    const { contact } = await this.assertContactInCompany(id, user);
    return contact;
  }

  async update(id: string, dto: UpdateContactDto, user: RequestUser) {
    await this.assertContactInCompany(id, user);
    return this.prisma.contact.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string, user: RequestUser) {
    await this.assertContactInCompany(id, user);
    await this.prisma.contact.delete({
      where: { id },
    });
    return { id };
  }
}
