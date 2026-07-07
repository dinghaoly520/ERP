/**
 * Import 2026年5月采购项目汇总表.xlsx into the database.
 *
 * Usage:
 *   pnpm --filter api exec tsx prisma/scripts/import-may-2026-procurement.ts
 */

import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';

const EXCEL_PATH = '/Users/qihao/ERP2/procurement/资料/2026年5月采购项目汇总表.xlsx';

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(dateRaw: string | null, timeRaw: unknown): Date | null {
  if (!dateRaw) return null;
  const dateMatch = (dateRaw as string).match(/(\d{4})\.(\d{2})\.(\d{2})/);
  if (!dateMatch) return null;

  const [, year, month, day] = dateMatch;
  let timeStr = '12:00:00'; // noon UTC default — safe for all timezones

  if (timeRaw != null) {
    if (typeof timeRaw === 'string') {
      const t = timeRaw.trim();
      if (/^\d{2}:\d{2}:\d{2}$/.test(t)) timeStr = t;
      else if (/^\d{2}:\d{2}$/.test(t)) timeStr = `${t}:00`;
    } else if (typeof timeRaw === 'number') {
      // xlsx returns time as fraction of a day (e.g. 10:30 = 0.4375)
      const totalSeconds = Math.round(timeRaw * 86400);
      const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
      const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
      const ss = String(totalSeconds % 60).padStart(2, '0');
      timeStr = `${hh}:${mm}:${ss}`;
    }
  }

  // Store at noon UTC so the date portion is correct regardless of timezone
  return new Date(`${year}-${month}-${day}T${timeStr}Z`);
}

function cleanResultText(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '' || s === 'null' || s === 'None' || /^\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

function parseAmount(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number') return Math.round(val * 100) / 100;
  const n = Number.parseFloat(String(val).replace(/[,，]/g, ''));
  return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Reading Excel:', EXCEL_PATH);
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const dataRows = raw.slice(1).filter((r) => r[3]);

  console.log(`Found ${dataRows.length} data rows`);

  // ── Upsert Departments ──
  const deptNames = new Set<string>();
  for (const row of dataRows) {
    const deptName = String(row[5] ?? '').trim();
    if (deptName && deptName !== '/' && deptName !== 'None') deptNames.add(deptName);
  }

  const deptMap = new Map<string, string>();
  for (const name of deptNames) {
    let dept = await prisma.department.findFirst({ where: { name } });
    if (!dept) {
      dept = await prisma.department.create({ data: { name } });
      console.log(`  Created department: ${name}`);
    }
    deptMap.set(name, dept.id);
  }
  console.log(`Departments ready: ${deptMap.size}`);

  // ── Upsert Projects ──
  const projectNames = new Set<string>();
  for (const row of dataRows) {
    projectNames.add(String(row[3] ?? '').trim());
  }

  const projectMap = new Map<string, string>();
  for (const name of projectNames) {
    let proj = await prisma.project.findFirst({ where: { name } });
    if (!proj) {
      const code = `IMP-${Date.now().toString(36).slice(-6).toUpperCase()}-${projectMap.size + 1}`;
      proj = await prisma.project.create({
        data: { name, projectCode: code },
      });
      console.log(`  Created project: ${name}`);
    }
    projectMap.set(name, proj.id);
  }
  console.log(`Projects ready: ${projectMap.size}`);

  // ── Import ProcurementRounds ──
  let inserted = 0;
  let skipped = 0;
  let lastDateRaw: string | null = null; // forward-fill for merged cells

  for (const row of dataRows) {
    const projectName = String(row[3] ?? '').trim();
    const projectId = projectMap.get(projectName);
    if (!projectId) continue;

    // Forward-fill null dates from merged Excel cells.
    // Merged cells share the same date but have separate times (AM/PM sessions).
    // Only fill when row has a time value — truly dateless rows have no time either.
    const dateRaw = row[1] != null ? String(row[1]) : null;
    const effectiveDateRaw = dateRaw ?? (row[2] != null ? lastDateRaw : null);
    if (dateRaw) lastDateRaw = dateRaw;

    const roundNo = Number(row[0]) || 0;
    const procurementDate = parseDate(
      effectiveDateRaw,
      row[2],
    );
    const procurementMethod = String(row[4] ?? '').trim();
    const departmentName = String(row[5] ?? '').trim();
    const departmentId = deptMap.get(departmentName) ?? null;
    const budgetAmount = parseAmount(row[8]);
    const controlAmount = row[9] != null ? parseAmount(row[9]) : 0;
    const awardedSupplierNameRaw = row[10] != null ? String(row[10]).trim().replace(/\s+/g, '') : '';
    const awardAmountRaw = row[11];
    const invitedSuppliers = String(row[7] ?? '').trim();

    // Determine result status
    let resultStatus = 'PENDING';
    let resultText: string | null = null;
    let awardedSupplierName: string | null = null;

    const resultString = awardAmountRaw != null ? String(awardAmountRaw).trim() : '';

    if (typeof awardAmountRaw === 'number' && awardedSupplierNameRaw && awardedSupplierNameRaw !== 'None' && awardedSupplierNameRaw !== 'null') {
      resultStatus = 'AWARDED';
      awardedSupplierName = awardedSupplierNameRaw;
    } else if (resultString.includes('资格审查未通过')) {
      resultStatus = 'FAILED_REVIEW';
      resultText = '资格审查未通过';
    } else if (resultString.includes('中止采购')) {
      resultStatus = 'PENDING';
      resultText = '中止采购';
    }

    const awardAmount = typeof awardAmountRaw === 'number' ? parseAmount(awardAmountRaw) : 0;

    // Check if round already exists (by project + roundNo unique constraint)
    const existing = await prisma.procurementRound.findFirst({
      where: { projectId, roundNo },
    });
    if (existing) {
      // Fix: fill missing dates (merged cells) or fix timezone-offset dates
      const updates: Record<string, unknown> = {};
      if (!existing.awardedSupplierName && awardedSupplierName) {
        updates.awardedSupplierName = awardedSupplierName;
      }
      if (procurementDate) {
        if (!existing.procurementDate) {
          // merged cell: date was null, now forward-filled
          updates.procurementDate = procurementDate;
        } else {
          const oldDay = existing.procurementDate.getUTCDate();
          const newDay = procurementDate.getUTCDate();
          if (oldDay !== newDay) {
            updates.procurementDate = procurementDate;
          }
        }
      } else if (existing.procurementDate && !effectiveDateRaw) {
        // previously incorrectly forward-filled, now revert to null
        updates.procurementDate = null;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.procurementRound.update({ where: { id: existing.id }, data: updates });
        console.log(`  Fixed existing: ${projectName} #${roundNo}`);
      }
      skipped++;
      continue;
    }

    await prisma.procurementRound.create({
      data: {
        projectId,
        roundNo,
        procurementDate,
        procurementMethod,
        departmentId,
        budgetAmount,
        controlAmount,
        awardAmount,
        resultStatus: resultStatus as any,
        resultText,
        awardedSupplierName,
        supplierText: invitedSuppliers || null,
        sourceType: 'EXCEL_IMPORT' as any,
      },
    });

    inserted++;
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`);
  console.log(`Departments: ${deptMap.size} | Projects: ${projectMap.size}`);
}

main()
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
