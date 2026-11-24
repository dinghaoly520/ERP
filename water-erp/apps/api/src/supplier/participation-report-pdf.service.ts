import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import pdfMake = require('pdfmake');
import { PrismaService } from '../prisma/prisma.service';

/* ═══════════════════════════════════════════════════════════════
   供应商参标情况 PDF 证明材料（2026-11-18，开标确认面板导出）

   与专家抽取情况 PDF（extraction-report-pdf.service）同版式体系：
   pdfmake + 内嵌 Noto Sans SC、字段式短行、紧凑数据表、页脚页码。

   两种口径（按采购方式自动分轨）：
   - 邀请制（谈判采购/直接采购，与面板 showRsvpColumn 同口径）：
     选取设置条件（向导草稿最佳努力）→ 邀请批次与回执（InvitationRsvp 按
     invitationId 分批 = 邀请/多轮补选）→ 参标终局汇总。
   - 公告类（其余方式）：公告与投递窗口 → 供应商参标表
     （意向确认/获取文件/投递状态，镜像 bid.service getWorkspace 行口径，不含密封报价）。

   宽表铁律（同日超限修复实录）：pdfmake 列宽不含左右内边距——列宽总和按
   「sum + 列数×8 ≤ 515（A4 内容宽）」预算，宽表一律 GRID_COMPACT。
   ═══════════════════════════════════════════════════════════════ */

function resolveFont(file: string): string {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'fonts', file),
    path.resolve(process.cwd(), 'assets', 'fonts', file),
    path.resolve(process.cwd(), 'src', 'assets', 'fonts', file),
  ];
  const hit = candidates.find(p => fs.existsSync(p));
  if (!hit) throw new Error(`PDF 字体缺失：${file}（已探测 ${candidates.join(' ; ')}）——请确认 nest-cli assets 拷贝配置或重新构建`);
  return hit;
}

let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  const fontsDir = path.resolve(__dirname, '..', 'assets', 'fonts');
  pdfMake.setFonts({
    NotoSansSC: { normal: resolveFont('NotoSansSC-Regular.otf'), bold: resolveFont('NotoSansSC-Bold.otf') },
  });
  pdfMake.setLocalAccessPolicy((p: string) => p.startsWith(fontsDir));
  fontsReady = true;
}

