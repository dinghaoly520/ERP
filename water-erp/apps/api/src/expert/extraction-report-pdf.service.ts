import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import pdfMake = require('pdfmake');
import { PrismaService } from '../prisma/prisma.service';
import { openPiiForMask } from '../common/crypto/sm-field-crypto';

/* ═══════════════════════════════════════════════════════════════
   专家抽取情况 PDF 证明材料（2026-11-10，取代 Word 版导出）

   沿文件审查报告 2026-10-28 裁定原理（服务端确定性、无外部进程依赖、单轨直出），
   载体由 docx 改为 PDF：pdfmake + 仓库内嵌 Noto Sans SC（OFL，assets/fonts/），
   本机/生产/CI 全环境一致出 PDF，不再依赖 Word/LibreOffice。

   2026-11-10 同日内容重排：AI 环节 run-on 拆要点条目、轮次元信息改字段式短行、
   配额表空列动态收敛、各轮人员表（含第 1 轮）逐人记录接受/婉拒、
   候补交叉引用改按节名（修「六/五」编号漂移）、尾注拆三条编号说明、页脚页码。
   ═══════════════════════════════════════════════════════════════ */

/** 字体解析：dist 与 src 两种运行布局各探一次，失败列出已探路径便于部署排查 */
function resolveFont(file: string): string {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'fonts', file), // dist/expert → dist/assets；src/expert → src/assets
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
  // 本地文件访问只放行字体目录（pdfmake 0.3 安全默认：未设策略时告警）
  pdfMake.setLocalAccessPolicy((p: string) => p.startsWith(fontsDir));
  fontsReady = true;
}

/** 数据表通用版式：浅灰框线 + 表头底纹 + 紧凑内边距 */
const GRID_LAYOUT = {
  hLineColor: () => '#C9CFDA',
  vLineColor: () => '#C9CFDA',
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  paddingLeft: () => 5,
  paddingRight: () => 5,
  paddingTop: () => 3.5,
  paddingBottom: () => 3.5,
};

