import { Workbook } from 'exceljs';
import type { SupplierRecommendation } from '@/lib/api/supplier';
import { LEVEL_LABEL } from '@water-erp/shared';

export function exportShortlistToExcel(
  items: { item: SupplierRecommendation; note: string }[],
  projectName?: string,
  headerContext?: { lines: string[] },
) {
  const wb = new Workbook();
  const ws = wb.addWorksheet('候选供应商名单');

  // ── 项目信息头（在表头上方） ──
  if (headerContext?.lines?.length) {
    headerContext.lines.forEach((line, i) => {
      const row = ws.addRow([line]);
      ws.mergeCells(`A${row.number}:K${row.number}`);
      row.getCell(1).font = { bold: line.startsWith('│') || line.startsWith('【') || line.startsWith('  '), size: 10, color: { argb: line.startsWith('【') ? 'FF3B5998' : 'FF333333' } };
      row.getCell(1).alignment = { wrapText: true };
      if (line.startsWith('════')) {
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FB' } };
        row.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF3B5998' } };
        row.getCell(1).alignment = { horizontal: 'center' };
      }
    });
    // 空行分隔
    ws.addRow([]);
  }

  const HEADER_ROW = headerContext?.lines?.length ? headerContext.lines.length + 2 : 1;

  ws.columns = [
    { header: '序号', key: 'index', width: 6 },
    { header: '供应商名称', key: 'name', width: 28 },
    { header: '分类', key: 'classification', width: 16 },
    { header: '企业类型', key: 'enterpriseType', width: 16 },
    { header: '匹配分', key: 'matchScore', width: 10 },
    { header: '匹配说明', key: 'reason', width: 36 },
    { header: '联系人', key: 'contact', width: 14 },
    { header: '电话', key: 'phone', width: 16 },
    { header: '评价等级', key: 'level', width: 10 },
    { header: '进行中项目', key: 'projects', width: 12 },
    { header: '备注', key: 'note', width: 24 },
  ];

  // Header style
  const headerRow = ws.getRow(HEADER_ROW);
  headerRow.font = { bold: true, color: { argb: 'FF5E7EBD' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEEF3FB' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  items.forEach(({ item: r, note }, idx) => {
    const contact = r.contacts?.find((c) => c.isPrimary) || r.contacts?.[0];
    const row = ws.addRow({
      index: idx + 1,
      name: r.name,
      classification: r.classification || '—',
      enterpriseType: r.enterpriseType || '—',
      matchScore: r.matchScore,
      reason: r.reason,
      contact: contact?.name || '—',
      phone: contact?.phone || '—',
      level: r.evaluation?.level || '—',
      projects: r.activeProjects,
      note: note || '',
    });

    row.alignment = { vertical: 'middle' };

    // Score color
    const scoreCell = row.getCell('matchScore');
    if (r.matchScore >= 85) {
      scoreCell.font = { color: { argb: 'FF2E8B57' }, bold: true };
    } else if (r.matchScore >= 70) {
      scoreCell.font = { color: { argb: 'FF5E7EBD' }, bold: true };
    } else if (r.matchScore >= 55) {
      scoreCell.font = { color: { argb: 'FFD97706' }, bold: true };
    }

    // Level color
    const levelCell = row.getCell('level');
    if (r.evaluation?.level === 'A') {
      levelCell.font = { color: { argb: 'FF2E8B57' }, bold: true };
    } else if (r.evaluation?.level === 'D') {
      levelCell.font = { color: { argb: 'FFDC2626' }, bold: true };
    }
  });

  // Borders
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD3DDE8' } },
        bottom: { style: 'thin', color: { argb: 'FFD3DDE8' } },
        left: { style: 'thin', color: { argb: 'FFD3DDE8' } },
        right: { style: 'thin', color: { argb: 'FFD3DDE8' } },
      };
    });
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = projectName
    ? `供应商候选名单_${projectName}_${dateStr}.xlsx`
    : `供应商候选名单_${dateStr}.xlsx`;

  wb.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}

import { getSupplierList } from './api/supplier';