const GRID_COMPACT = {
  hLineColor: () => '#C9CFDA',
  vLineColor: () => '#C9CFDA',
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

const HEADER_FILL = '#F1F3F7';

@Injectable()
export class ParticipationReportPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async build(bidProjectId: string): Promise<{ buffer: Buffer; filename: string }> {
    const bp = await this.prisma.bidProject.findUnique({
      where: { id: bidProjectId },
      select: {
        id: true, name: true, projectCode: true, procurementMethod: true,
        openTime: true, deadline: true, stage: true,
        projectManagementItemId: true,
      },
    });
    if (!bp) throw new NotFoundException('项目不存在');
    let projectCode = bp.projectCode;
    const pmiId = bp.projectManagementItemId ?? null;
    if (pmiId) {
      const pm = await this.prisma.projectManagementItem.findUnique({ where: { id: pmiId }, select: { projectCode: true } });
      if (pm?.projectCode) projectCode = pm.projectCode;
    }

    const method = bp.procurementMethod ?? '';
    const isInviteFlow = method === '谈判采购' || method === '直接采购';

    const fmt = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
    const th = (text: string, size = 8.5): any => ({ text, bold: true, fillColor: HEADER_FILL, alignment: 'center', fontSize: size });
    const td = (text: string, opts?: { align?: 'left' | 'center'; size?: number }): any => ({ text: text || '—', alignment: opts?.align ?? 'center', fontSize: opts?.size ?? 8.5 });
    const labeled = (parts: Array<[string, string]>): any => ({
      text: parts.map(([k, v], i) => ([{ text: (i > 0 ? '　' : '') + k, bold: true }, { text: v }] as any[])).flat(),
      fontSize: 9.5, margin: [0, 0, 0, 3],
    });

    /* ── 一、项目基本信息 ── */
    const infoRows: Array<[string, string]> = [
      ['项目名称', bp.name],
      ['项目编号', projectCode],
      ['采购方式', method || '—'],
      ['开标时间', fmt(bp.openTime)],
      ['材料导出时间', fmt(new Date())],
    ];
    const infoTable = {
      layout: 'noBorders' as const,
      table: {
        widths: [88, '*'],
        body: infoRows.map(([k, v]) => [{ text: k, bold: true, fontSize: 10 }, { text: v, fontSize: 10 }]),
      },
    };

    /* ── 参标终局数据（两口径共用骨架：名册 + 投递合并） ── */
    const [bidSuppliers, submissions, intents] = await Promise.all([
      this.prisma.bidSupplier.findMany({
        where: { projectId: bp.id },
        include: { supplier: { select: { id: true, name: true, tags: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.supplierBidSubmission.findMany({
        where: { projectId: bp.id },
        select: { supplierId: true, status: true, submittedAt: true },
      }),
      this.prisma.supplierBidIntent.findMany({
        where: { projectId: bp.id },
        select: { supplierId: true, confirmedAt: true },
      }),
    ]);
    const subMap = new Map(submissions.map(s => [s.supplierId, s]));
    const intentMap = new Map(intents.map(i => [i.supplierId, i.confirmedAt] as const));
    const downloadLabel = (d: string | null | undefined) => (d === '已下载' ? '已获取' : d === '待下载' ? '未获取' : d || '—');
    const submitLabel = (supplierId: string | null) => {
      const sub = supplierId ? subMap.get(supplierId) : undefined;
      if (sub?.status === 'submitted') return { label: '已投递', at: sub.submittedAt };
      if (sub?.status === 'withdrawn') return { label: '已撤回', at: sub.submittedAt };
      return { label: '未投递', at: null as Date | null };
    };

    const sections: any[] = [];

    if (isInviteFlow) {
      /* ══ 邀请制：二、供应商选取设置条件（向导草稿最佳努力） ══ */
      const draftRows = pmiId
        ? await this.prisma.userDraft.findMany({
            where: { key: `supplier-selection:${pmiId}` },
            orderBy: { updatedAt: 'desc' },
            select: { payload: true, updatedAt: true, user: { select: { displayName: true } } },
            take: 1,
          }).catch(() => [])
        : [];
      const draft = (draftRows[0]?.payload ?? null) as any;
      const pickSections: any[] = [
        { text: '二、供应商选取设置条件', style: 'h1' },
      ];
      if (draft) {
        const d = draft;
        const parts: Array<[string, string]> = [
          ['选取方式：', d.pickMode === 'manual' ? '手动选择（直接搜索库内供应商）' : '智能推荐（业务标签与资格条件 AI 匹配）'],
          ['最近选取时间：', fmt(draftRows[0].updatedAt)],
        ];
        if (d.selectedTags?.length) parts.push(['业务标签：', d.selectedTags.join('、')]);
        if (d.maxCount) parts.push(['推荐数量上限：', `${d.maxCount} 家`]);
        const hc = d.hardConditions as any;
        if (hc) {
          const hcParts: string[] = [];
          if (hc.industries?.length) hcParts.push(`行业：${hc.industries.join('、')}`);
          if (hc.qualifications?.length) hcParts.push(`资质：${hc.qualifications.join('、')}`);
          if (hc.evalLevels?.length) hcParts.push(`业绩评价：${hc.evalLevels.join('、')}`);
          if (hcParts.length > 0) parts.push(['资格条件：', hcParts.join('；')]);
        }
        if (d.reqSpecial || d.reqOther) parts.push(['补充说明：', [d.reqSpecial, d.reqOther].filter(Boolean).join('／')]);
        pickSections.push(labeled(parts));
        const shortlist = (d.shortlist ?? {}) as Record<string, { item?: { name?: string; matchScore?: number; reason?: string }; note?: string }>;
        const entries = Object.entries(shortlist);
        if (entries.length > 0) {
          pickSections.push({ text: `候选名单（${entries.length} 家）：`, bold: true, fontSize: 10, margin: [0, 2, 0, 3] });
          pickSections.push({
            layout: GRID_COMPACT,
            table: {
              headerRows: 1,
              widths: ['*', 46, '*'], // 2 fixed + 星列：8+92+2×8 ≤ 515 ✓
              body: [
                [th('供应商'), th('匹配分'), th('推荐理由')],
                ...entries.map(([, v]) => [
                  td(v?.item?.name ?? '—', { align: 'left' }),
                  td(v?.item?.matchScore != null ? String(v.item.matchScore) : '—'),
                  td(v?.item?.reason || v?.note || '—', { align: 'left' }),
                ]),
              ],
            },
            margin: [0, 2, 0, 4],
          });
        }
        // 多轮补选（向导会话内的补选历史：每轮名单）
        const reruns = (d.rerunHistory ?? []) as Array<{ shortlist?: Record<string, { item?: { name?: string } }> }>;
        if (reruns.length > 0) {
          for (let r = 0; r < reruns.length; r++) {
            const names = Object.values(reruns[r].shortlist ?? {}).map(v => v?.item?.name).filter(Boolean);
            pickSections.push({ text: `补选第 ${r + 1} 轮候选（${names.length} 家）：${names.join('、') || '—'}`, fontSize: 9.5, margin: [0, 0, 0, 3] });
          }
        }
      } else {
        pickSections.push({ text: '选取设置条件未在服务端留痕（向导草稿未保存或由其他账号操作）——邀请与回执留痕见下节。', fontSize: 9.5, color: '#666666' });
      }
      sections.push(...pickSections);

      /* ══ 邀请制：三、邀请批次与回执（分批 = 邀请/多轮补选） ══ */
      const idSpaces = pmiId && pmiId !== bp.id ? [bp.id, pmiId] : [bp.id];
      const rsvpRows = (await this.prisma.invitationRsvp.findMany({
        where: { projectId: { in: idSpaces } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, invitationId: true, supplierName: true, status: true, note: true,
          notifiedAt: true, respondedAt: true, respondentType: true, respondedByName: true,
          staffReason: true, createdAt: true,
        },
      }).catch(() => [])) as Array<{
        id: string; invitationId: string; supplierName: string; status: string; note: string | null;
        notifiedAt: Date | null; respondedAt: Date | null; respondentType: string | null;
        respondedByName: string | null; staffReason: string | null; createdAt: Date;
      }>;
      const seenIds = new Set<string>();
      const rsvps = rsvpRows.filter(r => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));
      const batches = new Map<string, typeof rsvps>();
      for (const r of rsvps) {
        const arr = batches.get(r.invitationId) ?? [];
        arr.push(r);
        batches.set(r.invitationId, arr);
      }
      const rsvpCn = (s: string) => (s === 'ACCEPTED' ? '已确认参加' : s === 'DECLINED' ? '无法参加' : '待回执');
      const respondentCn = (t: string | null) => (t === 'SUPPLIER' ? '供应商链接自答' : t === 'STAFF' ? `工作人员代回应${''}` : t === 'SYSTEM' ? '系统（超时弃权）' : '—');

      sections.push({ text: '三、邀请批次与回执情况', style: 'h1' });
      if (batches.size === 0) {
        sections.push({ text: '未找到邀请回执记录。', fontSize: 10 });
      } else {
        sections.push({ text: `共 ${batches.size} 个邀请批次（第 2 批起为补选批次），合计 ${rsvps.length} 家次。`, fontSize: 10, margin: [0, 0, 0, 6] });
        let bi = 0;
        for (const [invId, rows] of batches) {
          bi++;
          const notified = rows.map(r => r.notifiedAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
          sections.push({
            text: `第 ${bi} 批${bi > 1 ? '（补选批次）' : '（初次邀请）'}：${rows.length} 家${notified ? `，通知时间 ${fmt(notified)}` : ''}`,
            bold: true, fontSize: 10.5, margin: [0, bi === 1 ? 2 : 10, 0, 4],
          });
          sections.push({
            layout: GRID_COMPACT,
            table: {
              headerRows: 1,
              widths: ['*', 62, 74, 100, 88], // fixed 324 + 2 星列 + 40 padding ≤ 515 ✓
              body: [
                [th('供应商'), th('回执状态'), th('回执时间'), th('回执方式'), th('备注/代回应理由')],
                ...rows.map(r => [
                  td(r.supplierName, { align: 'left' }),
                  td(rsvpCn(r.status)),
                  td(fmt(r.respondedAt)),
                  td(respondentCn(r.respondentType) + (r.respondedByName ? `（${r.respondedByName}）` : '')),
                  td(r.note || r.staffReason || '—', { align: 'left', size: 8 }),
                ]),
              ],
            },
            margin: [0, 2, 0, 4],
          });
        }
      }

      /* ══ 邀请制：四、参标情况汇总 ══ */
      const finalRows = [
        ...bidSuppliers.map(bs => ({
          name: bs.supplierName,
          tags: bs.supplier?.tags ?? [],
          rsvp: bs.supplierId ? rsvps.filter(r => r.supplierName === bs.supplierName).slice(-1)[0] : undefined,
          supplierId: bs.supplierId,
        })),
      ];
      sections.push({ text: '四、参标情况汇总', style: 'h1' });
      if (finalRows.length === 0) {
        sections.push({ text: '暂无参标供应商记录。', fontSize: 10 });
      } else {
        sections.push({
          layout: GRID_COMPACT,
          table: {
            headerRows: 1,
            widths: ['*', 74, 70, 74, 90], // fixed 308 + 星列 + 40 ≤ 515 ✓
            body: [
              [th('供应商'), th('邀请回执'), th('回执时间'), th('投递状态'), th('投递时间')],
              ...finalRows.map(r => {
                const st = submitLabel(r.supplierId);
                return [
                  td(r.name, { align: 'left' }),
                  td(r.rsvp ? rsvpCn(r.rsvp.status) : '—'),
                  td(fmt(r.rsvp?.respondedAt ?? null)),
                  td(st.label),
                  td(fmt(st.at)),
                ];
              }),
            ],
          },
        });
      }
    } else {
      /* ══ 公告类：二、公告与投递窗口 ══ */
      // BidProject 无发布时刻列——公告发布时间按关联编号取最早已发布/已下线公告的 publishDate
      const codes = [bp.projectCode, projectCode].filter(Boolean) as string[];
      const ann = codes.length > 0
        ? await this.prisma.announcement.findFirst({
            where: { relatedProjectCode: { in: codes }, status: { in: ['PUBLISHED', 'ARCHIVED'] } },
            orderBy: { publishDate: 'asc' },
            select: { publishDate: true },
          }).catch(() => null)
        : null;
      sections.push({ text: '二、公告与投递窗口', style: 'h1' });
      sections.push(labeled([
        ['公告发布时间：', fmt(ann?.publishDate ?? null)],
        ['投递截止时间：', fmt(bp.deadline)],
        ['参标路径：', '采购公告自行响应（确认意向 → 获取采购文件 → 投递标书）'],
      ]));

      /* ══ 公告类：三、供应商参标情况 ══ */
      type PubRow = { name: string; tags: string[]; intentAt: Date | null; download: string; supplierId: string | null };
      const rows: PubRow[] = [
        ...bidSuppliers.map(bs => ({
          name: bs.supplierName,
          tags: bs.supplier?.tags ?? [],
          intentAt: (bs.supplierId ? intentMap.get(bs.supplierId) : undefined) ?? null,
          download: downloadLabel(bs.downloadStatus),
          supplierId: bs.supplierId,
        })),
        ...intents.filter(i => !bidSuppliers.some(bs => bs.supplierId === i.supplierId)).map(i => ({
          name: '', tags: [] as string[], intentAt: i.confirmedAt, download: '—', supplierId: i.supplierId,
        })),
      ];
      // 意向-only 补行的名称回填（bidSupplier 无行时经 supplier 表反查）
      const missingNames = rows.filter(r => !r.name && r.supplierId);
      if (missingNames.length > 0) {
        const extra = (await this.prisma.supplier.findMany({
          where: { id: { in: missingNames.map(r => r.supplierId!) } },
          select: { id: true, name: true, tags: true },
        }).catch(() => [])) as Array<{ id: string; name: string; tags: string[] | null }>;
        const nameById = new Map(extra.map(s => [s.id, s]));
        for (const r of missingNames) {
          const s = r.supplierId ? nameById.get(r.supplierId) : undefined;
          if (s) { r.name = s.name; r.tags = s.tags ?? []; }
        }
      }
      sections.push({ text: '三、供应商参标情况', style: 'h1' });
      if (rows.length === 0) {
        sections.push({ text: '暂无供应商参标记录（公告发布并有人响应后出现在此）。', fontSize: 10 });
      } else {
        sections.push({
          layout: GRID_COMPACT,
          table: {
            headerRows: 1,
            widths: ['*', 110, 62, 62, 90], // fixed 324 + 星列 + 40 ≤ 515 ✓
            body: [
              // 获取文件列在意向确认列前（2026-11-24 用户裁定，与 :3005 弹窗/开标确认面板同序；两列等宽交换不动 widths）
              [th('供应商'), th('业务标签'), th('获取文件'), th('意向确认'), th('投递状态/时间')],
              ...rows.map(r => {
                const st = submitLabel(r.supplierId);
                return [
                  td(r.name || '—', { align: 'left' }),
                  td(r.tags.length > 0 ? r.tags.slice(0, 4).join('、') : '—', { align: 'left', size: 8 }),
                  td(r.download),
                  td(r.intentAt ? '已确认' : '未确认'),
                  td(`${st.label}${st.at ? `\n${fmt(st.at)}` : ''}`),
                ];
              }),
            ],
          },
        });
      }
    }

    const dd: any = {
      pageSize: 'A4',
      pageMargins: [40, 50, 40, 50],
      defaultStyle: { font: 'NotoSansSC', fontSize: 10.5 },
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: '供应商参标情况证明材料 · 系统自动生成', alignment: 'left', color: '#999999', fontSize: 8 },
          { text: `第 ${currentPage} 页 / 共 ${pageCount} 页`, alignment: 'right', color: '#999999', fontSize: 8 },
        ],
        margin: [50, 24, 50, 0],
      }),
      content: [
        { text: '供应商参标情况说明', style: 'docTitle' },
        { text: '（证明材料 · 系统自动生成）', style: 'docSub' },
        { text: '一、项目基本信息', style: 'h1' },
        infoTable,
        ...sections,
        { text: '说明', bold: true, fontSize: 10.5, margin: [0, 16, 0, 4] },
        { text: '1. 本材料由蜀水云采·智慧水发系统根据供应商邀请回执留痕与投递记录自动生成。', fontSize: 9, color: '#666666' },
        { text: '2. 邀请制项目的回执状态含供应商链接自答、工作人员代回应（附理由留痕）与系统超时弃权三类。', fontSize: 9, color: '#666666' },
        { text: '3. 标书报价为密封信息，开标解密前不在本材料中体现。', fontSize: 9, color: '#666666' },
      ],
      styles: {
        docTitle: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
        docSub: { fontSize: 9, alignment: 'center', color: '#666666', margin: [0, 0, 0, 16] },
        h1: { fontSize: 13, bold: true, margin: [0, 14, 0, 8] },
      },
    };

    ensureFonts();
    const buffer = await pdfMake.createPdf(dd).getBuffer();
    const filename = `供应商参标情况_${bp.name}_${new Date().toISOString().slice(0, 10)}.pdf`;
    return { buffer, filename };
  }
}
