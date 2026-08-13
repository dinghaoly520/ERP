import { Injectable } from '@nestjs/common';
import {
  Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

export interface OperationTrace {
  identityVerified: { ip: string | null; meta: unknown; at: string | null };
  confidentialityAgreedAt: string | null;
  disciplineAgreedAt: string | null;
  scoreSubmittedAt: string | null; // BidScoreRecordHistory 最早 createdAt
  scoreVerifiedAt: string | null;  // BidScoreReview.verifiedAt
  reportConfirmedAt: string | null;
  leaderCoSignedAt: string | null; // 仅组长行非空
}

export interface SignPacketSnapshot {
  packageType: string;
  packageVersion: number;
  generatedAt: string;
  project: { name: string; projectCode: string; procurementMethod: string; openTime: string | null; deadline: string | null; scope: string | null; qualification: string | null; budget: number | null };
  committee: Array<{ expertId: string; name: string; major: string; role: string; isLead: boolean; isPurchaserRepresentative: boolean; signInIp: string | null; signInMeta: unknown; confidentialityAgreedAt: string | null; disciplineAgreedAt: string | null; reportConfirmedAt: string | null }>;
  leaderCoSignedAt: string | null;
  openingRecords: Array<{ supplierName: string; amount: string; period: string; qualityTarget: string; bondStatus: string; confirmStatus: string }>;
  bids: Array<{ supplierName: string; amount: string; period: string; submittedAt: string | null }>;
  invalidBids: Array<{ supplierName: string; reason: string | null }>;
  scoreStandard: Array<{ category: string; name: string; maxScore: number; points: string[] }>;
  results: Array<{ supplierName: string; totalScore: number; averageScore: number; rank: number; recommended: boolean; disqualified: boolean; bidPrice: number | null }>;
  expertSheets: Array<{
    expertId: string; name: string; major: string; role: string;
    rows: Array<{ supplierName: string; scoreItemName: string; category: string; score: number; passed: boolean | null; reason: string | null }>;
    pointDecisions: Array<{ pointName: string; supplierName: string; checked: boolean; awardedScore: number }>;
    trace: OperationTrace;
  }>;
  disputes: Array<{ expertName: string; type: string; title: string; content: string; status: string; response: string | null; createdAt: string }>;
  clarifications: Array<{ supplierName: string; question: string; reply: string | null; createdAt: string }>;
  motions: Array<{ title: string; description: string | null; status: string; result: string | null; votes: Array<{ expertName: string; vote: string }> }>;
}

const DECLARATION_LINES = [
  '本人作为本项目评标委员会成员声明：',
  '1. 本人在系统中的身份核验、签到、回避申报、保密承诺、评标纪律承诺均为本人操作，无他人代行；',
  '2. 本人对投标人的独立评分、得分点裁定、核对与报告确认均系本人亲为，未受任何单位或个人干预；',
  '3. 本人已如实申报与投标人的利害关系，无应回避而未回避情形；',
  '4. 本人已履行评标保密义务，未向无关人员泄露评标信息；',
  '5. 本人对本人评分及评审意见承担相应责任；',
  '6. 对评标结论的不同意见以本人签字栏备注或另附书面材料为准。',
];

const TRACE_LABELS: Array<[keyof OperationTrace, string]> = [
  ['identityVerified', '身份核验/签到'],
  ['confidentialityAgreedAt', '保密承诺签署'],
  ['disciplineAgreedAt', '评标纪律确认'],
  ['scoreSubmittedAt', '评分提交'],
  ['scoreVerifiedAt', '评分核对'],
  ['reportConfirmedAt', '报告确认'],
  ['leaderCoSignedAt', '组长末签'],
];

@Injectable()
export class BidSignPacketDocxService {
  private h1(text: string): Paragraph {
    return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, bold: true, size: 32 })] });
  }
  private h2(text: string): Paragraph {
    return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true, size: 26 })] });
  }
  private para(text: string): Paragraph {
    return new Paragraph({ children: [new TextRun({ text, size: 21 })] });
  }
  private kvTable(rows: Array<[string, string]>): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(([k, v]) => new TableRow({
        children: [
          new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [this.para(k)] }),
          new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, children: [this.para(v)] }),
        ],
      })),
    });
  }
  private headerRow(cells: string[]): TableRow {
    return new TableRow({ children: cells.map(c => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c, bold: true, size: 21 })] })] })) });
  }
  private traceTable(trace: OperationTrace): Table {
    const rows = TRACE_LABELS.map(([key, label]) => {
      let value = '—';
      if (key === 'identityVerified') {
        const iv = trace.identityVerified;
        value = iv.at ? `${label}：${iv.at}（IP ${iv.ip ?? '未知'}）` : '—';
        return new TableRow({ children: [new TableCell({ children: [this.para(value)] })] });
      }
      const v = trace[key] as string | null;
      return new TableRow({ children: [new TableCell({ children: [this.para(`${label}：${v ?? '—'}`)] })] });
    });
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [this.headerRow(['在线操作留痕（系统记录）']), ...rows] });
  }

  /** 主报告：《暂行规定》第四十二条十项内容 */
  private buildMainReport(s: SignPacketSnapshot): (Paragraph | Table)[] {
    const p = s.project;
    const out: (Paragraph | Table)[] = [
      this.h1('评标报告'),
      this.h2('一、基本情况和数据表'),
      this.kvTable([
        ['项目名称', p.name], ['项目编号', p.projectCode], ['采购方式', p.procurementMethod],
        ['开标时间', p.openTime ?? '—'], ['投标截止时间', p.deadline ?? '—'],
        ['项目范围', p.scope ?? '—'], ['资质要求', p.qualification ?? '—'], ['预算金额', p.budget != null ? `¥${p.budget}` : '—'],
      ]),
      this.h2('二、评标委员会成员名单'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['姓名', '专业', '角色', '组长', '采购人代表']),
          ...s.committee.map(e => new TableRow({
            children: [
              new TableCell({ children: [this.para(e.name)] }),
              new TableCell({ children: [this.para(e.major)] }),
              new TableCell({ children: [this.para(e.role)] }),
              new TableCell({ children: [this.para(e.isLead ? '是' : '—')] }),
              new TableCell({ children: [this.para(e.isPurchaserRepresentative ? '是' : '—')] }),
            ],
          })),
        ],
      }),
      this.h2('三、开标记录'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['供应商', '投标报价', '工期', '质量目标', '保证金', '开标确认']),
          ...s.openingRecords.map(r => new TableRow({
            children: [r.supplierName, r.amount, r.period, r.qualityTarget, r.bondStatus, r.confirmStatus].map(v => new TableCell({ children: [this.para(v)] })),
          })),
        ],
      }),
      this.h2('四、投标一览表'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['供应商', '投标报价', '工期', '提交时间']),
          ...s.bids.map(b => new TableRow({
            children: [b.supplierName, b.amount, b.period, b.submittedAt ?? '—'].map(v => new TableCell({ children: [this.para(v)] })),
          })),
        ],
      }),
      this.h2('五、废标情况说明'),
      ...(s.invalidBids.length
        ? [new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [this.headerRow(['供应商', '原因']), ...s.invalidBids.map(b => new TableRow({ children: [b.supplierName, b.reason ?? '—'].map(v => new TableCell({ children: [this.para(v)] })) }))],
          })]
        : [this.para('无。')]),
      this.h2('六、评标标准、评标方法一览表'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['类别', '评分项', '满分', '得分点']),
          ...s.scoreStandard.map(it => new TableRow({
            children: [it.category, it.name, String(it.maxScore), it.points.join('；')].map(v => new TableCell({ children: [this.para(v)] })),
          })),
        ],
      }),
      this.h2('七、经评审的价格或评分比较一览表'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['排名', '供应商', '总分', '平均分', '报价', '推荐']),
          ...s.results.map(r => new TableRow({
            children: [String(r.rank), r.supplierName, String(r.totalScore), String(r.averageScore), r.bidPrice != null ? `¥${r.bidPrice}` : '—', r.recommended ? '推荐中标候选人' : '—'].map(v => new TableCell({ children: [this.para(v)] })),
          })),
        ],
      }),
      this.h2('八、排序结果与推荐中标候选人名单'),
      ...s.results.filter(r => r.recommended && !r.disqualified).map(r => this.para(`第 ${r.rank} 名：${r.supplierName}（总分 ${r.totalScore}）`)),
      ...(s.results.filter(r => r.recommended).length === 0 ? [this.para('无。')] : []),
      this.h2('九、澄清、说明、补正事项纪要'),
      ...(s.clarifications.length
        ? s.clarifications.map(c => this.para(`${c.supplierName} 问：${c.question}\n答：${c.reply ?? '（待回复）'}`))
        : [this.para('无。')]),
      this.h2('十、评标过程其他说明'),
      this.para('本报告由系统根据评标过程数据自动生成；全体评标委员会成员在本报告签字页签字后生效。组长末签：' + (s.leaderCoSignedAt ?? '—')),
    ];
    return out;
  }

  /** 签字页：专家声明 + 全员签字栏（每专家栏含在线操作留痕小表） */
  private buildSignaturePage(s: SignPacketSnapshot): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [
      new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: '签字页', bold: true, size: 32 })] }),
      this.h2('评标专家声明'),
      ...DECLARATION_LINES.map(l => this.para(l)),
      this.h2('专家签字栏'),
    ];
    for (const e of s.committee) {
      const sheet = s.expertSheets.find(x => x.expertId === e.expertId);
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['姓名', '职称/专业', '工作单位', '签字', '日期']),
          new TableRow({ children: [e.name, e.major, '（见专家库）', '　　　　　　', '　　年　月　日'].map(v => new TableCell({ children: [this.para(v)] })) }),
          new TableRow({ children: [new TableCell({ columnSpan: 5, children: [this.traceTable(sheet?.trace ?? ({} as OperationTrace))] })] }),
        ],
      }));
      out.push(this.para(''));
    }
    return out;
  }

  /** 个人评分确认表（每正选专家一张）：逐供应商逐项分数 + 得分点 + 留痕 + 签字栏 */
  private buildExpertSheets(s: SignPacketSnapshot): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [];
    for (const sheet of s.expertSheets) {
      out.push(new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: `个人评分确认表 — ${sheet.name}（${sheet.role}）`, bold: true, size: 28 })] }));
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['供应商', '评分项', '类别', '得分', '通过', '备注']),
          ...sheet.rows.map(r => new TableRow({
            children: [r.supplierName, r.scoreItemName, r.category, String(r.score), r.passed == null ? '—' : r.passed ? '通过' : '不通过', r.reason ?? ''].map(v => new TableCell({ children: [this.para(v)] })),
          })),
        ],
      }));
      out.push(this.h2('得分点裁定'));
      out.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          this.headerRow(['得分点', '供应商', '裁定', '得分']),
          ...sheet.pointDecisions.map(d => new TableRow({
            children: [d.pointName, d.supplierName, d.checked ? '符合' : '不符合', String(d.awardedScore)].map(v => new TableCell({ children: [this.para(v)] })),
          })),
        ],
      }));
      out.push(this.traceTable(sheet.trace));
      out.push(this.para('本人确认：以上分数、得分点裁定及在线操作留痕均为本人亲为，与系统记录一致。'));
      out.push(this.kvTable([['签字', ''], ['日期', '　　年　月　日']]));
    }
    return out;
  }

  private buildDisputesAndMotions(s: SignPacketSnapshot): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [
      new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: '附：异议工单、澄清纪要、动议决议', bold: true, size: 28 })] }),
      this.h2('异议工单'),
      ...(s.disputes.length
        ? s.disputes.map(d => this.para(`[${d.status}] ${d.expertName}：${d.title} — ${d.content}${d.response ? `\n裁决：${d.response}` : ''}`))
        : [this.para('无。')]),
      this.h2('澄清纪要'),
      ...(s.clarifications.length
        ? s.clarifications.map(c => this.para(`${c.createdAt} ${c.supplierName} 问：${c.question}${c.reply ? `\n答：${c.reply}` : '（待回复）'}`))
        : [this.para('无。')]),
      this.h2('动议决议'),
      ...(s.motions.length
        ? s.motions.map(m => this.para(`[${m.status}/${m.result ?? '未决'}] ${m.title}${m.description ? ` — ${m.description}` : ''}；表决：${m.votes.map(v => `${v.expertName}=${v.vote}`).join('，') || '无'}`))
        : [this.para('无。')]),
    ];
    return out;
  }

  /** 组装全部子块（公开以便测试直接断言内容；generateDocument 内部消费） */
  buildChildren(s: SignPacketSnapshot): (Paragraph | Table)[] {
    return [
      ...this.buildMainReport(s),
      ...this.buildSignaturePage(s),
      ...this.buildExpertSheets(s),
      ...this.buildDisputesAndMotions(s),
    ];
  }

  /** 快照 → docx Buffer */
  async generateDocument(s: SignPacketSnapshot): Promise<Buffer> {
    const doc = new Document({
      sections: [{ properties: {}, children: this.buildChildren(s) }],
      styles: { default: { document: { run: { font: 'SimSun', size: 21 } } } },
    });
    return Packer.toBuffer(doc);
  }
}
