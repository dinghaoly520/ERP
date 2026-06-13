import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { BudgetItemInput } from './dto';
import { Workbook } from 'exceljs';

@Injectable()
export class BudgetService {
  constructor(private prisma: PrismaService) {}

  /** 统一校验：不存在或无权访问都返回 404，避免泄露清单存在性。 */
  private ensureOwned(list: any, userId: string): void {
    if (!list || list.userId !== userId) {
      throw new NotFoundException({ error: '预算清单不存在', code: 'NOT_FOUND' });
    }
  }

  async listLists(userId: string) {
    const lists = await this.prisma.budgetList.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return lists.map(l => ({
      id: l.id,
      name: l.name,
      status: l.status,
      itemCount: l.itemCount,
      totalAmount: l.totalAmount ? Number(l.totalAmount) : null,
      procurementProjectId: l.procurementProjectId,
      remark: l.remark,
      updatedAt: l.updatedAt.toISOString(),
      createdAt: l.createdAt.toISOString(),
    }));
  }

  async createList(userId: string, name?: string) {
    const list = await this.prisma.budgetList.create({
      data: { name: (name || '我的预算清单').trim() || '我的预算清单', userId },
    });
    return this.getDetail(userId, list.id);
  }

  async getDetail(userId: string, id: string) {
    const list = await this.prisma.budgetList.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    this.ensureOwned(list, userId);
    return {
      id: list!.id,
      name: list!.name,
      status: list!.status,
      userId: list!.userId,
      remark: list!.remark,
      itemCount: list!.itemCount,
      totalAmount: list!.totalAmount ? Number(list!.totalAmount) : null,
      procurementProjectId: list!.procurementProjectId,
      updatedAt: list!.updatedAt.toISOString(),
      createdAt: list!.createdAt.toISOString(),
      items: list!.items.map(it => ({
        id: it.id,
        catalogItemId: it.catalogItemId,
        code: it.code,
        name: it.name,
        specification: it.specification,
        unit: it.unit,
        referencePrice: Number(it.referencePrice),
        qty: Number(it.qty),
        sortOrder: it.sortOrder,
      })),
    };
  }

