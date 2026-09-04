import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Document, Packer } from 'docx';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { htmlToDocxChildren } from '../project-management/docx/html-to-docx.converter';
import { buildStandardFileName } from '@water-erp/shared';

/**
 * B3（GB/T 43711 7.2.3）：资格预审——登记制。
 * 评审线下完成、结果登记入系统：预审发起（可同步发 PREQUAL_NOTICE 公告）→ 供应商线上提交申请
 * → 采购人线下评审 → decide 登记结果（合格发通知书 DOCX、未通过同步告知，7.2.3.4）。
 * 集中资格预审按品类：同品类有效期内已合格的供应商再次申请自动通过（免重复审查，7.2.3.2）。
 */
@Injectable()
export class PrequalService {
  private readonly logger = new Logger(PrequalService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  list(params: { status?: string; q?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.q) where.title = { contains: params.q, mode: 'insensitive' };
    return this.prisma.prequalification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { applications: { orderBy: { createdAt: 'desc' } } },
      take: 100,
    });
  }

  async get(id: string) {
    const prequal = await this.prisma.prequalification.findUnique({
      where: { id },
      include: { applications: { orderBy: { createdAt: 'desc' } } },
    });
    if (!prequal) throw new NotFoundException({ error: '资格预审不存在', code: 'NOT_FOUND' });
    return prequal;
  }

  /** 发起资格预审（可选同步发布 PREQUAL_NOTICE 公告） */
  async create(dto: {
    title: string; mode?: string; method?: string; limitedCount?: number;
    catalogCategoryId?: number; validUntil?: string; projectId?: string;
    content?: string; publishAnnouncement?: boolean;
  }, stamp: { companyId?: string; companyName?: string }) {
    if (!dto.title?.trim()) throw new BadRequestException({ error: '请填写预审名称', code: 'BAD_PARAMS' });
    if (dto.mode && !['centralized', 'single'].includes(dto.mode)) {
      throw new BadRequestException({ error: 'mode ∈ centralized|single', code: 'BAD_MODE' });
    }
    if (dto.method && !['qualified', 'limited'].includes(dto.method)) {
      throw new BadRequestException({ error: 'method ∈ qualified|limited', code: 'BAD_METHOD' });
    }
    if (dto.method === 'limited' && !dto.limitedCount) {
      throw new BadRequestException({ error: '有限数量制必须填写入围数量', code: 'LIMIT_REQUIRED' });
    }

    let announcementId: string | null = null;
    if (dto.publishAnnouncement !== false) {
      const ann = await this.prisma.announcement.create({
        data: {
          title: `资格预审公告：${dto.title.trim()}`,
          content: dto.content?.trim() || `现对「${dto.title.trim()}」组织资格预审（GB/T 43711 7.2.3）。符合条件的供应商请在有效期内通过供应商门户提交资格预审申请。`,
          type: 'PREQUAL_NOTICE',
          status: 'PUBLISHED',
          publishDate: new Date(),
          companyId: stamp.companyId ?? null,
          companyName: stamp.companyName ?? null,
        },
      });
      announcementId = ann.id;
    }

    return this.prisma.prequalification.create({
      data: {
        title: dto.title.trim(),
        announcementId,
        projectId: dto.projectId ?? null,
        catalogCategoryId: dto.catalogCategoryId ?? null,
        mode: dto.mode ?? 'single',
        method: dto.method ?? 'qualified',
        limitedCount: dto.limitedCount ?? null,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        companyId: stamp.companyId ?? null,
        companyName: stamp.companyName ?? null,
      },
    });
  }

  /** 供应商提交申请（集中预审品类内已合格且在有效期 → 自动通过免重复审查） */
  async apply(prequalId: string, supplier: { id: string; name: string; userId: string }, note?: string) {
    const prequal = await this.prisma.prequalification.findUnique({ where: { id: prequalId } });
    if (!prequal) throw new NotFoundException({ error: '资格预审不存在', code: 'NOT_FOUND' });
    if (prequal.status !== 'open') throw new BadRequestException({ error: '该预审已停止接受申请', code: 'NOT_OPEN' });

    // 7.2.3.2：集中资格预审——同品类有效期内已合格 → 免重复审查自动通过
    if (prequal.mode === 'centralized' && prequal.catalogCategoryId) {
      const existingPass = await this.prisma.prequalApplication.findFirst({
        where: {
          supplierId: supplier.id,
          status: 'passed',
          prequal: {
            catalogCategoryId: prequal.catalogCategoryId,
            validUntil: { gt: new Date() },
          },
        },
        select: { id: true },
      });
      if (existingPass) {
        return this.prisma.prequalApplication.upsert({
          where: { prequalId_supplierId: { prequalId, supplierId: supplier.id } },
          update: { status: 'passed', note: note?.trim() || null, notifiedAt: new Date() },
          create: {
            prequalId, supplierId: supplier.id, supplierName: supplier.name, userId: supplier.userId,
            note: note?.trim() || null, status: 'passed', notifiedAt: new Date(),
          },
        });
      }
    }

    return this.prisma.prequalApplication.upsert({
      where: { prequalId_supplierId: { prequalId, supplierId: supplier.id } },
      update: { note: note?.trim() || null },
      create: {
        prequalId, supplierId: supplier.id, supplierName: supplier.name, userId: supplier.userId,
        note: note?.trim() || null,
      },
    });
  }

  /** 供应商端：进行中的预审列表 + 本人申请状态 */
  async listForSupplier(supplierId: string) {
    const prequals = await this.prisma.prequalification.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      include: { applications: { where: { supplierId }, select: { status: true, notifiedAt: true } } },
      take: 50,
    });
    return prequals.map(p => ({
      id: p.id, title: p.title, mode: p.mode, method: p.method, limitedCount: p.limitedCount,
      validUntil: p.validUntil, createdAt: p.createdAt,
      myStatus: p.applications[0]?.status ?? null,
    }));
  }

  /**
   * 登记评审结果（线下评审完成后）：逐申请 pass/fail ——
   * 7.2.3.4 合格发资格预审合格通知书（DOCX），未通过同步告知；预审随之关闭。
   */
  async decide(id: string, dto: { results: Array<{ applicationId: string; passed: boolean }>; note?: string }) {
    const prequal = await this.get(id);
    if (prequal.status === 'closed') throw new BadRequestException({ error: '该预审已结束', code: 'CLOSED' });
    if (!dto.results?.length) throw new BadRequestException({ error: '请登记至少一条结果', code: 'EMPTY' });

    const appMap = new Map(prequal.applications.map(a => [a.id, a]));
    const passedIds: string[] = [];
    const letters: Array<{ applicationId: string; fileAssetId: string }> = [];

    for (const r of dto.results) {
      const app = appMap.get(r.applicationId);
      if (!app) throw new BadRequestException({ error: `申请 ${r.applicationId} 不属于该预审`, code: 'BAD_APP' });

      const status = r.passed ? 'passed' : 'failed';
      if (r.passed) {
        const letter = await this.generatePassLetter(prequal, app.supplierName);
        letters.push({ applicationId: app.id, fileAssetId: letter.fileAssetId });
        passedIds.push(app.id);
      }

      await this.prisma.prequalApplication.update({
        where: { id: app.id },
        data: { status, notifiedAt: new Date() },
      });

      // 7.2.3.4：合格/未通过均告知
      await this.prisma.notification.create({
        data: {
          userId: app.userId,
          type: 'SYSTEM',
          title: r.passed ? '资格预审合格通知' : '资格预审结果通知',
          content: r.passed
            ? `贵公司已通过「${prequal.title}」资格预审，合格通知书已生成，可在供应商门户查看。`
            : `很遗憾，贵公司未通过「${prequal.title}」资格预审。如有异议可按公告约定提出。`,
          link: '/prequal',
        },
      }).catch(() => { /* 通知失败不阻塞 */ });
    }

    const result = {
      decidedAt: new Date().toISOString(),
      note: dto.note?.trim() || null,
      passedCount: passedIds.length,
      failedCount: dto.results.length - passedIds.length,
      letters,
    };
    return this.prisma.prequalification.update({
      where: { id },
      data: { status: 'closed', result: result as any },
      include: { applications: true },
    });
  }

  /** 资格预审合格通知书 DOCX（7.2.3.4） */
  private async generatePassLetter(prequal: { id: string; title: string; validUntil: Date | null }, supplierName: string) {
    const html = [
      `<h2>资格预审合格通知书</h2>`,
      `<p>${supplierName}：</p>`,
      `<p>贵单位参加的「${prequal.title}」资格预审已完成审查，经审查贵单位资格预审合格，获得参与约定内容范围和期限内采购项目竞争的基本资格。</p>`,
      prequal.validUntil ? `<p>本次资格预审合格有效期至：${new Date(prequal.validUntil).toLocaleDateString('zh-CN')}。</p>` : '',
      `<p>特此通知。（GB/T 43711 7.2.3.4）</p>`,
    ].join('');
    const doc = new Document({ sections: [{ properties: {}, children: htmlToDocxChildren(html) }] });
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const objectKey = `prequal/${prequal.id}/pass-letter-${supplierName}-${Date.now()}.docx`;
    await this.storage.upload(objectKey, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: buildStandardFileName({ code: prequal.title, name: supplierName, docType: '资格预审合格通知书' }),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        category: 'prequal_document',
      },
    });
    return { fileAssetId: asset.id, objectKey };
  }
}
