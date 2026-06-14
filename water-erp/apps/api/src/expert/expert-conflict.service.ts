import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SUFFIXES = ['有限责任公司', '有限公司', '股份有限公司', '股份公司', '集团', '公司', '院', '中心'];

export function normalizeName(s: string): string {
  let n = (s || '').trim().toLowerCase();
  for (const suf of SUFFIXES) {
    if (n.endsWith(suf.toLowerCase())) {
      n = n.slice(0, -suf.length);
      break;
    }
  }
  return n;
}

export interface ConflictResult {
  supplierId?: string;
  supplierName: string;
  reason: string;
}

export function detectConflicts(
  expertEmployer: string | null | undefined,
  suppliers: Array<{ id?: string; supplierName: string; legalPerson?: string | null }>,
): ConflictResult[] {
  if (!expertEmployer) return [];
  const empNorm = normalizeName(expertEmployer);
  const out: ConflictResult[] = [];
  for (const s of suppliers) {
    const nameNorm = normalizeName(s.supplierName);
    if (empNorm && nameNorm && (empNorm.includes(nameNorm) || nameNorm.includes(empNorm))) {
      out.push({
        supplierId: s.id,
        supplierName: s.supplierName,
        reason: `工作单位 "${expertEmployer}" 与投标供应商 "${s.supplierName}" 存在关联`,
      });
    }
  }
  return out;
}

@Injectable()
export class ExpertConflictService {
  constructor(private prisma: PrismaService) {}

  async detectForProject(projectId: string, expertUserId: string): Promise<ConflictResult[]> {
    const [expert, suppliers] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: expertUserId }, include: { expertProfile: true } }),
      this.prisma.bidSupplier.findMany({ where: { projectId }, select: { id: true, supplierName: true } }),
    ]);
    return detectConflicts(expert?.expertProfile?.employer, suppliers);
  }
}