  async updateList(userId: string, id: string, data: { name?: string; remark?: string; status?: string }) {
    const existing = await this.prisma.budgetList.findUnique({ where: { id } });
    this.ensureOwned(existing, userId);
    return this.prisma.budgetList.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() || existing!.name }),
        ...(data.remark !== undefined && { remark: data.remark }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });
  }

  async deleteList(userId: string, id: string) {
    const existing = await this.prisma.budgetList.findUnique({ where: { id } });
    this.ensureOwned(existing, userId);
    await this.prisma.budgetList.delete({ where: { id } });
    return { ok: true };
  }

  /** 全量替换条目（前端防抖自动保存）。 */
  async syncItems(userId: string, id: string, items: BudgetItemInput[]) {
    const existing = await this.prisma.budgetList.findUnique({ where: { id } });
    this.ensureOwned(existing, userId);
    if (existing!.status === 'CONVERTED') {
      throw new BadRequestException({ error: '已转换的清单不可编辑，请克隆后修改', code: 'CONVERTED' });
    }

    const totalAmount = items.reduce((sum, it) => sum + it.referencePrice * it.qty, 0);

    await this.prisma.$transaction(async tx => {
      await tx.budgetItem.deleteMany({ where: { budgetListId: id } });
      if (items.length) {
        await tx.budgetItem.createMany({
          data: items.map((it, idx) => ({
            budgetListId: id,
            catalogItemId: it.catalogItemId || null,
            code: it.code,
            name: it.name,
            specification: it.specification ?? null,
            unit: it.unit,
            referencePrice: it.referencePrice,
            qty: it.qty,
            sortOrder: idx,
          })),
        });
      }
      await tx.budgetList.update({
        where: { id },
        data: { itemCount: items.length, totalAmount },
      });
    });

    return { id, itemCount: items.length, totalAmount: Number(totalAmount.toFixed(2)) };
  }

  async cloneList(userId: string, id: string, name?: string) {
    const list = await this.prisma.budgetList.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    this.ensureOwned(list, userId);

    const created = await this.prisma.budgetList.create({
      data: {
        name: (name || `${list!.name} 副本`).trim(),
        userId,
        items: {
          create: list!.items.map(it => ({
            catalogItemId: it.catalogItemId,
            code: it.code,
            name: it.name,
            specification: it.specification,
            unit: it.unit,
            referencePrice: it.referencePrice,
            qty: it.qty,
            sortOrder: it.sortOrder,
          })),
        },
      },
      include: { items: true },
    });

    const totalAmount = created.items.reduce((s, it) => s + Number(it.referencePrice) * Number(it.qty), 0);
    await this.prisma.budgetList.update({
      where: { id: created.id },
      data: { itemCount: created.items.length, totalAmount },
    });

    return this.getDetail(userId, created.id);
  }

  /** 生成询价单：直接建立采购立项草稿（DRAFT）。ProcurementController.create 受角色限制，
   *  mall 用户无法调用，故由本服务直接经 Prisma 创建；后续在 web 门户继续审批与发起招标。 */
  async convert(userId: string, id: string) {
    const list = await this.prisma.budgetList.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    this.ensureOwned(list, userId);

    if (list!.status === 'CONVERTED') {
      throw new BadRequestException({ error: '该清单已转换为采购立项', code: 'CONVERTED' });
    }
    if (!list!.items.length) {
      throw new BadRequestException({ error: '预算清单为空，无法生成询价单', code: 'EMPTY' });
    }

    const total = list!.items.reduce((s, it) => s + Number(it.referencePrice) * Number(it.qty), 0);
    const description = list!.items
      .map((it, i) => {
        const subtotal = (Number(it.referencePrice) * Number(it.qty)).toFixed(2);
        return `${i + 1}. ${it.name}${it.specification ? `（${it.specification}）` : ''} — 数量 ${Number(it.qty)}${it.unit}，参考价 ¥${Number(it.referencePrice)}，小计 ¥${subtotal}`;
      })
      .join('\n');

    const project = await this.prisma.procurementProject.create({
      data: {
        title: list!.name,
        projectCode: `PROC-${Date.now()}`,
        procurementType: '货物',
        procurementMethod: '公开招标',
        budget: total,
        description: `由电子商城预算清单「${list!.name}」转换生成。\n\n${description}`,
        creatorId: userId,
      },
    });

    await this.prisma.budgetList.update({
      where: { id },
      data: { status: 'CONVERTED', procurementProjectId: project.id },
    });

    return { projectId: project.id, projectCode: project.projectCode, budgetAmount: Number(total.toFixed(2)) };
  }

  async exportList(userId: string, id: string): Promise<Buffer> {
    const list = await this.getDetail(userId, id);
    const wb = new Workbook();
    const ws = wb.addWorksheet((list.name || '预算清单').slice(0, 31));
    ws.columns = [
      { header: '序号', key: 'no', width: 6 },
      { header: '目录编码', key: 'code', width: 22 },
      { header: '物资名称', key: 'name', width: 26 },
      { header: '规格型号', key: 'specification', width: 30 },
      { header: '单位', key: 'unit', width: 8 },
      { header: '参考价', key: 'referencePrice', width: 12 },
      { header: '数量', key: 'qty', width: 8 },
      { header: '小计', key: 'subtotal', width: 14 },
    ];
    const rows = list.items.map((it, i) => ({
      no: i + 1, code: it.code, name: it.name, specification: it.specification ?? '',
      unit: it.unit, referencePrice: it.referencePrice, qty: it.qty,
      subtotal: Number((it.referencePrice * it.qty).toFixed(2)),
    }));
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEef3fb' } };
    const totalRow = rows.length + 2;
    ws.getCell(`G${totalRow}`).value = '预算参考合计';
    ws.getCell(`G${totalRow}`).font = { bold: true };
    ws.getCell(`H${totalRow}`).value = Number(rows.reduce((sum, r) => sum + r.subtotal, 0).toFixed(2));
    ws.getCell(`H${totalRow}`).font = { bold: true };
    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }
}
