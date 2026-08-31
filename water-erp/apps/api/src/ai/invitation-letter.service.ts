import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Document, Packer, AlignmentType, Paragraph, TextRun } from 'docx';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LlmService } from '../local-ai/llm.service';

/**
 * 采购邀请书（CTS-EBS01 A-53 邀请采购 · 非招标方式）：
 * AI 依据项目已知信息（BidProject + PMI + 附件步骤确认的时间）起草整篇公文体正文
 * （连续段落、无条目编号，八项法定要素织入行文），排版导出 Word；
 * 导出即落 MinIO 建 FileAsset，前端可直接加入附件清单随配置下发。
 */

/** 八项法定要素（prompt 行文指令用；正文不再逐条对应） */
export const INVITATION_ELEMENTS = [
  '采购项目名称和编码',
  '采购人名称（部门名称）',
  '采购交易方式',
  '供应商资格条件',
  '采购文件（或资格预审文件）的获取方法',
  '响应文件（或资格预审申请文件）的递交方法和截止时间（竞价采购的报价开始时间）',
  '公告的发布媒介',
  '提出异议的渠道和方式',
] as const;

/** 居右落款：统一以采购中心名义发出 */
const SIGN_OFF = '四川水利发展集团有限公司采购中心';
/** 称谓（本邀请书随配置批量下发受邀供应商，不预填具体单位名） */
const SALUTATION = '致：受邀供应商';

const MEDIA_DEFAULT = '四川水发集团电子采购平台（蜀水云采，https://ssyc.scswdc.com）及本项目信息门户';
const OBJECTION_DEFAULT =
  '贵单位认为采购文件、采购过程中存在使自己权益受到损害的情形的，可以以书面形式向采购人提出异议（联系人及电话见采购文件），或通过平台「异议」通道在线提交；对答复不满意或者采购人未在规定时间内作出答复的，可以在答复期满后依法向有关行政监督部门投诉。';

@Injectable()
export class InvitationLetterService {
  private readonly logger = new Logger(InvitationLetterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly llm: LlmService,
  ) {}

  /** 拉取项目已知信息（BidProject 为主，回链 PMI 补采购人/资格条件） */
  private async loadContext(projectId: string, times: { acquireStart?: string; acquireEnd?: string; bidAt?: string }) {
    const bpSelect = {
      id: true, name: true, projectCode: true, procurementMethod: true,
      openTime: true, deadline: true, downloadDeadline: true,
      qualification: true, qualityRequirement: true, budget: true, contact: true,
      sectionNo: true, sectionName: true,
    } as const;
    const bp = await this.prisma.bidProject.findUnique({ where: { id: projectId }, select: bpSelect })
      .catch(() => null)
      // 兼容误传 PMI id：按关联反查（前端 projectId 未解析时只带 ProjectManagementItem id）
      .then((r) => r ?? this.prisma.bidProject.findFirst({ where: { projectManagementItemId: projectId }, select: bpSelect }));
    if (!bp) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    const pmi = await this.prisma.projectManagementItem.findFirst({
      where: { bidProjects: { some: { id: bp.id } } },
      select: {
        title: true, projectCode: true, requesterName: true, requesterDepartment: true,
        supplierRequirements: true, procurementMethod: true, procurementCategory: true,
        budgetAmount: true, documentAcquireTime: true, invitedSuppliers: true,
      },
    });
    return {
      project: {
        name: bp.sectionName ? `${bp.name}（${bp.sectionNo ?? ''} ${bp.sectionName}）` : bp.name,
        code: bp.projectCode,
        method: bp.procurementMethod || pmi?.procurementMethod || '',
        qualification: bp.qualification || pmi?.supplierRequirements || '',
        quality: bp.qualityRequirement || '',
        budget: bp.budget != null ? Number(bp.budget) : pmi?.budgetAmount != null ? Number(pmi.budgetAmount) : null,
        contact: bp.contact || '',
        openTime: times.bidAt || bp.openTime?.toISOString() || '',
        acquireStart: times.acquireStart || '',
        acquireEnd: times.acquireEnd || (bp.downloadDeadline?.toISOString() ?? ''),
        acquireNote: pmi?.documentAcquireTime || '',
        invited: pmi?.invitedSuppliers || '',
      },
      // 采购人只写部门名称（不含经办人姓名）；「工程勘察院/钻探室」式斜杠层级连写
      purchaser: (pmi?.requesterDepartment || '').replace(/[\/／]/g, ''),
    };
  }

