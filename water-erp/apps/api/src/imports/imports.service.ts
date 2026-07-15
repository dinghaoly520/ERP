import { Injectable, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import * as XLSX from 'xlsx';
import { ResultStatus, SourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type ParsedRow = {
  procurementDate: Date | null;
  projectName: string;
  procurementMethod: string;
  departmentName: string | null;
  supplierNames: string[];
  budgetAmount: number | null;
  controlAmount: number | null;
  awardedSupplierName: string | null;
  awardAmount: number | null;
  resultStatus: ResultStatus;
  resultText: string | null;
};

function normalizeName(value: string) {
  return value.replace(/\s+/g, '').trim();
}

function normalizeProjectCode(name: string) {
  return `EXCEL-${createHash('sha1').update(name).digest('hex').slice(0, 12)}`;
}

function parseAmount(value: unknown) {
  if (value == null) {
    return null;
  }

  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned) {
    return null;
  }

  const next = Number.parseFloat(cleaned);
  return Number.isFinite(next) ? next : null;
}

function parseExcelDate(rawDate: unknown, rawTime: unknown) {
  if (!rawDate) {
    return null;
  }

  const dateText = String(rawDate)
    .replace(/（.*?）/g, '')
    .trim();
  const match = dateText.match(
    /^(?<year>\d{4})[./-](?<month>\d{1,2})[./-](?<day>\d{1,2})$/,
  );

  if (!match?.groups) {
    return null;
  }

  const timeValue = rawTime == null ? '' : String(rawTime).trim();

  let hours = 0;
  let minutes = 0;
  if (/^\d{1,2}:\d{2}$/.test(timeValue)) {
    const [nextHours, nextMinutes] = timeValue.split(':').map(Number);
    hours = nextHours || 0;
    minutes = nextMinutes || 0;
  } else {
    const excelTime = Number.parseFloat(timeValue);
    if (Number.isFinite(excelTime)) {
      const totalMinutes = Math.round(excelTime * 24 * 60);
      hours = Math.floor(totalMinutes / 60) % 24;
      minutes = totalMinutes % 60;
    }
  }

  const parsed = new Date(
    Number(match.groups.year),
    Number(match.groups.month) - 1,
    Number(match.groups.day),
    hours,
    minutes,
    0,
    0,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function splitSuppliers(input: string | null) {
  if (!input) {
    return [];
  }

  const cleaned = input
    .replace(/\r/g, '\n')
    .replace(/[；;]+/g, '\n')
    .replace(/\s{2,}/g, '\n')
    .split('\n')
    .map((item) =>
      item
        .replace(/^标\d+[:：]*/, '')
        .replace(/^[（(]?\d+[)）.、]\s*/, '')
        .replace(/^\d+[.、]\s*/, '')
        .replace(/^[-–—]\s*/, '')
        .trim(),
    )
    .filter(Boolean)
    .filter((item) => !/^XDZK|^LXZK|^SPDZK/.test(item));

  return [...new Set(cleaned)];
}

function inferResultStatus(
  resultCell: unknown,
  awardedSupplierName: string | null,
) {
  const text = resultCell == null ? '' : String(resultCell).trim();
  const amount = parseAmount(resultCell);

  if (awardedSupplierName && amount != null) {
    return {
      resultStatus: ResultStatus.AWARDED,
      awardAmount: amount,
      resultText: '已成交',
    };
  }

  if (text.includes('资格审查未通过')) {
    return {
      resultStatus: ResultStatus.FAILED_REVIEW,
      awardAmount: null,
      resultText: '资格审查未通过',
    };
  }

  if (text.includes('修改') || text.includes('文件')) {
    return {
      resultStatus: ResultStatus.FILE_REVISION_REQUIRED,
      awardAmount: null,
      resultText: text || '采购文件需调整',
    };
  }

  // 包含"响应"、"胶封"、"按要求"等关键词 → 未按要求响应
  if (
    text.includes('响应') ||
    text.includes('胶封') ||
    text.includes('按要求') ||
    text.includes('未按')
  ) {
    return {
      resultStatus: ResultStatus.INVALID_RESPONSE,
      awardAmount: null,
      resultText: text || '供应商未按要求响应',
    };
  }

  // 只有"取消"相关关键词才标记为取消
  if (text.includes('取消') || text.includes('撤回') || text.includes('终止')) {
    return {
      resultStatus: ResultStatus.CANCELLED,
      awardAmount: null,
      resultText: text,
    };
  }

  // 其他非空文本归类为 INVALID_RESPONSE（异常情况），保留原文作为原因
  if (text) {
    return {
      resultStatus: ResultStatus.INVALID_RESPONSE,
      awardAmount: null,
      resultText: text,
    };
  }

  return {
    resultStatus: ResultStatus.PENDING,
    awardAmount: null,
    resultText: '待进一步处理',
  };
}

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async importWorkbookFromDefaultFile() {
    const workbookPath = resolve(process.cwd(), '..', '..', '采购汇总表.xlsx');
    return this.importWorkbook(workbookPath);
  }

  async importWorkbookFromPath(workbookPath: string) {
    // 路径穿越防护：仅允许读取 sanctioned 导入目录内的文件。
    // 原 resolve(cwd, filePath) 可被 procurement_staff 指向任意服务器文件
    // （/etc/shadow、apps/api/.env 含 JWT_SECRET/KMS_SECRET/DEEPSEEK_API_KEY 等）。
    // 基目录由 IMPORT_DIR 配置（默认 <cwd>/imports）；绝对路径与 ../ 一律被拒。
    const baseDir = resolve(process.cwd(), process.env.IMPORT_DIR ?? 'imports');
    const absolutePath = resolve(baseDir, workbookPath);
    if (absolutePath !== baseDir && !absolutePath.startsWith(baseDir + sep)) {
      throw new BadRequestException({ error: '文件路径越界，仅允许读取导入目录内文件', code: 'PATH_TRAVERSAL' });
    }
    return this.importWorkbook(absolutePath);
  }

  private async importWorkbook(workbookPath: string) {
    if (!existsSync(workbookPath)) {
      throw new Error(`Workbook not found: ${workbookPath}`);
    }

    const workbook = XLSX.readFile(workbookPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Try to detect the format by checking the first row headers
    const sampleRows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
      range: 0,
    });

    const headerRow = sampleRows[0] || [];
    const hasNewFormat = headerRow.some(
      (cell) => cell === '开标日期' || cell === '项目名称',
    );

    let parsedRows: ParsedRow[];
    let dataRowCount: number;

    if (hasNewFormat) {
      // New format: JSON-style with headers
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false,
      });
      dataRowCount = jsonRows.length;
      parsedRows = this.parseNewFormatRows(jsonRows);
    } else {
      // Old format: array-style without headers
      const rows = XLSX.utils.sheet_to_json<(string | null)[]>(sheet, {
        header: 1,
        defval: null,
        raw: false,
      });
      dataRowCount = rows.length - 1; // Subtract header row
      parsedRows = this.parseOldFormatRows(rows);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.roundParticipant.deleteMany({
        where: {
          procurementRound: {
            sourceType: SourceType.EXCEL_IMPORT,
          },
        },
      });

      await tx.procurementRound.deleteMany({
        where: {
          sourceType: SourceType.EXCEL_IMPORT,
        },
      });

      await tx.importBatch.deleteMany();

      const importBatch = await tx.importBatch.create({
        data: {
          fileName: workbookPath.split('/').pop() || 'unknown.xlsx',
          sourceMonth: '2026-04',
          rowCount: dataRowCount,
        },
      });

      const projectRoundCounter = new Map<string, number>();

      for (const row of parsedRows) {
        let departmentId: string | null = null;
        if (row.departmentName) {
          const department = await tx.department.upsert({
            where: { name: row.departmentName },
            update: {},
            create: { name: row.departmentName },
          });
          departmentId = department.id;
        }

        const projectCode = normalizeProjectCode(row.projectName);
        const project = await tx.project.upsert({
          where: { projectCode },
          update: {
            name: row.projectName,
            requestingDepartmentId: departmentId,
          },
          create: {
            projectCode,
            name: row.projectName,
            requestingDepartmentId: departmentId,
          },
        });

        const nextRoundNo = (projectRoundCounter.get(project.id) ?? 0) + 1;
        projectRoundCounter.set(project.id, nextRoundNo);

        let awardedSupplierId: string | null = null;
        if (row.awardedSupplierName) {
          // TODO: ERP Supplier requires userId — imports create name-only records; revisit after supplier import flow redesign
          const awardedSupplier = await (tx as any).supplier.upsert({
            where: {
              normalizedName: normalizeName(row.awardedSupplierName),
            },
            update: {
              name: row.awardedSupplierName,
            },
            create: {
              name: row.awardedSupplierName,
              normalizedName: normalizeName(row.awardedSupplierName),
              enterpriseType: '企业',
              legalPerson: '',
              registeredAddress: '',
              businessScope: '',
            },
          });
          awardedSupplierId = awardedSupplier.id;
        }

        const procurementRound = await tx.procurementRound.create({
          data: {
            projectId: project.id,
            roundNo: nextRoundNo,
            procurementDate: row.procurementDate,
            procurementMethod: row.procurementMethod,
            departmentId,
            budgetAmount: row.budgetAmount,
            controlAmount: row.controlAmount,
            awardedSupplierId,
            awardAmount: row.awardAmount,
            resultStatus: row.resultStatus,
            resultText: row.resultText,
            sourceType: SourceType.EXCEL_IMPORT,
            supplierText: row.supplierNames.join('\n'),
            importBatchId: importBatch.id,
          },
        });

        for (const [index, supplierName] of row.supplierNames.entries()) {
          // TODO: ERP Supplier requires userId — see note above
          const supplier = await (tx as any).supplier.upsert({
            where: {
              normalizedName: normalizeName(supplierName),
            },
            update: {
              name: supplierName,
            },
            create: {
              name: supplierName,
              normalizedName: normalizeName(supplierName),
              enterpriseType: '企业',
              legalPerson: '',
              registeredAddress: '',
              businessScope: '',
            },
          });

          await tx.roundParticipant.upsert({
            where: {
              procurementRoundId_supplierId: {
                procurementRoundId: procurementRound.id,
                supplierId: supplier.id,
              },
            },
            update: {
              sequenceNo: index + 1,
            },
            create: {
              procurementRoundId: procurementRound.id,
              supplierId: supplier.id,
              sequenceNo: index + 1,
            },
          });
        }
      }

      await tx.importBatch.update({
        where: { id: importBatch.id },
        data: {
          successCount: dataRowCount,
          warningCount: parsedRows.filter(
            (item) => item.procurementDate == null,
          ).length,
          errorCount: 0,
        },
      });
    });

    return {
      fileName: workbookPath.split('/').pop() || 'unknown.xlsx',
      importedRows: parsedRows.length,
    };
  }

  private parseOldFormatRows(rows: (string | null)[][]) {
    // Skip header row (first row)
    const dataRows = rows.slice(1);

    let currentDate: string | null = null;
    const parsedRows: ParsedRow[] = [];

    for (const row of dataRows) {
      const dateCell = row[0];
      if (dateCell) {
        currentDate = String(dateCell);
      }

      const projectName = String(row[2] ?? '').trim();
      if (!projectName) {
        continue;
      }

      const awardedSupplierName = row[8] ? String(row[8]).trim() : null;
      const inferred = inferResultStatus(row[9], awardedSupplierName);
      const controlAmount = parseAmount(row[7]);
      const budgetAmount = parseAmount(row[6]) ?? controlAmount;

      parsedRows.push({
        procurementDate: parseExcelDate(currentDate, row[1]),
        projectName,
        procurementMethod: String(row[3] ?? '未填写').trim() || '未填写',
        departmentName: row[4] ? String(row[4]).trim() : null,
        supplierNames: splitSuppliers(row[5] ? String(row[5]) : null),
        budgetAmount,
        controlAmount,
        awardedSupplierName,
        awardAmount: inferred.awardAmount,
        resultStatus: inferred.resultStatus,
        resultText: inferred.resultText,
      });
    }

    return parsedRows;
  }

  private parseNewFormatRows(jsonRows: Record<string, unknown>[]) {
    const parsedRows: ParsedRow[] = [];

    // 记住上一个有效日期，用于处理合并单元格的情况
    let lastValidDate: { dateText: unknown; timeValue: unknown } | null = null;

    for (const row of jsonRows) {
      const projectName = String(row['项目名称'] ?? '').trim();
      if (!projectName) {
        continue;
      }

      const dateText = row['开标日期'];
      const timeValue = row['开标时间'];

      // 如果当前行有日期，更新记住的日期
      if (dateText) {
        lastValidDate = { dateText, timeValue };
      }

      // 使用当前行的日期，如果没有则使用上一个有效日期
      const effectiveDate = dateText || lastValidDate?.dateText;
      const effectiveTime = dateText ? timeValue : lastValidDate?.timeValue;

      const awardedSupplierName = row['中标商']
        ? String(row['中标商']).trim()
        : null;
      const finalPrice = row['最终价（元）'];

      const inferred = inferResultStatus(finalPrice, awardedSupplierName);
      const controlAmount = parseAmount(row['控制价（元）']);
      const budgetAmount = parseAmount(row['预算价（元）']) ?? controlAmount;

      parsedRows.push({
        procurementDate: parseExcelDate(effectiveDate, effectiveTime),
        projectName,
        procurementMethod: String(row['采购类别'] ?? '未填写').trim() || '未填写',
        departmentName: row['需求部门']
          ? String(row['需求部门']).trim()
          : null,
        supplierNames: splitSuppliers(
          row['拟邀请的供应商'] ? String(row['拟邀请的供应商']) : null,
        ),
        budgetAmount,
        controlAmount,
        awardedSupplierName,
        awardAmount: inferred.awardAmount,
        resultStatus: inferred.resultStatus,
        resultText: inferred.resultText,
      });
    }

    return parsedRows;
  }
}
