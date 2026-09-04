import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Document, Packer } from 'docx';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { htmlToDocxChildren } from '../project-management/docx/html-to-docx.converter';
import { checkEliminationRatio, buildStandardFileName } from '@water-erp/shared';

/**
 * B4（GB/T 43711 附录 D）：框架协议采购两阶段——登记制。
 * 一阶段：竞争/资格审查完成 → 登记入围（D.2.6 淘汰比例校验，不满足可带理由放行留痕）→ 协议生效（DOCX 草案）。
 * 二阶段：从入围集合按约定规则直接选定或竞争后登记 → 生成订单合同（Contract.contractType=order，复用 C2 合同域）。
 * 变更：增补入围（D.3.4.1）、开放式随时退出（D.3.4.2）、价格调整（D.3.5）——changeLog 版本记录。
 */
@Injectable()
export class FrameworkService {
  private readonly logger = new Logger(FrameworkService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ────────────── 查询 ──────────────

  list(params: { status?: string; q?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.q) {
      where.OR = [
        { title: { contains: params.q, mode: 'insensitive' } },
        { faCode: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.frameworkAgreement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { entries: { orderBy: { entryAt: 'desc' } } },
      take: 100,
    });
  }

  async get(id: string) {
    const fa = await this.prisma.frameworkAgreement.findUnique({
      where: { id },
      include: { entries: { orderBy: { entryAt: 'desc' } } },
    });
    if (!fa) throw new NotFoundException({ error: '框架协议不存在', code: 'NOT_FOUND' });
    return fa;
  }

  /** :3020 供应商：我入围的框架协议 */
  async listForSupplier(supplierId: string) {
    const entries = await this.prisma.faEntry.findMany({
      where: { supplierId },
      include: { fa: true },
      orderBy: { entryAt: 'desc' },
    });
    return entries.map(e => ({
      entryId: e.id,
      status: e.status,
      shareRatio: e.shareRatio != null ? Number(e.shareRatio) : null,
      entryAt: e.entryAt,
      fa: {
        id: e.fa.id, faCode: e.fa.faCode, title: e.fa.title, variant: e.fa.variant,
        validUntil: e.fa.validUntil, status: e.fa.status,
        priceRule: e.fa.priceRule, quotaRule: e.fa.quotaRule, secondStageRule: e.fa.secondStageRule,
      },
    }));
  }

  // ────────────── B4a 一阶段 ──────────────

  async create(dto: {
    title: string; entryMode?: string; variant?: string;
    catalogCategoryId?: number; projectManagementItemId?: string;
    validFrom: string; validUntil: string;
    priceRule?: any; quotaRule?: any; secondStageRule?: string;
  }, stamp: { companyId?: string; companyName?: string }) {
    if (!dto.title?.trim()) throw new BadRequestException({ error: '请填写协议名称', code: 'BAD_PARAMS' });
    if (dto.variant === 'supplier_price_qty' && !dto.quotaRule) {
      throw new BadRequestException({ error: '定商定价定量必须约定数量范围/占比（表 D.1）', code: 'QUOTA_REQUIRED' });
    }
    if (dto.variant && dto.variant !== 'supplier_only' && !dto.priceRule) {
      throw new BadRequestException({ error: '定商定价以上必须约定计价规则/基准价格（表 D.1）', code: 'PRICE_RULE_REQUIRED' });
    }
    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime()) || validUntil <= validFrom) {
      throw new BadRequestException({ error: '有效期起止不合法', code: 'BAD_VALIDITY' });
    }

    const faCode = await this.nextFaCode();
    return this.prisma.frameworkAgreement.create({
      data: {
        faCode,
        title: dto.title.trim(),
        entryMode: dto.entryMode === 'open' ? 'open' : 'closed',
        variant: dto.variant ?? 'supplier_price',
        catalogCategoryId: dto.catalogCategoryId ?? null,
        projectManagementItemId: dto.projectManagementItemId ?? null,
        validFrom, validUntil,
        priceRule: dto.priceRule ?? null,
        quotaRule: dto.quotaRule ?? null,
        secondStageRule: dto.secondStageRule?.trim() || null,
        status: 'entry',
        companyId: stamp.companyId ?? null,
        companyName: stamp.companyName ?? null,
      },
    });
  }

