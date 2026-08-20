import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { INTERNAL_ROLES } from '../auth/auth-scope';

/** 公司主数据（admin 公司选择器 / 公司维度统计用） */
@ApiTags('公司')
@Controller('companies')
@Roles(...INTERNAL_ROLES)
export class CompanyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '公司列表（含用户数，管理端公司选择器用）' })
  async list() {
    return this.prisma.company.findMany({
      select: {
        id: true,
        name: true,
        shortName: true,
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
