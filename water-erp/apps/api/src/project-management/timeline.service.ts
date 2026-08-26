import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * B3 项目时间信息轴（CTS-EBS01 A-204：项目相关时间信息的建立和维护）。
 * 聚合 PMI / BidProject / Contract 三域六类时间节点：
 * 采购立项 · 采购文件获取 · 投标截止 · 开标 · 合同签订 · 归档。
 * 输出：有值节点按时间升序在前，缺值节点保持声明顺序垫底（前端灰显占位）。
 */

export interface TimelineNode {
  key: string;
  label: string;
  time: string | null; // ISO；null=尚未发生/未登记
  source: string; // 来源模块（展示用）
}

/** String 字段时间（bidOpeningTime/documentAcquireTime）规范化：可解析则转 ISO，否则 null。 */
function normalizeMaybeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getTimeline(pmiId: string): Promise<TimelineNode[]> {
    const item = await this.prisma.projectManagementItem.findUnique({
      where: { id: pmiId },
      select: { id: true, initiationDate: true, documentAcquireTime: true, bidOpeningTime: true, archivedAt: true },
    });
    if (!item) throw new NotFoundException('未找到对应项目');

    // BidProject 取最新轮次（多轮采购以末轮开标/截标为准）
    const bp = await this.prisma.bidProject.findFirst({
      where: { projectManagementItemId: pmiId },
      select: { deadline: true, openTime: true },
      orderBy: { round: 'desc' },
    });
    const contract = await this.prisma.contract.findFirst({
      where: { projectManagementItemId: pmiId },
      select: { signedAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const nodes: TimelineNode[] = [
      { key: 'initiation', label: '采购立项', time: item.initiationDate?.toISOString() ?? null, source: '项目管理' },
      { key: 'documentAcquire', label: '采购文件获取', time: normalizeMaybeDate(item.documentAcquireTime), source: '项目管理' },
      { key: 'bidDeadline', label: '投标截止', time: bp?.deadline?.toISOString() ?? null, source: '招标项目' },
      {
        key: 'bidOpening',
        label: '开标',
        time: bp?.openTime?.toISOString() ?? normalizeMaybeDate(item.bidOpeningTime),
        source: '招标项目',
      },
      { key: 'contractSign', label: '合同签订', time: contract?.signedAt?.toISOString() ?? null, source: '合同' },
      { key: 'archived', label: '归档', time: item.archivedAt?.toISOString() ?? null, source: '归档' },
    ];

    const withTime = nodes.filter(n => n.time).sort((a, b) => (a.time! < b.time! ? -1 : a.time! > b.time! ? 1 : 0));
    const without = nodes.filter(n => !n.time);
    return [...withTime, ...without];
  }
}
