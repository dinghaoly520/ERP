// apps/api/src/ai-bid-analysis/services/docx-generator.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { AiBidReport } from '@prisma/client';

@Injectable()
export class DocxGeneratorService {
  private readonly logger = new Logger(DocxGeneratorService.name);

  private neutralizeRecommendationText(text?: string | null) {
    if (!text) return text;

    return text
      .replace(
        /建议推荐为第?一?中标候选人[，。]?/g,
        '当前结果仅作为评分分析参考，候选排序需以人工评审结果为准。',
      )
      .replace(
        /建议推荐为中标候选人[，。]?/g,
        '当前结果仅作为评分分析参考，是否进入候选排序需以人工评审结果为准。',
      )
      .replace(
        /推荐为第?一?中标候选人[，。]?/g,
        '候选排序需以人工评审结果为准。',
      )
      .replace(
        /推荐为中标候选人[，。]?/g,
        '是否进入候选排序需以人工评审结果为准。',
      )
      .replace(/第一中标候选人/g, '当前综合评分排序第 1')
      .replace(/中标候选人/g, '候选排序对象')
      .replace(/履约能力强/g, '履约能力相关材料需结合投标文件复核')
      .replace(/履约风险低/g, '当前未识别到结构化高风险因素');
  }

  async generate(report: AiBidReport): Promise<Buffer> {
    this.logger.log('Generating DOCX report...');

    const children: Array<Paragraph | Table> = [];

    // 标题
    children.push(
      new Paragraph({
        text: '投标文件分析报告',
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
      }),
    );
    children.push(new Paragraph({ text: '' }));

    // 一、分析概述
    children.push(
      new Paragraph({ text: '一、分析概述', heading: HeadingLevel.HEADING_1 }),
    );
    if (report.summary) {
      const s = report.summary as any;
      children.push(new Paragraph({ text: `任务名称：${s.taskName || '-'}` }));
      children.push(
        new Paragraph({ text: `项目名称：${s.projectName || '-'}` }),
      );
      children.push(
        new Paragraph({ text: `投标单位数量：${s.totalBidders || 0} 家` }),
      );
      children.push(
        new Paragraph({ text: `完成分析数量：${s.completedBidders || 0} 家` }),
      );
      children.push(
        new Paragraph({
          text: `分析日期：${s.analysisDate ? new Date(s.analysisDate).toLocaleDateString('zh-CN') : '-'}`,
        }),
      );
      children.push(
        new Paragraph({ text: `评分方法：${s.scoringMethod || '-'}` }),
      );
    }
    children.push(new Paragraph({ text: '' }));

    // 二、评分排名
    children.push(
      new Paragraph({
        text: '二、评分排名汇总',
        heading: HeadingLevel.HEADING_1,
      }),
    );
    if (report.ranking && (report.ranking as any[]).length > 0) {
      children.push(this.createRankingTable(report.ranking as any[]));
    } else {
      children.push(new Paragraph({ text: '暂无评分数据' }));
    }
    children.push(new Paragraph({ text: '' }));

    // 三、逐项评分明细（方案4：per-item reason/strengths/weaknesses/priceAnalysis）
    children.push(
      new Paragraph({
        text: '三、逐项评分明细',
        heading: HeadingLevel.HEADING_1,
      }),
    );
    if (report.scoreItemsDetail && (report.scoreItemsDetail as any[]).length > 0) {
      for (const bidder of report.scoreItemsDetail as any[]) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${bidder.bidderName}（总分 ${bidder.totalScore ?? '-'}）`,
                bold: true,
              }),
            ],
            heading: HeadingLevel.HEADING_2,
          }),
        );
        // ★号实质性条款响应核查（方案1收尾）
        if (bidder.starredResponse) {
          const sr = bidder.starredResponse as { allMet?: boolean; unmet?: string[] };
          if (sr.allMet) {
            children.push(new Paragraph({ text: '★ 实质性条款：全部响应满足' }));
          } else if (sr.unmet && sr.unmet.length > 0) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `★ 实质性条款未完全响应（${sr.unmet.length} 项未满足）：`,
                    bold: true,
                  }),
                ],
              }),
            );
            for (const u of sr.unmet) {
              children.push(new Paragraph({ text: `  ✗ ${u}` }));
            }
          }
        }
        for (const group of bidder.categoryGroups ?? []) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${group.categoryName}（${group.score ?? 0}/${group.maxScore ?? 0}）`,
                  bold: true,
                }),
              ],
            }),
          );
          for (const item of group.items ?? []) {
            const passTag =
              item.pass === true ? '【通过】' : item.pass === false ? '【不通过】' : '';
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${passTag}${item.name}：${item.score ?? 0}/${item.maxScore ?? 0}`,
                    bold: true,
                  }),
                ],
              }),
            );
            if (item.reason) {
              children.push(
                new Paragraph({
                  text: `  理由：${this.neutralizeRecommendationText(item.reason)}`,
                }),
              );
            }
            if (item.evidence) {
              children.push(new Paragraph({ text: `  证据：${item.evidence}` }));
            }
            // PRICE 项价格分析摘要（方案2）
            if (item.priceAnalysis) {
              const pa = item.priceAnalysis;
              if (pa.strategyAssessment?.type) {
                children.push(
                  new Paragraph({
                    text: `  报价策略：${pa.strategyAssessment.type}（置信度 ${Math.round(
                      (pa.strategyAssessment.confidence ?? 0) * 100,
                    )}%）`,
                  }),
                );
              }
              if (pa.deviation) {
                children.push(new Paragraph({ text: `  偏离度：${pa.deviation}` }));
              }
              if (pa.riskWarning) {
                children.push(new Paragraph({ text: `  价格风险：${pa.riskWarning}` }));
              }
            }
            for (const s of item.strengths ?? []) {
              children.push(
                new Paragraph({ text: `  ✓ ${this.neutralizeRecommendationText(s)}` }),
              );
            }
            for (const w of item.weaknesses ?? []) {
              children.push(
                new Paragraph({ text: `  ✗ ${this.neutralizeRecommendationText(w)}` }),
              );
            }
          }
        }
        children.push(new Paragraph({ text: '' }));
      }
    } else {
      children.push(new Paragraph({ text: '暂无逐项评分明细' }));
    }
    children.push(new Paragraph({ text: '' }));

    // 四、关键信息对比
    children.push(
      new Paragraph({
        text: '四、关键信息对比',
        heading: HeadingLevel.HEADING_1,
      }),
    );
    if (
      report.keyInfoComparison &&
      (report.keyInfoComparison as any[]).length > 0
    ) {
      const keyInfo = report.keyInfoComparison as any[];
      children.push(this.createKeyInfoTable(keyInfo));
      children.push(...this.createKeyInfoRemarks(keyInfo));
    } else {
      children.push(new Paragraph({ text: '暂无关键信息数据' }));
    }
    children.push(new Paragraph({ text: '' }));

    // 四、报价分析
    children.push(
      new Paragraph({ text: '五、报价分析', heading: HeadingLevel.HEADING_1 }),
    );
    if (report.priceAnalysis) {
      const p = report.priceAnalysis as any;
      children.push(
        new Paragraph({
          text: `最低报价：${p.lowest?.bidderName || '-'} - ${p.lowest?.price || '-'} 万元`,
        }),
      );
      children.push(
        new Paragraph({
          text: `最高报价：${p.highest?.bidderName || '-'} - ${p.highest?.price || '-'} 万元`,
        }),
      );
      children.push(
        new Paragraph({ text: `平均报价：${p.average || '-'} 万元` }),
      );
      children.push(
        new Paragraph({ text: `报价离散度：${p.dispersionRate || '-'}%` }),
      );
    } else {
      children.push(new Paragraph({ text: '暂无报价数据' }));
    }
    children.push(new Paragraph({ text: '' }));

    // 五、正向依据与需关注事项
    children.push(
      new Paragraph({
        text: '六、正向依据与需关注事项',
        heading: HeadingLevel.HEADING_1,
      }),
    );
    if (
      report.strengthsWeaknesses &&
      (report.strengthsWeaknesses as any[]).length > 0
    ) {
      for (const sw of report.strengthsWeaknesses as any[]) {
        children.push(
          new Paragraph({
            text: `${sw.bidderName}`,
            heading: HeadingLevel.HEADING_2,
          }),
        );

        if (sw.competitiveAnalysis) {
          const ca = sw.competitiveAnalysis;
          if (ca.strengths?.length > 0) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: '正向依据：', bold: true })],
              }),
            );
            for (const s of ca.strengths) {
              children.push(
                new Paragraph({ text: `  ✓ ${this.neutralizeRecommendationText(s.title)}：${this.neutralizeRecommendationText(s.detail)}` }),
              );
              if (s.impact) {
                children.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `    影响：${this.neutralizeRecommendationText(s.impact)}`,
                        italics: true,
                      }),
                    ],
                  }),
                );
              }
            }
          }
          if (ca.weaknesses?.length > 0) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: '需关注项：', bold: true })],
              }),
            );
            for (const w of ca.weaknesses) {
              children.push(
                new Paragraph({ text: `  ✗ ${this.neutralizeRecommendationText(w.title)}：${this.neutralizeRecommendationText(w.detail)}` }),
              );
              if (w.impact) {
                children.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `    影响：${this.neutralizeRecommendationText(w.impact)}`,
                        italics: true,
                      }),
                    ],
                  }),
                );
              }
            }
          }
          if (ca.keyObservations?.length > 0) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: '关键观察：', bold: true })],
              }),
            );
            for (const obs of ca.keyObservations) {
              children.push(new Paragraph({ text: `  • ${this.neutralizeRecommendationText(obs)}` }));
            }
          }
          if (ca.overallComment) {
            children.push(
              new Paragraph({
                text: `综合说明：${this.neutralizeRecommendationText(ca.overallComment)}`,
              }),
            );
          }
        } else {
          if (sw.strengths?.length > 0) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: '正向依据：', bold: true })],
              }),
            );
            for (const s of sw.strengths) {
              children.push(new Paragraph({ text: `  ✓ ${this.neutralizeRecommendationText(s)}` }));
            }
          }
          if (sw.weaknesses?.length > 0) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: '需关注项：', bold: true })],
              }),
            );
            for (const w of sw.weaknesses) {
              children.push(new Paragraph({ text: `  ✗ ${this.neutralizeRecommendationText(w)}` }));
            }
          }
          if (sw.overallComment) {
            children.push(
              new Paragraph({
                text: `综合说明：${this.neutralizeRecommendationText(sw.overallComment)}`,
              }),
            );
          }
        }
        children.push(new Paragraph({ text: '' }));
      }
    } else {
      children.push(new Paragraph({ text: '暂无正向依据与需关注事项数据' }));
    }
    children.push(new Paragraph({ text: '' }));

    // 六、风险提示
    children.push(
      new Paragraph({
        text: '七、风险提示与建议',
        heading: HeadingLevel.HEADING_1,
      }),
    );
    if (report.riskStats) {
      const r = report.riskStats as any;
      children.push(
        new Paragraph({
          text: `投标单位风险统计：低风险 ${r.lowCount || 0} 家，中风险 ${r.mediumCount || 0} 家，高风险 ${r.highCount || 0} 家`,
        }),
      );
      children.push(
        new Paragraph({
          text: `串通投标风险等级：${r.fraudRiskLevel === 'high' ? '高风险' : r.fraudRiskLevel === 'medium' ? '中风险' : '低风险'}`,
        }),
      );

      if (report.fraudIndicators) {
        const fi = report.fraudIndicators as any;
        if (fi.indicators && fi.indicators.length > 0) {
          children.push(new Paragraph({ text: '风险指标详情：' }));
          for (const indicator of fi.indicators) {
            children.push(
              new Paragraph({ text: `• ${indicator.description}` }),
            );
            if (indicator.ruleCode) {
              children.push(
                new Paragraph({
                  text: `  规则编码：${indicator.ruleCode}，置信度：${Math.round((indicator.confidence || 0) * 100)}%`,
                }),
              );
            }
            if (indicator.evidenceItems && indicator.evidenceItems.length > 0) {
              for (const evidence of indicator.evidenceItems) {
                children.push(
                  new Paragraph({
                    text: `  证据：${evidence.label} = ${evidence.value}；涉及单位：${(evidence.bidders || []).join('、')}；说明：${evidence.explanation}`,
                  }),
                );
              }
            } else if (indicator.evidence) {
              children.push(
                new Paragraph({ text: `  证据：${indicator.evidence}` }),
              );
            }
            if (indicator.recommendation) {
              children.push(
                new Paragraph({
                  text: `  复核建议：${indicator.recommendation}`,
                }),
              );
            }
          }
        }
      }
    }
    children.push(new Paragraph({ text: '' }));

    // 七、综合结论
    children.push(
      new Paragraph({ text: '八、综合结论', heading: HeadingLevel.HEADING_1 }),
    );
    children.push(new Paragraph({ text: report.conclusion || '暂无结论' }));

    const doc = new Document({
      numbering: {
        config: [
          {
            reference: 'remarks-numbering',
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 480, hanging: 360 } } },
              },
            ],
          },
        ],
      },
      styles: {
        default: {
          document: {
            run: { font: '宋体', size: 21 },
            paragraph: { spacing: { after: 120, line: 360 } },
          },
        },
        paragraphStyles: [
          {
            id: 'Normal',
            name: 'Normal',
            run: { font: '宋体', size: 21 },
            paragraph: { spacing: { after: 120, line: 360, lineRule: 'auto' } },
          },
          {
            id: 'Title',
            name: 'Title',
            basedOn: 'Normal',
            next: 'Normal',
            run: { font: '黑体', size: 36, bold: true },
            paragraph: {
              alignment: AlignmentType.CENTER,
              spacing: { after: 360 },
            },
          },
          {
            id: 'Heading1',
            name: 'Heading 1',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { font: '黑体', size: 28, bold: true },
            paragraph: { spacing: { before: 360, after: 180 } },
          },
          {
            id: 'Heading2',
            name: 'Heading 2',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { font: '黑体', size: 24, bold: true },
            paragraph: { spacing: { before: 240, after: 120 } },
          },
        ],
      },
      sections: [
        {
          properties: {
            type: SectionType.CONTINUOUS,
            page: {
              margin: { top: 1134, right: 900, bottom: 1134, left: 900 },
            },
          },
          children,
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  private createRankingTable(ranking: any[]): Table {
    const rows = [
      this.createTableRow(
        ['排名', '投标单位', '总分', '技术分', '商务分', '报价分'],
        true,
      ),
      ...ranking.map((r) =>
        this.createTableRow([
          this.formatValue(r.rank),
          this.formatValue(r.bidderName),
          this.formatScore(r.totalScore, 2),
          this.formatScore(r.technicalScore, 1),
          this.formatScore(r.commercialScore, 1),
          this.formatScore(r.priceScore, 1),
        ]),
      ),
    ];

    return this.createTable(rows, [9, 31, 15, 15, 15, 15]);
  }

  private createKeyInfoTable(keyInfo: any[]): Table {
    const rows = [
      this.createTableRow(
        [
          '投标单位',
          '报价(万元)',
          '法人',
          '资质等级',
          '业绩数',
          '项目经理',
          '工期',
          '质保期',
        ],
        true,
      ),
      ...keyInfo.map((k) =>
        this.createTableRow([
          this.formatValue(k.bidderName),
          this.formatAmount(k.quotePrice),
          this.formatValue(k.legalPerson),
          this.formatValue(k.qualificationLevel || k.qualificationName),
          this.formatValue(k.performanceCount ?? 0),
          this.formatValue(k.projectManager),
          this.formatValue(k.constructionPeriod),
          this.formatValue(k.warrantyPeriod),
        ]),
      ),
    ];

    return this.createTable(rows, [18, 13, 11, 15, 9, 12, 11, 11]);
  }

  private createKeyInfoRemarks(keyInfo: any[]): Paragraph[] {
    const remarks: Paragraph[] = [
      new Paragraph({
        children: [new TextRun({ text: '关键字段备注', bold: true })],
        spacing: { before: 180, after: 80 },
      }),
    ];

    const prices = keyInfo
      .map((k) => ({
        bidderName: this.formatValue(k.bidderName),
        price: this.toNumber(k.quotePrice),
      }))
      .filter((k) => k.price !== null) as Array<{
      bidderName: string;
      price: number;
    }>;

    if (prices.length > 0) {
      const lowest = prices.reduce(
        (min, item) => (item.price < min.price ? item : min),
        prices[0],
      );
      const highest = prices.reduce(
        (max, item) => (item.price > max.price ? item : max),
        prices[0],
      );
      remarks.push(
        this.createRemark(
          `最低报价：${lowest.bidderName}（${this.formatAmount(lowest.price)} 万元）`,
        ),
      );
      if (
        highest.bidderName !== lowest.bidderName ||
        highest.price !== lowest.price
      ) {
        remarks.push(
          this.createRemark(
            `最高报价：${highest.bidderName}（${this.formatAmount(highest.price)} 万元）`,
          ),
        );
      }
    }

    for (const item of keyInfo) {
      const missing = [
        ['legalPerson', '法人'],
        ['qualificationLevel', '资质等级'],
        ['projectManager', '项目经理'],
        ['constructionPeriod', '工期'],
        ['warrantyPeriod', '质保期'],
      ]
        .filter(([field]) => !this.hasValue(item[field]))
        .map(([, label]) => `${label}未提取`);

      if (missing.length > 0) {
        remarks.push(
          this.createRemark(
            `${this.formatValue(item.bidderName)}：${missing.join('；')}`,
          ),
        );
      }
    }

    if (remarks.length === 1) {
      remarks.push(this.createRemark('各投标单位关键字段均已提取。'));
    }

    return remarks;
  }

  private createTable(rows: TableRow[], columnWidths: number[]): Table {
    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'A6A6A6' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'A6A6A6' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'A6A6A6' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'A6A6A6' },
        insideHorizontal: {
          style: BorderStyle.SINGLE,
          size: 1,
          color: 'D9D9D9',
        },
        insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'D9D9D9' },
      },
      columnWidths: columnWidths.map((width) => width * 100),
    });
  }

  private createTableRow(values: string[], isHeader = false): TableRow {
    return new TableRow({
      tableHeader: isHeader,
      children: values.map((value) => this.createCell(value, isHeader)),
    });
  }

  private createCell(text: string, isHeader = false): TableCell {
    return new TableCell({
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: isHeader })],
          alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: 60, after: 60 },
        }),
      ],
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      verticalAlign: VerticalAlign.CENTER,
      shading: isHeader
        ? { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' }
        : undefined,
    });
  }

  private createRemark(text: string): Paragraph {
    return new Paragraph({
      children: [new TextRun({ text })],
      numbering: { reference: 'remarks-numbering', level: 0 },
      spacing: { after: 80 },
    });
  }

  private formatAmount(value: unknown): string {
    const numberValue = this.toNumber(value);
    return numberValue === null ? '-' : numberValue.toFixed(2);
  }

  private formatScore(value: unknown, digits: number): string {
    const numberValue = this.toNumber(value);
    return numberValue === null ? '-' : numberValue.toFixed(digits);
  }

  private formatValue(value: unknown): string {
    if (!this.hasValue(value)) return '-';
    return String(value);
  }

  private hasValue(value: unknown): boolean {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  private toNumber(value: unknown): number | null {
    if (!this.hasValue(value)) return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
}