  /** 登记入围供应商（一阶段结果；幂等去重按名称） */
  async addEntries(id: string, dto: { entries: Array<{ supplierName: string; supplierId?: string; shareRatio?: number; note?: string }> }) {
    const fa = await this.get(id);
    if (fa.status !== 'entry' && fa.status !== 'active') {
      throw new BadRequestException({ error: '协议当前状态不可登记入围', code: 'BAD_STATUS' });
    }
    if (!dto.entries?.length) throw new BadRequestException({ error: '请提供入围供应商', code: 'EMPTY' });

    const existing = new Set(fa.entries.map(e => e.supplierName));
    const news = dto.entries.filter(e => e.supplierName?.trim() && !existing.has(e.supplierName.trim()));
    if (news.length === 0) return fa;

    return this.prisma.frameworkAgreement.update({
      where: { id },
      data: {
        entries: {
          create: news.map(e => ({
            supplierName: e.supplierName.trim(),
            supplierId: e.supplierId ?? null,
            shareRatio: e.shareRatio ?? null,
            note: e.note?.trim() || null,
            status: fa.status === 'active' ? 'supplemented' : 'active', // D.3.4.1 生效后增补标 supplemented
          })),
        },
      },
      include: { entries: true },
    });
  }

  /**
   * 一阶段完成 → 协议生效（D.2.6 淘汰比例校验；不满足须 overrideReason 留痕）。
   * 生成框架协议文本 DOCX（价格规则/有效期/权利义务/退出条款，D.3.3.4）。
   */
  async activate(id: string, dto: { rounds?: number; participants?: number; overrideReason?: string }) {
    const fa = await this.get(id);
    if (fa.status !== 'entry') throw new BadRequestException({ error: '仅入围登记中的协议可生效', code: 'BAD_STATUS' });
    const activeEntries = fa.entries.filter(e => e.status !== 'exited');
    if (activeEntries.length === 0) throw new BadRequestException({ error: '请先登记入围供应商', code: 'NO_ENTRIES' });

    // D.2.6 校验（封闭式含价格竞争时）
    const rounds = dto.rounds ?? 1;
    const participants = dto.participants ?? activeEntries.length;
    const check = checkEliminationRatio({
      entryMode: fa.entryMode, rounds,
      participants: [participants],
      entered: activeEntries.length,
    });
    if (!check.passed && !dto.overrideReason?.trim()) {
      throw new BadRequestException({
        error: `${check.detail}——如确需放行请填写放行理由（overrideReason）`,
        code: 'ELIMINATION_RATIO',
      });
    }

    const doc = await this.generateFaDocx(fa, activeEntries.map(e => e.supplierName));
    const updated = await this.prisma.frameworkAgreement.update({
      where: { id },
      data: {
        status: 'active',
        eliminationCheck: { ...check, overrideReason: dto.overrideReason?.trim() || null, checkedAt: new Date().toISOString() } as any,
        changeLog: [...((fa.changeLog as any[]) ?? []), { at: new Date().toISOString(), action: 'activate', note: check.detail }],
      },
      include: { entries: true },
    });
    return { agreement: updated, docx: doc };
  }

  // ────────────── B4b 二阶段成交 ──────────────