  /** 结构化已知信息直接成稿（LLM 不可用时的保底，保证功能可用）：公文体连续段落 */
  private fallbackParagraphs(ctx: Awaited<ReturnType<InvitationLetterService['loadContext']>>): string[] {
    const p = ctx.project;
    const fmt = (iso?: string) => {
      if (!iso) return '以采购公告载明的时间为准';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    };
    return [
      `${SIGN_OFF}现就「${p.name}」（项目编码：${p.code}）以${p.method}方式组织采购，采购人为${ctx.purchaser || SIGN_OFF}，现邀请贵单位参加本次采购活动。`,
      p.qualification
        ? `参加本次采购活动的供应商应当具备下列资格条件：${p.qualification}。`
        : '参加本次采购活动的供应商应当具备承担本项目的能力，具体资格条件以采购文件载明为准。',
      `采购文件（含资格预审文件，如有）请贵单位登录${MEDIA_DEFAULT.split('（')[0]}，于${p.acquireStart ? fmt(p.acquireStart) : '公告发布后'}至${p.acquireEnd ? fmt(p.acquireEnd) : '截标前'}期间在线获取；逾期未获取的，视为放弃参与资格。`,
      `响应文件请于${p.openTime ? fmt(p.openTime) : '采购文件载明的截止时间'}前通过上述平台在线递交，逾期递交的不予接收；递交截止时间即开启时间（竞价采购的报价开始时间以采购文件载明为准）。`,
      `本项目采购公告已同步通过${MEDIA_DEFAULT}发布，邀请书内容与公告不一致的，以采购文件为准。`,
      OBJECTION_DEFAULT,
    ];
  }

  /**
   * AI 输出清洗：
   * - 剥离 HTML 标签（LLM 偶发输出 <p>xxx</p>，嵌入排版 HTML 后在 docx 里漏出字面「p>」）
   * - 剥离条目编号前缀（模型惯性写「一、」「1.」等，公文体不要）——
   *   编号后必须紧跟分隔符（、.．），否则「四川水利…」的「四」会被误当编号吃掉
   * - 含 U+FFFD 乱码（模型采样偶发坏字）的段落整体弃用，回落结构化保底稿
   */
  private sanitizeAiParagraph(raw: string): string | null {
    let text = raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    text = text
      .replace(/^(?:[一二三四五六七八九十]{1,3}|\d{1,2}|[（(][一二三四五六七八九十\d]{1,3}[)）])[、.．:：]\s*/, '')
      .replace(/^[（(][一二三四五六七八九十\d]{1,3}[)）]\s*/, '')
      .trim();
    if (!text) return null;
    if (/�/.test(text)) return null;
    return text;
  }

  /** AI 起草整篇公文体正文；LLM 失败/段落脏数据回退结构化成稿 */
  async generate(projectId: string, times: { acquireStart?: string; acquireEnd?: string; bidAt?: string }) {
    const ctx = await this.loadContext(projectId, times);
    const p = ctx.project;
    const fallback = this.fallbackParagraphs(ctx);

    let paragraphs = fallback;
    let source: 'ai' | 'fallback' = 'fallback';
    try {
      const known = JSON.stringify(
        {
          项目名称: p.name, 项目编码: p.code, 采购方式: p.method, 采购人: ctx.purchaser,
          资格条件原文: p.qualification, 质量要求: p.quality, 预算金额: p.budget,
          联系方式: p.contact, 采购文件获取起止: [p.acquireStart, p.acquireEnd].filter(Boolean).join(' ~ ') || undefined,
          响应递交或开启时间: p.openTime || undefined, 已邀请供应商: p.invited || undefined,
        },
        null, 2,
      );
      const userPrompt = [
        '请根据以下项目已知信息，起草一份《采购邀请书》的正文。这是发给受邀供应商的正式公文，不是要素清单。',
        '',
        '文体与结构要求：',
        '- 书面公文体，连续段落行文，段与段之间内容自然衔接；',
        '- 严禁使用任何条目编号（一、1.、（1）等）、小标题或列表，每段就是一段完整的叙述；',
        '- 第一段为引言：以「四川水利发展集团有限公司采购中心现就〈项目名称〉（项目编码：××）以××方式组织采购……现邀请贵单位参加」起笔；',
        '- 之后 4~6 段依序涵盖：供应商资格条件、采购文件获取方法、响应文件递交方法与截止时间、公告发布媒介、异议渠道；',
        '- 对受邀方统一称「贵单位」；语气正式庄重；',
        '- 纯文本，禁止任何 HTML 标签或 Markdown 标记；已知信息不足处按行业规范表述补全（不得编造具体人名/电话/金额）。',
        '',
        '项目已知信息：', known,
        '',
        '固定口径：发布媒介与异议渠道若无更具体信息，分别使用："四川水发集团电子采购平台（蜀水云采）及本项目信息门户"与书面异议+平台异议通道+行政监督投诉的规范表述。',
        '输出 json：{"paragraphs": ["第一段", "第二段", ...]}，共 5~7 段。',
      ].join('\n');
      const result = await this.llm.chatJson<{ paragraphs?: unknown }>(
        '你是国企采购公文写作专家，精通《电子采购交易规范》与邀请采购公函。只输出 json。',
        userPrompt,
        0.2,
      );
      if (Array.isArray(result?.paragraphs)) {
        const cleaned = (result.paragraphs as unknown[])
          .map((t) => this.sanitizeAiParagraph(String(t ?? '')))
          .filter((t): t is string => !!t);
        if (cleaned.length >= 4) {
          paragraphs = cleaned;
          source = 'ai';
        }
      }
    } catch (err) {
      this.logger.warn(`邀请书 AI 起草失败，使用结构化成稿: ${err instanceof Error ? err.message : err}`);
    }

    return {
      paragraphs,
      source,
      salutation: SALUTATION,
      signOff: SIGN_OFF,
      project: { name: p.name, code: p.code },
    };
  }