/** 宽表紧凑版式（2026-11-18 表格超限修复）：pdfmake 列宽不含左右内边距——
 *  每列实际渲染宽 = 指定宽 + paddingLeft + paddingRight（9 列 ×10pt ≈ +90pt，
 *  实测表格右线 644.75pt 超出 A4 页宽 595.28）。宽表统一用本版式（4+4=8pt/列），
 *  且列宽总和按「sum + 列数×8 ≤ 515（A4 内容宽）」预算。 */
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
export class ExtractionReportPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async build(projectId: string): Promise<{ buffer: Buffer; filename: string }> {
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: {
        name: true, projectCode: true, procurementMethod: true, openTime: true, stage: true,
        projectManagementItemId: true,
      },
    });
    if (!project) throw new NotFoundException('项目不存在');
    let projectCode = project.projectCode;
    if (project.projectManagementItemId) {
      const pm = await this.prisma.projectManagementItem.findUnique({ where: { id: project.projectManagementItemId }, select: { projectCode: true } });
      if (pm?.projectCode) projectCode = pm.projectCode;
    }

    // 抽取配置快照与 AI 辅助环节留痕（preview body 带完整配额；ai-leader/analyze-project
    // 调用在操作日志）——按 projectId 从 body 反查
    const extractOpLogs = await this.prisma.operationLog.findMany({
      where: {
        method: 'POST',
        path: {
          in: [
            '/api/expert-admin/extract',
            '/api/expert-admin/extract/ai-leader',
            '/api/expert-admin/extract/analyze-project',
            '/api/expert-admin/extract/notify',
          ],
        },
        body: { path: ['projectId'], equals: projectId },
      },
      orderBy: { createdAt: 'asc' },
      select: { path: true, body: true, createdAt: true, username: true },
    }).catch(() => [] as { path: string; body: unknown; createdAt: Date; username: string | null }[]);

    // 配置快照：preview 调用按内容去重（同一配置多次预览只留一次）
    const rawConfigs = extractOpLogs.filter(l => l.path === '/api/expert-admin/extract') as Array<{ body: any; createdAt: Date; username: string | null }>;
    const configSnapshots: Array<{ key: string; at: Date; body: any; username: string | null }> = [];
    for (const l of rawConfigs) {
      const key = JSON.stringify({ m: l.body?.extractMode, t: l.body?.totalNeeded, a: l.body?.alternatives, q: l.body?.manualQuotas, e: l.body?.excludedUserIds, em: l.body?.employer });
      if (configSnapshots.some(c => c.key === key)) continue;
      configSnapshots.push({ key, at: l.createdAt, body: l.body ?? {}, username: l.username ?? null });
    }
    // 配额里公司 id → 名称；预排除专家 id → 姓名
    const quotaCompanyIds = [...new Set(configSnapshots.flatMap(c => (c.body?.manualQuotas ?? []).flatMap((q: any) => q?.companyIds ?? []).filter(Boolean) as string[]))];
    const excludedIds = [...new Set(configSnapshots.flatMap(c => (c.body?.excludedUserIds ?? []) as string[]))];
    const [quotaCompanies, excludedUsers] = await Promise.all([
      quotaCompanyIds.length > 0
        ? this.prisma.company.findMany({ where: { id: { in: quotaCompanyIds } }, select: { id: true, name: true } }).catch(() => [] as { id: string; name: string }[])
        : Promise.resolve([] as { id: string; name: string }[]),
      excludedIds.length > 0
        ? this.prisma.user.findMany({ where: { id: { in: excludedIds } }, select: { id: true, displayName: true } }).catch(() => [] as { id: string; displayName: string }[])
        : Promise.resolve([] as { id: string; displayName: string }[]),
    ]);
    const companyNameById = new Map(quotaCompanies.map(c => [c.id, c.name]));
    const excludedNameById = new Map(excludedUsers.map(u => [u.id, u.displayName]));

    // 抽取事件（含补选轮次）：审计快照带 extractMode/命中序列
    const extractionEvents = await this.prisma.auditLog.findMany({
      where: { action: 'EXPERT_EXTRACTION_CONFIRMED', resourceId: projectId },
      orderBy: { createdAt: 'asc' },
      select: { details: true, createdAt: true, user: { select: { displayName: true } } },
    });

    // 当前名册（正选+候补）+ 详情 + 邀请留痕
    const roster = await this.prisma.bidExpert.findMany({
      where: { projectId },
      orderBy: [{ expertRole: 'desc' }, { createdAt: 'asc' }],
      include: { user: { select: { displayName: true, phone: true, department: { select: { name: true } }, expertProfile: { select: { title: true, employer: true, phone: true } } } } },
    });
    // 邀请轨迹按行挂载 + 确认方式/时间三级推导：优先轨迹终笔，次行字段
    // （rsvpRespondedAt/invitationActorType），存量兜底：confirmed 无痕=工作人员确认、
    // 时间取行更新时刻（该路径确认后无其他写点，updatedAt≈确认时刻）
    const rosterLogs = roster.length > 0
      ? await this.prisma.expertInvitationLog.findMany({
          where: { bidExpertId: { in: roster.map(r => r.id) } },
          orderBy: { createdAt: 'asc' },
        }).catch(() => [] as Array<{ bidExpertId: string; action: string; actorType: string; toStatus: string | null; createdAt: Date }>)
      : [];
    const trailByBeId = new Map<string, typeof rosterLogs>();
    for (const l of rosterLogs) {
      const arr = trailByBeId.get(l.bidExpertId) ?? [];
      arr.push(l);
      trailByBeId.set(l.bidExpertId, arr);
    }
    const confirmOf = (r: (typeof roster)[number]) => {
      const trail = (trailByBeId.get(r.id) ?? []).filter(t =>
        ['RESPONDED', 'STAFF_MARKED', 'AUTO_DECLINED', 'PROMOTED', 'SWAP_IN'].includes(t.action));
      const last = trail.length > 0 ? trail[trail.length - 1] : null;
      if (r.invitationStatus === 'pending') return { actor: null as string | null, time: null as Date | null };
      const actor = r.invitationActorType ?? last?.actorType ?? (r.rsvpRespondedAt ? 'EXPERT' : 'STAFF');
      const time = r.rsvpRespondedAt ?? last?.createdAt ?? r.updatedAt;
      return { actor: actor as string | null, time };
    };

    // 轮次人员姓名/状态兜底：已删名册行经 user 表反查；user 也查无（seed 清库/存量）
    // 时按审计快照 details.experts 自带姓名兜底——名册名仍为第一权威，快照只填空缺
    const roundUserIds = [...new Set(extractionEvents.flatMap(ev => {
      const d = (ev.details ?? {}) as any;
      return [...((d.drawnUserIds ?? []) as string[]), ...((d.poolUserIds ?? []) as string[])];
    }))].filter(id => !roster.some(r => r.userId === id));
    const extraUsers = roundUserIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: roundUserIds } }, select: { id: true, displayName: true } }).catch(() => [] as { id: string; displayName: string }[])
      : [];
    const nameByUserId = new Map<string, string>([
      ...roster.map(r => [r.userId, r.expertName] as [string, string]),
      ...extraUsers.map(u => [u.id, u.displayName] as [string, string]),
    ]);
    for (const ev of extractionEvents) {
      for (const e of ((((ev.details ?? {}) as any).experts ?? []) as any[]) ?? []) {
        if (e?.userId && e?.name && !nameByUserId.has(e.userId)) nameByUserId.set(e.userId, e.name);
      }
    }
    const rowByUserId = new Map(roster.map(r => [r.userId, r] as [string, typeof r]));
    // 第 i 轮配置：该轮确认时刻窗口内（上一轮确认之后～本轮确认之前）最近的配置快照；
    // 初次轮放宽为「首次确认前最近一次」
    const roundCfg = (i: number) => {
      const ev = extractionEvents[i];
      const prevAt = i > 0 ? extractionEvents[i - 1].createdAt.getTime() : Number.NEGATIVE_INFINITY;
      const inWindow = configSnapshots.filter(cs => cs.at.getTime() > prevAt && cs.at.getTime() <= ev.createdAt.getTime());
      if (inWindow.length > 0) return inWindow[inWindow.length - 1];
      if (i === 0) {
        const before = configSnapshots.filter(cs => cs.at.getTime() <= ev.createdAt.getTime());
        return before.length > 0 ? before[before.length - 1] : null;
      }
      return null;
    };
    const MODE_LABELS: Record<string, string> = {
      specialty_match: '专业匹配（按专业配额在候选池中匹配择定）',
      random: '随机抽取（系统在符合条件的候选池中随机抽出）',
      merit_best: '综合择优（按履职评价/偏离度/负荷等综合评分排序择定）',
      manual: '专家选取（工作人员按需求手动选定）',
    };
    const stCn = (s: string) => (s === 'confirmed' ? '已确认参加' : s === 'declined' ? '已婉拒' : '待回复');
    const actorCn = (a: string | null) => (a === 'EXPERT' ? '专家本人回复' : a === 'STAFF' ? '工作人员代回应' : a === 'SYSTEM' ? '系统（超时/递补）' : '—');
    const actorShort = (a: string | null) => (a === 'EXPERT' ? '本人回复' : a === 'STAFF' ? '代回应' : a === 'SYSTEM' ? '系统' : '—');
    const fmt = (d: Date | null | undefined) => (d ? new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
    const fmtCell = (d: Date | null | undefined) => (d ? fmt(d).replace(' ', '\n') : '—');

    /* ── 版式小件 ── */
    const th = (text: string, size = 8.5): any => ({ text, bold: true, fillColor: HEADER_FILL, alignment: 'center', fontSize: size });
    const td = (text: string, opts?: { align?: 'left' | 'center'; size?: number }): any => ({ text: text || '—', alignment: opts?.align ?? 'center', fontSize: opts?.size ?? 8.5 });
    const labeled = (parts: Array<[string, string]>): any => ({
      text: parts.map(([k, v], i) => ([{ text: (i > 0 ? '　' : '') + k, bold: true }, { text: v }] as any[])).flat(),
      fontSize: 9.5, margin: [0, 0, 0, 3],
    });

    const regulars = roster.filter(r => r.expertRole === '正选');
    const confirmedRegulars = regulars.filter(r => r.invitationStatus === 'confirmed');
    const activeAlts = roster.filter(r => r.expertRole === '候补' && r.invitationStatus !== 'declined');
    // 需求方代表（2026-11-18 用户裁定：完整资料展示，手动录入的尤其需要）——
    // 加入方式推导：出现在任一抽取事件选定/候补序列 = 抽取选定，否则 = 手动录入
    const extractedUserIds = new Set(extractionEvents.flatMap(ev => {
      const d = (ev.details ?? {}) as any;
      return [...((d.drawnUserIds ?? []) as string[]), ...((d.poolUserIds ?? []) as string[])];
    }));
    const purchaserReps = roster.filter(r => r.isPurchaserRepresentative);
    const repJoinCn = (r: (typeof roster)[number]) => (extractedUserIds.has(r.userId) ? '抽取选定' : '手动录入');
    const repPhone = (r: (typeof roster)[number]) =>
      openPiiForMask(r.user?.expertProfile?.phone ?? r.user?.phone ?? null) ?? '';
    // 代回应理由留痕（2026-11-18 用户裁定）：STAFF 代回应行的理由逐条列出（表下方脚注）
    const reasonFootnotes = (rows: typeof roster): any[] => {
      const notes = rows.filter(r => r.invitationActorType === 'STAFF' && r.invitationReason?.trim());
      if (notes.length === 0) return [];
      return [{
        text: '代回应留痕：' + notes.map(r =>
          `${r.expertName}${r.invitationActorName ? `（代回应人 ${r.invitationActorName}）` : ''}——${r.invitationReason!.trim()}`).join('；') + '。',
        fontSize: 8.5, color: '#666666', margin: [0, 2, 0, 6],
      }];
    };

    // 轮次元信息（设置条件节与结果流转节共用）：类型 + 标题
    const roundMeta = (i: number, drawn: number, alts: number) => {
      if (i === 0) return { title: '第 1 轮（初次抽取·正选）', kind: 'first' as const };
      if (drawn === 0 && alts > 0) return { title: `第 ${i + 1} 轮（候补抽取）`, kind: 'alt' as const };
      return { title: `第 ${i + 1} 轮（补选·正选）`, kind: 're' as const };
    };

    /* ── 一、项目基本信息（含评审组构成概要） ── */
    const infoTable = {
      layout: 'noBorders' as const,
      table: {
        widths: [88, '*'],
        body: ([
          ['项目名称', project.name],
          ['项目编号', projectCode],
          ['采购方式', project.procurementMethod || '—'],
          ['开标时间', fmt(project.openTime)],
          ['评审组构成', `正选 ${regulars.length} 名（已确认 ${confirmedRegulars.length} 名）${activeAlts.length > 0 ? ` · 候补 ${activeAlts.length} 名` : ''}`],
          ['材料导出时间', fmt(new Date())],
        ] as [string, string][]).map(([k, v]) => [{ text: k, bold: true, fontSize: 10 }, { text: v, fontSize: 10 }]),
      },
    };

    /* ── 二、抽取设置条件：各轮完整条件（初次/候补抽取/补选统一口径） ── */
    const quotaTable = (cfg: { body?: any } | null): any[] => {
      const q = ((cfg?.body?.manualQuotas ?? []) as any[]) ?? [];
      if (q.length === 0) return [];
      const quotaCols = [
        { label: '专业要求', width: '*', values: q.map((row: any) => (row.specialties?.length ? row.specialties.join('、') : row.specialty) || '不限专业') },
        { label: '人数', width: 34, values: q.map((row: any) => String(row.count ?? '—')) },
        { label: '公司限定', width: '*', values: q.map((row: any) => (row.companyIds?.length ? row.companyIds.map((id: string) => companyNameById.get(id) ?? id).join('、') : row.employer) || '不限') },
        { label: '部门限定', width: 64, values: q.map((row: any) => row.department || '—') },
        { label: '库内等级', width: 64, values: q.map((row: any) => row.expertLevel || '—') },
        { label: '区域', width: 64, values: q.map((row: any) => row.regionCode || '—') },
        { label: '备注', width: '*', values: q.map((row: any) => row.reason || '—') },
      ];
      // 公司限定恒保留（2026-11-18 用户裁定：公司维度设置须体现，未限定显「不限」）；
      // 其余列（部门/等级/区域/备注）仍按有值收敛
      const present = quotaCols.filter(c =>
        c.label === '专业要求' || c.label === '人数' || c.label === '公司限定' ||
        c.values.some(v => v !== '—' && v !== '不限'));
      return [{
        layout: GRID_COMPACT,
        table: {
          headerRows: 1,
          widths: present.map(c => c.width),
          body: [present.map(c => th(c.label)), ...q.map((_, ri) => present.map(c => td(c.values[ri])))],
        },
        margin: [0, 2, 0, 4],
      }];
    };
    const configLines = (cfg: { body?: any } | null): Array<[string, string]> => {
      if (!cfg) return [];
      const parts: Array<[string, string]> = [['拟抽正选：', `${cfg.body?.totalNeeded ?? '—'} 名`]];
      if ((cfg.body?.alternatives ?? 0) > 0) parts.push(['拟抽候补：', `${cfg.body.alternatives} 名`]);
      if (cfg.body?.employer) parts.push(['整体限定公司：', cfg.body.employer]);
      const excluded = ((cfg.body?.excludedUserIds ?? []) as string[]).map(id => excludedNameById.get(id) ?? id).filter(Boolean);
      if (excluded.length > 0) parts.push(['预排除专家：', excluded.join('、')]);
      return parts;
    };

    const configSection: any[] = [
      { text: '以下为各轮次（初次抽取 / 候补抽取 / 补选）的设置条件。预排除之外，系统自动回避与投标供应商存在关联、跨项目评标窗口冲突的专家。', fontSize: 9, color: '#666666', margin: [0, 0, 0, 6] },
    ];
    if (extractionEvents.length === 0) {
      configSection.push({ text: '未找到抽取确认审计记录（存量项目或未走抽取向导确认步骤），设置条件以系统操作日志为准。', fontSize: 10 });
    }
    for (let i = 0; i < extractionEvents.length; i++) {
      const ev = extractionEvents[i];
      const d = (ev.details ?? {}) as any;
      const mode = MODE_LABELS[d.extractMode] ?? (d.extractMode ? `其他方式（${d.extractMode}）` : '（快照未载明，以名单为准）');
      const drawn = (d.drawnUserIds ?? []) as string[];
      const alts = (d.poolUserIds ?? []) as string[];
      const cfg = roundCfg(i);
      const meta = roundMeta(i, drawn.length, alts.length);
      configSection.push({ text: meta.title, bold: true, fontSize: 10.5, margin: [0, i === 0 ? 2 : 10, 0, 4] });
      const lines: Array<[string, string]> = [
        ['确认时间：', fmt(ev.createdAt)],
        ['确认人：', ev.user?.displayName ?? '工作人员'],
        ['抽取方式：', mode],
        ...(cfg ? configLines(cfg) : []),
      ];
      if (meta.kind === 're' && !cfg) {
        lines.push(['本轮配置：', '未单独留痕，沿用初次配置口径']);
      }
      configSection.push(labeled(lines));
      configSection.push(...quotaTable(cfg));
    }
    // AI 辅助留痕一行（有调用时）
    const aiSpecCount = extractOpLogs.filter(l => l.path === '/api/expert-admin/extract/analyze-project').length;
    const aiLeaderCount = extractOpLogs.filter(l => l.path === '/api/expert-admin/extract/ai-leader').length;
    if (aiSpecCount > 0 || aiLeaderCount > 0) {
      const traces = [
        aiSpecCount > 0 ? `专业配额建议 ${aiSpecCount} 次` : '',
        aiLeaderCount > 0 ? `组长推荐 ${aiLeaderCount} 次` : '',
      ].filter(Boolean).join('、');
      configSection.push({ text: `AI 辅助留痕：${traces}——建议仅供参考，专业配额、专家人选与组长均由工作人员确认后生效。`, fontSize: 9, color: '#666666', margin: [0, 4, 0, 0] });
    }

    /* ── 三、抽取结果与流转：各轮选定人员及当前状态 ── */
    const resultSection: any[] = [
      { text: '各轮人员表中的「当前状态」为导出时刻的最新邀请状态（已确认/已婉拒/待回复/已移出名册）。', fontSize: 9, color: '#666666', margin: [0, 0, 0, 6] },
    ];
    for (let i = 0; i < extractionEvents.length; i++) {
      const ev = extractionEvents[i];
      const d = (ev.details ?? {}) as any;
      const drawn = (d.drawnUserIds ?? []) as string[];
      const alts = (d.poolUserIds ?? []) as string[];
      const drawnNames = (d.experts ?? []).length > 0
        ? (d.experts as any[]).map(e => e.name + (e.isLead ? '（组长）' : ''))
        : drawn.map(id => nameByUserId.get(id) ?? id);
      const altNames = alts.map(id => nameByUserId.get(id) ?? id);
      const meta = roundMeta(i, drawn.length, alts.length);

      if (meta.kind === 'alt') {
        const altRef = activeAlts.length > 0
          ? `实际选定候补 ${altNames.length} 名（${altNames.join('、')}），候补当前状态见「五、候补专家名单」。`
          : `实际选定候补 ${altNames.length} 名（${altNames.join('、')}），均已婉拒或移出，名册无在册候补。`;
        resultSection.push({ text: `${meta.title}：${altRef}`, fontSize: 10, margin: [0, i === 0 ? 2 : 8, 0, 3] });
        continue;
      }
      resultSection.push({
        text: `${meta.title}：确定正选 ${drawnNames.length} 名${drawnNames.length > 0 ? `（${drawnNames.join('、')}）` : ''}${meta.kind === 're' && altNames.length > 0 ? `；候补 ${altNames.length} 名（${altNames.join('、')}）` : ''}。`,
        fontSize: 10, margin: [0, i === 0 ? 2 : 8, 0, 3],
      });
      const roundPeople = [
        ...drawn.map(id => ({ id, role: '正选' })),
        ...alts.map(id => ({ id, role: '候补' })),
      ];
      if (roundPeople.length > 0) {
        resultSection.push({
          layout: GRID_COMPACT,
          table: {
            headerRows: 1,
            widths: ['*', 50, 68, 84, 88],
            body: [
              [th('姓名'), th('本轮角色'), th('当前状态'), th('确认方式'), th('回执时间')],
              ...roundPeople.map(rp => {
                const row = rowByUserId.get(rp.id);
                return [
                  td(nameByUserId.get(rp.id) ?? rp.id, { align: 'left' }),
                  td(rp.role),
                  td(row ? stCn(row.invitationStatus) : '已移出名册'),
                  td(row ? actorCn(confirmOf(row).actor) : '—'),
                  td(row ? fmt(confirmOf(row).time) : '—'),
                ];
              }),
            ],
          },
          margin: [0, 2, 0, 6],
        });
        resultSection.push(...reasonFootnotes(roundPeople.map(rp => rowByUserId.get(rp.id)).filter((r): r is (typeof roster)[number] => !!r)));
      }
    }
    if (extractionEvents.length === 0) {
      resultSection.push({ text: '最终名单以系统当前名册为准（见下两节）。', fontSize: 10 });
    }

    /* ── 四/五、名单表（8 列精简：联系电话移说明查证指引） ── */
    const rosterWidths = [20, 40, 58, 48, '*', 36, 40, 58]; // 固定 300 + 8×8 padding = 364；工作单位星列 ≈151
    const confirmedExperts = confirmedRegulars.filter(r => !r.isPurchaserRepresentative);
    const finalSection: any[] = [
      { text: `四、最终评审专家名单（已确认正选 ${confirmedRegulars.length} 名${purchaserReps.length > 0 ? `，含需求方代表 ${purchaserReps.filter(r => r.invitationStatus === 'confirmed').length} 名` : ''}）`, bold: true, fontSize: 13, margin: [0, 14, 0, 8] },
      ...(confirmedExperts.length === 0 && purchaserReps.length === 0
        ? [{ text: '暂无已确认参加的正选专家（以现场签到与后续补选为准）。', fontSize: 10 }]
        : [
            ...(confirmedExperts.length > 0 ? [{
              layout: GRID_COMPACT,
              table: {
                headerRows: 1,
                widths: rosterWidths,
                body: [
                  ['序号', '姓名', '评审专业', '职称', '工作单位', '角色', '确认方式', '回执时间'].map(h => th(h)),
                  ...confirmedExperts.map((r, i) => [
                    td(String(i + 1)),
                    td(r.expertName, { align: 'left' }),
                    td(r.major),
                    td(r.user?.expertProfile?.title ?? ''),
                    td(r.user?.expertProfile?.employer ?? '', { align: 'left' }),
                    td(r.isLead ? '组长' : '正选'),
                    td(actorShort(confirmOf(r).actor)),
                    td(fmtCell(confirmOf(r).time)),
                  ]),
                ],
              },
            }] : []),
            ...reasonFootnotes(confirmedExperts),
            // 需求方代表完整资料（2026-11-18 用户裁定）：全部在册需求方代表（含待确认），
            // 手动录入的尤其需要完整资料——姓名/单位/部门/职称/联系电话/加入方式/状态/回执
            ...(purchaserReps.length > 0 ? [
              { text: `需求方代表（${purchaserReps.length} 名）`, bold: true, fontSize: 10.5, margin: [0, 10, 0, 4] },
              {
                layout: GRID_COMPACT,
                table: {
                  headerRows: 1,
                  widths: [40, '*', 56, 48, 66, 48, 40, 58], // 固定 356 + 64 padding = 420 ✓
                  body: [
                    ['姓名', '工作单位', '部门', '职称', '联系电话', '加入方式', '当前状态', '回执时间'].map(h => th(h)),
                    ...purchaserReps.map(r => [
                      td(r.expertName, { align: 'left' }),
                      td(r.user?.expertProfile?.employer ?? '', { align: 'left' }),
                      td(r.user?.department?.name ?? ''),
                      td(r.user?.expertProfile?.title ?? ''),
                      td(repPhone(r)),
                      td(repJoinCn(r)),
                      td(stCn(r.invitationStatus)),
                      td(fmtCell(confirmOf(r).time)),
                    ]),
                  ],
                },
              },
              ...reasonFootnotes(purchaserReps),
            ] : []),
          ]),
    ];

    const alternatesSection: any[] = activeAlts.length === 0 ? [] : [
      { text: `五、候补专家名单（${activeAlts.length} 名）`, bold: true, fontSize: 13, margin: [0, 14, 0, 8] },
      {
        layout: GRID_COMPACT,
        table: {
          headerRows: 1,
          widths: rosterWidths,
          body: [
            ['序号', '姓名', '评审专业', '职称', '工作单位', '确认状态', '确认方式', '回执时间'].map(h => th(h)),
            ...activeAlts.map((r, i) => [
              td(String(i + 1)),
              td(r.expertName, { align: 'left' }),
              td(r.major),
              td(r.user?.expertProfile?.title ?? ''),
              td(r.user?.expertProfile?.employer ?? '', { align: 'left' }),
              td(stCn(r.invitationStatus)),
              td(actorShort(confirmOf(r).actor)),
              td(fmtCell(confirmOf(r).time)),
            ]),
          ],
        },
      },
      ...reasonFootnotes(activeAlts),
    ];

    const dd: any = {
      pageSize: 'A4',
      pageMargins: [40, 50, 40, 50],
      defaultStyle: { font: 'NotoSansSC', fontSize: 10.5 },
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: '专家抽取情况证明材料 · 系统自动生成', alignment: 'left', color: '#999999', fontSize: 8 },
          { text: `第 ${currentPage} 页 / 共 ${pageCount} 页`, alignment: 'right', color: '#999999', fontSize: 8 },
        ],
        margin: [50, 24, 50, 0],
      }),
      content: [
        { text: '专家抽取情况说明', style: 'docTitle' },
        { text: '（证明材料 · 系统自动生成）', style: 'docSub' },
        { text: '一、项目基本信息', style: 'h1' },
        infoTable,
        { text: '二、抽取设置条件', style: 'h1' },
        ...configSection,
        { text: '三、抽取结果与流转', style: 'h1' },
        ...resultSection,
        ...finalSection,
        ...alternatesSection,
        { text: '说明', bold: true, fontSize: 10.5, margin: [0, 16, 0, 4] },
        { text: '1. 本材料由蜀水云采·智慧水发系统根据专家抽取审计日志与邀请回执留痕自动生成。', fontSize: 9, color: '#666666' },
        { text: '2. 确认方式包括专家本人回复、工作人员代回应（附理由留痕）与系统超时/递补三类。', fontSize: 9, color: '#666666' },
        { text: '3. 专家历次邀请流转轨迹与联系电话可在系统专家详情页逐条查证。', fontSize: 9, color: '#666666' },
      ],
      styles: {
        docTitle: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
        docSub: { fontSize: 9, alignment: 'center', color: '#666666', margin: [0, 0, 0, 16] },
        h1: { fontSize: 13, bold: true, margin: [0, 14, 0, 8] },
      },
    };

    ensureFonts();
    const buffer = await pdfMake.createPdf(dd).getBuffer();
    const filename = `专家抽取情况_${project.name}_${new Date().toISOString().slice(0, 10)}.pdf`;
    return { buffer, filename };
  }
}