  /**
   * 二阶段成交登记（D.3.7）：从入围集合直接选定（第一阶段已完成价格竞争且要素不变）
   * 或二次竞争（线下/既有流程）后登记 → 生成订单式合同（挂 Contract，contractType=order）。
   */
  async secondStageOrder(id: string, dto: {
    entryId: string; title?: string; amount?: number;
    selectionRule?: string; keyTerms?: Record<string, any>;
  }) {
    const fa = await this.get(id);
    if (fa.status !== 'active') throw new BadRequestException({ error: '框架协议未生效', code: 'NOT_ACTIVE' });
    const entry = fa.entries.find(e => e.id === dto.entryId && e.status !== 'exited');
    if (!entry) throw new BadRequestException({ error: '该供应商不在有效入围名单中', code: 'NOT_ENTERED' });
    if (fa.validUntil < new Date()) {
      throw new BadRequestException({ error: '框架协议已过有效期', code: 'EXPIRED' });
    }
    // D.2.5：定商框架协议第二阶段【应】通过竞争方式确定成交供应商——
    // 直接登记时必须填写 selectionRule 说明本轮竞争情况（竞争后登记），否则拒绝
    if (fa.variant === 'supplier_only' && !dto.selectionRule?.trim()) {
      throw new BadRequestException({
        error: '定商框架协议第二阶段应通过竞争方式确定成交供应商（GB/T 43711 D.2.5），请在 selectionRule 中说明本轮竞争情况',
        code: 'COMPETITION_REQUIRED',
      });
    }

    // 复用合同域生成订单（projectCode 用 faCode 承载关联）
    const contractCode = await this.nextOrderCode();
    const selectionRule = dto.selectionRule?.trim()
      || '第一阶段已完成价格竞争且约定要素不变，按采购文件约定规则直接选定（D.3.7）';
    const contract = await this.prisma.contract.create({
      data: {
        contractCode,
        projectCode: fa.faCode,
        projectManagementItemId: fa.projectManagementItemId,
        supplierId: entry.supplierId ?? 'fa-' + entry.id,
        supplierName: entry.supplierName,
        contractType: 'order',
        // 二阶段选定不等于合同已签署；签署件上传后再由合同域 sign() 落 signed。
        status: 'approved_for_signing',
        signedAt: null,
        signedAssetId: null,
        consistencyResult: {
          checkedAt: new Date().toISOString(),
          manualConfirm: true,
          source: 'none',
          consistent: true,
          issues: [],
          basis: 'framework_second_stage',
          faCode: fa.faCode,
          selectionRule,
        } as any,
        amount: dto.amount != null ? dto.amount : null,
        keyTerms: {
          ...(dto.keyTerms ?? {}),
          faCode: fa.faCode,
          secondStageRule: fa.secondStageRule,
          selectionRule,
        } as any,
        companyId: fa.companyId,
        companyName: fa.companyName,
      },
    });

    await this.prisma.frameworkAgreement.update({
      where: { id },
      data: {
        changeLog: [...((fa.changeLog as any[]) ?? []), {
          at: new Date().toISOString(), action: 'second_stage_order',
          note: `二阶段订单 ${contract.contractCode} → ${entry.supplierName}${dto.amount != null ? `（¥${dto.amount}）` : ''}`,
        }],
      },
    });
    return contract;
  }

  // ────────────── B4c 变更与退出 ──────────────

  /** 开放式入围供应商随时申请退出（D.3.4.2）；封闭式退出须理由（变更协议） */
  async exitEntry(id: string, entryId: string, reason?: string) {
    const fa = await this.get(id);
    if (fa.entryMode === 'closed' && !reason?.trim()) {
      throw new BadRequestException({ error: '封闭式协议退出须填写理由（变更协议，D.3.5）', code: 'REASON_REQUIRED' });
    }
    const entry = fa.entries.find(e => e.id === entryId && e.status !== 'exited');
    if (!entry) throw new BadRequestException({ error: '入围记录不存在或已退出', code: 'NOT_FOUND' });
    const updated = await this.prisma.faEntry.update({
      where: { id: entryId },
      data: { status: 'exited', exitedAt: new Date(), note: reason?.trim() || entry.note },
    });
    await this.prisma.frameworkAgreement.update({
      where: { id },
      data: { changeLog: [...((fa.changeLog as any[]) ?? []), { at: new Date().toISOString(), action: 'exit', note: `${entry.supplierName} 退出${reason ? '：' + reason.trim() : ''}` }] },
    });
    return updated;
  }