  /**
   * 重要时间节点识别（加粗显示用）：
   * 「2026年8月28日9时00分」式单点，允许「（北京时间）」尾缀与「至」连接的区间连续整体。
   */
  private static readonly TIME_PATTERN =
    /\d{4}年\d{1,2}月\d{1,2}日(?:\s?\d{1,2}时\d{1,2}分)?(?:（北京时间）)?(?:至\d{4}年\d{1,2}月\d{1,2}日(?:\s?\d{1,2}时\d{1,2}分)?(?:（北京时间）)?)*/g;

  /** 段落 → TextRun 数组：时间节点 run 加粗，其余常规 */
  private buildBodyRuns(text: string): TextRun[] {
    const runs: TextRun[] = [];
    const pattern = new RegExp(InvitationLetterService.TIME_PATTERN.source, 'g');
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), size: 24, font: 'SimSun' }));
      runs.push(new TextRun({ text: m[0], bold: true, size: 24, font: 'SimSun' }));
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push(new TextRun({ text: text.slice(last), size: 24, font: 'SimSun' }));
    return runs.length > 0 ? runs : [new TextRun({ text, size: 24, font: 'SimSun' })];
  }

  /** 公文排版（标题/编号/称谓/正文段落/右落款）→ DOCX → 落 MinIO 建 FileAsset（供附件清单直接引用） */
  async exportDocx(input: {
    paragraphs: string[];
    project: { name: string; code: string };
    uploaderId?: string;
  }) {
    const { project } = input;
    if (!project?.name || !Array.isArray(input.paragraphs) || input.paragraphs.length === 0) {
      throw new BadRequestException({ error: '缺少邀请书内容或项目信息', code: 'BAD_INPUT' });
    }
    // 兜底再清洗一次：paragraphs 可能来自前端回传（用户可编辑混入标签/编号）
    const clean = (t: string) =>
      t.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const paragraphs = input.paragraphs.map(clean).filter((t) => t.length > 0);
    if (paragraphs.length === 0) {
      throw new BadRequestException({ error: '邀请书正文为空', code: 'BAD_INPUT' });
    }

    // 正文自构 Paragraph（不走 HTML 转换管线）：真首行缩进 + 时间节点加粗
    const children = [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '采购邀请书', bold: true, size: 44, font: 'SimSun' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `编号：${project.code}`, size: 21, font: 'SimSun' })] }),
      new Paragraph({ children: [new TextRun({ text: SALUTATION, size: 24, font: 'SimSun' })], spacing: { before: 300, after: 360 } }),
      ...paragraphs.map((t) => new Paragraph({
        children: this.buildBodyRuns(t),
        indent: { firstLine: 480 }, // 首行缩进两字符
        spacing: { line: 360, after: 120 },
      })),
      // 居右落款（替代原「采购人签名签章」条目）
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: SIGN_OFF, bold: true, size: 24, font: 'SimSun' })], spacing: { before: 600 } }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }), size: 24, font: 'SimSun' })], spacing: { before: 200 } }),
    ];
    const buffer = (await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }))) as Buffer;

    // ── 落 MinIO + FileAsset（不经过 UploadService：其会把 docx 转 PDF）──
    const now = new Date();
    const fileName = `采购邀请书-${project.name}-${now.getTime()}.docx`;
    const key = `general/invitation/${project.code}/${now.getTime()}.docx`;
    await this.storage.upload(key, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const asset = await this.prisma.fileAsset.create({
      data: {
        key,
        originalName: fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        category: 'general',
        uploaderId: input.uploaderId,
      },
    });
    this.logger.log(`采购邀请书已导出: ${fileName} (${buffer.length} bytes, source=${asset.id})`);
    return { id: asset.id, key: asset.key, url: `/api/upload/files/${asset.id}`, originalName: fileName, size: buffer.length };
  }
}
