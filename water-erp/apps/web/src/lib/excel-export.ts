import { Workbook, type Borders } from 'exceljs';
import type { SupplierRecommendation } from '@/lib/api/supplier';
import { LEVEL_LABEL } from '@water-erp/shared';
import { SUPPLIER_STATUS_LABEL } from '@water-erp/shared';

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
    { header: '行业', key: 'industry', width: 16 },
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
      industry: r.industry || '—',
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
    { header: '行业', key: 'industry', width: 14 },
    { header: '平均等级', key: 'avgGrade', width: 11 },
    { header: '评价次数', key: 'evalCount', width: 10 },
    { header: '最近评价', key: 'latestEval', width: 11 },
    { header: '入库时间', key: 'createdAt', width: 13 },
    { header: '状态', key: 'status', width: 14 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF5E7EBD' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FB' } };

  // 统一 shared 口径（2026-09-28 审计：本地副本 DISABLED='停用' 与他处 '已停用' 分叉）；
  // 浅拷贝防后续误写污染 shared 模块级常量（四审加固）
  const statusMap: Record<string, string> = { ...SUPPLIER_STATUS_LABEL };
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
      industry: s.industry || '—',
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

// ── 专家库导出（按公司分组区块，2026-10-19）──
// 后端 /expert-admin/export 返回扁平 JSON（PII 已掩码）；本函数按「所属公司」分组放置：
// admin 全部公司=多区块、非 admin 单区块，同一代码路径。公司按人数降序（与 :3005 库页
// 「全部公司」视图一致），组内保持后端姓名升序；每区块自带列头，区块间空行打打印分页符
// ——打印时每公司自然成页（「表内分页」）。
const EXPERT_EXPORT_COLUMNS: Array<{ key: string; width: number }> = [
  { key: '姓名', width: 10 }, { key: '登录账号', width: 12 }, { key: '专业', width: 24 },
  { key: '职称', width: 20 }, { key: '工作单位', width: 30 }, { key: '所属公司', width: 26 },
  { key: '部门', width: 24 }, { key: '手机号', width: 14 }, { key: '身份证号', width: 22 },
  { key: '邮箱', width: 22 }, { key: '状态', width: 8 }, { key: '入库时间', width: 12 },
];

export async function exportExpertsToExcel(rows: Record<string, string>[]): Promise<number> {
  // 按所属公司分组（空值兜底「未归属」），公司人数降序、同人数按名称
  const groups = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const company = r['所属公司']?.trim() || '未归属';
    const list = groups.get(company);
    if (list) list.push(r); else groups.set(company, [r]);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh'));

  const wb = new Workbook();
  const ws = wb.addWorksheet('专家库');
  const colCount = EXPERT_EXPORT_COLUMNS.length;
  const lastCol = ws.getColumn(colCount).letter;
  const thinBorder: Partial<Borders> = {
    top: { style: 'thin', color: { argb: 'FFD3DDE8' } },
    bottom: { style: 'thin', color: { argb: 'FFD3DDE8' } },
    left: { style: 'thin', color: { argb: 'FFD3DDE8' } },
    right: { style: 'thin', color: { argb: 'FFD3DDE8' } },
  };
  const dateStr = new Date().toISOString().slice(0, 10);

  // 总标题（合并整行）
  const title = ws.addRow([`四川省水利发展集团采购评审专家库（共 ${rows.length} 人 · 导出于 ${dateStr}）`]);
  ws.mergeCells(`A${title.number}:${lastCol}${title.number}`);
  const titleCell = title.getCell(1);
  titleCell.font = { bold: true, size: 13, color: { argb: 'FF3B5998' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FB' } };
  title.eachCell({ includeEmpty: true }, (cell) => { cell.border = thinBorder; });

  ordered.forEach(([company, list], idx) => {
    if (idx > 0) {
      // 区块间空行 + 打印分页符：空行留在上一页页尾，下一公司起新页
      ws.addRow([]).addPageBreak();
    }
    // 公司区块标题（合并整行）
    const head = ws.addRow([`${company}（${list.length} 人）`]);
    ws.mergeCells(`A${head.number}:${lastCol}${head.number}`);
    const headCell = head.getCell(1);
    headCell.font = { bold: true, size: 12, color: { argb: 'FF3B5998' } };
    headCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F5' } };
    headCell.alignment = { horizontal: 'left', vertical: 'middle' };
    head.eachCell({ includeEmpty: true }, (cell) => { cell.border = thinBorder; });

    // 每区块自含列头（打印分页后每组页内可读）
    const header = ws.addRow(EXPERT_EXPORT_COLUMNS.map((c) => c.key));
    header.font = { bold: true, size: 11, color: { argb: 'FF5E7EBD' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FB' } };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
    header.eachCell({ includeEmpty: true }, (cell) => { cell.border = thinBorder; });

    for (const r of list) {
      const row = ws.addRow(EXPERT_EXPORT_COLUMNS.map((c) => r[c.key] ?? ''));
      row.alignment = { vertical: 'middle' };
      row.eachCell({ includeEmpty: true }, (cell) => { cell.border = thinBorder; });
    }
  });

  ws.columns = EXPERT_EXPORT_COLUMNS.map((c) => ({ width: c.width }));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `专家库导出_${dateStr}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return ordered.length; // 公司组数，供调用方提示
}