  /** 价格调整（D.3.5：超一年或市场波动大可约定调整条件）——版本记录 */
  async adjustPriceRule(id: string, dto: { priceRule: any; note: string }) {
    if (!dto.note?.trim()) throw new BadRequestException({ error: '请填写调整依据', code: 'NOTE_REQUIRED' });
    const fa = await this.get(id);
    return this.prisma.frameworkAgreement.update({
      where: { id },
      data: {
        priceRule: dto.priceRule,
        changeLog: [...((fa.changeLog as any[]) ?? []), { at: new Date().toISOString(), action: 'price_adjust', note: dto.note.trim(), prev: fa.priceRule }],
      },
    });
  }

  /** 终止协议 */
  async terminate(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException({ error: '请填写终止理由', code: 'REASON_REQUIRED' });
    const fa = await this.get(id);
    return this.prisma.frameworkAgreement.update({
      where: { id },
      data: {
        status: 'terminated',
        changeLog: [...((fa.changeLog as any[]) ?? []), { at: new Date().toISOString(), action: 'terminate', note: reason.trim() }],
      },
    });
  }

  // ────────────── 工具 ──────────────

  private async nextFaCode() {
    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const prefix = `FA-${ym}-`;
    const latest = await this.prisma.frameworkAgreement.findFirst({
      where: { faCode: { startsWith: prefix } },
      orderBy: { faCode: 'desc' },
      select: { faCode: true },
    });
    const next = latest ? Number(latest.faCode.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private async nextOrderCode() {
    const prefix = 'DD-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-';
    const latest = await this.prisma.contract.findFirst({
      where: { contractCode: { startsWith: prefix } },
      orderBy: { contractCode: 'desc' },
      select: { contractCode: true },
    });
    const next = latest ? Number(latest.contractCode.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(next).padStart(3, '0')}`;
  }

  /** 框架协议文本 DOCX（D.3.3.4 要素） */
  private async generateFaDocx(fa: any, supplierNames: string[]) {
    const terms = (fa.priceRule as Record<string, any>) ?? {};
    const html = [
      `<h2>采购框架协议（${fa.faCode}）</h2>`,
      `<p>协议名称：${fa.title}；入围方式：${fa.entryMode === 'open' ? '开放式资格审查' : '封闭式竞争入围'}；实施类型：${fa.variant === 'supplier_only' ? '定商' : fa.variant === 'supplier_price' ? '定商定价' : '定商定价定量'}。</p>`,
      `<p>有效期：${new Date(fa.validFrom).toLocaleDateString('zh-CN')} 至 ${new Date(fa.validUntil).toLocaleDateString('zh-CN')}。</p>`,
      `<p>入围供应商：${supplierNames.join('、')}。</p>`,
      terms.formula ? `<p>价格规则：${String(terms.formula)}。</p>` : '',
      fa.quotaRule ? `<p>数量/占比约定：${JSON.stringify(fa.quotaRule)}。</p>` : '',
      `<p>第二阶段成交规则：${fa.secondStageRule ?? '按采购文件约定，从入围供应商中以竞争方式或约定规则确定成交供应商'}。</p>`,
      `<p>入围供应商增补与退出、价格调整按 GB/T 43711 附录 D D.3.4/D.3.5 执行；争议解决：协商解决，协商不成向有管辖权的人民法院起诉。</p>`,
      `<p>本协议由系统按登记要素生成（GB/T 43711 D.3.3），双方权利义务以正式签署文本为准。</p>`,
    ].join('');
    const doc = new Document({ sections: [{ properties: {}, children: htmlToDocxChildren(html) }] });
    const buffer = Buffer.from(await Packer.toBuffer(doc));
    const objectKey = `framework/${fa.id}/agreement-${Date.now()}.docx`;
    await this.storage.upload(objectKey, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key: objectKey,
        originalName: buildStandardFileName({ code: fa.faCode, name: fa.title, docType: '框架协议' }),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        category: 'framework_document',
      },
    });
    return { fileAssetId: asset.id, objectKey, size: buffer.length };
  }
}