/** 分批拉取全量筛选结果并导出 Excel */
export async function exportAllFilteredSuppliersToExcel(filterParams: Record<string, any>, total: number) {
  const allItems: any[] = [];
  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);

  for (let page = 1; page <= totalPages; page++) {
    const res = await getSupplierList({ ...filterParams, page, pageSize });
    allItems.push(...res.items);
  }

  exportSuppliersToExcel(allItems);
}

/** 供应商库导出（按最新供应商资料设计列）：编号/主体信息/联系方式/标签分类/评价/状态。 */
export function exportSuppliersToExcel(suppliers: any[]) {
  const wb = new Workbook();
  const ws = wb.addWorksheet('供应商库');

  ws.columns = [
    { header: '序号', key: 'index', width: 6 },
    { header: '供应商编号', key: 'supplierNo', width: 14 },
    { header: '企业名称', key: 'name', width: 30 },
    { header: '统一社会信用代码', key: 'creditCode', width: 22 },
    { header: '企业类型', key: 'enterpriseType', width: 14 },
    { header: '法定代表人', key: 'legalPerson', width: 12 },
    { header: '主要联系人', key: 'contact', width: 12 },
    { header: '联系电话', key: 'phone', width: 16 },
    { header: '归属公司', key: 'companyName', width: 18 },
    { header: '业务标签', key: 'tags', width: 30 },
    { header: '分类', key: 'classification', width: 14 },
    { header: '平均等级', key: 'avgGrade', width: 11 },
    { header: '评价次数', key: 'evalCount', width: 10 },
    { header: '最近评价', key: 'latestEval', width: 11 },
    { header: '入库时间', key: 'createdAt', width: 13 },
    { header: '状态', key: 'status', width: 14 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF5E7EBD' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FB' } };

  const statusMap: Record<string, string> = { PENDING: '待审核', RETURNED: '退回补正', APPROVED: '已入库', REJECTED: '审核不通过', DISABLED: '停用', BLACKLIST: '黑名单' };
  const gradeText = (g?: string | null) => (g ? `${g}（${LEVEL_LABEL[g] ?? ''}）`.replace('（）', '') : '—');

  suppliers.forEach((s: any, idx: number) => {
    const contact = s.contacts?.[0];
    // 临时供应商在状态列注明有效期，与库内标注口径一致。
    const statusText = s.isTemporary
      ? `${statusMap[s.status] || s.status}（临时·至 ${s.temporaryExpiresAt ? new Date(s.temporaryExpiresAt).toLocaleDateString('zh-CN') : '—'}）`
      : statusMap[s.status] || s.status;
    const row = ws.addRow({
      index: idx + 1,
      supplierNo: s.supplierNo || '—',
      name: s.name,
      creditCode: s.creditCode || '—',
      enterpriseType: s.enterpriseType || '—',
      legalPerson: s.legalPerson || '—',
      contact: contact?.name || '—',
      phone: contact?.phone || '—',
      companyName: s.companyName || '—',
      tags: s.tags?.length ? s.tags.join('、') : '—',
      classification: s.classification?.name || '—',
      avgGrade: gradeText(s._avgGrade),
      evalCount: s._count?.evaluations ?? 0,
      latestEval: gradeText(s._latestEvalLevel),
      createdAt: s.createdAt ? new Date(s.createdAt).toLocaleDateString('zh-CN') : '—',
      status: statusText,
    });
    row.alignment = { vertical: 'middle' };
  });

  ws.eachRow(row => { row.eachCell(cell => { cell.border = { top: { style: 'thin', color: { argb: 'FFD3DDE8' } }, bottom: { style: 'thin', color: { argb: 'FFD3DDE8' } }, left: { style: 'thin', color: { argb: 'FFD3DDE8' } }, right: { style: 'thin', color: { argb: 'FFD3DDE8' } } }; }); });

  const dateStr = new Date().toISOString().slice(0, 10);
  wb.xlsx.writeBuffer().then(buffer => {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `供应商库_${dateStr}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  });
}
