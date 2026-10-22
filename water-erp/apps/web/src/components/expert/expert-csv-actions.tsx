'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { importCsv } from '@/lib/api/expert';
import { Download, Upload, Loader2, Eye, ChevronDown } from 'lucide-react';

const CSV_HEADERS = ['姓名', '登录账号', '初始密码', '专业领域', '职称', '工作单位', '所属部门', '联系电话', '电子邮箱', '身份证号', '民族', '学历', '执业资格证号', '备注'];
const CSV_EXAMPLE = ['张三', 'zhangsan', 'abc123', '水利水电工程', '高级工程师', '四川水发勘测设计研究有限公司', '工程勘察院', '13800138000', 'zhangsan@example.com', '', '汉族', '硕士', '', ''];

interface ExpertCsvActionsProps {
  onImported?: () => void;
}

/** 模板下载 + CSV 批量导入按钮（可复用嵌入任意专家录入场景） */
export function ExpertCsvActions({ onImported }: ExpertCsvActionsProps) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);

  const downloadTemplate = () => {
    const csv = '﻿' + CSV_HEADERS.join(',') + '\n' + CSV_EXAMPLE.join(',');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '专家导入模板.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 引号感知的 CSV 行解析（2026-09-28 审计 E5：此前 line.split(',') 把含逗号的
   *  引号字段（如备注）整列错位，错误数据直接进库且无告警）。支持 "" 转义。 */
  const splitCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // BOM 剥离（Excel 导出 CSV 常 带 ﻿，残留会让首个表头匹配失败）+ CRLF 行尾清理（四审加固）
    const text = (await file.text()).replace(/^﻿/, '');
    const rawLines = text.trim().split('\n').map(l => l.replace(/\r$/, ''));
    // 跨行引号字段合并（四审 P2）：引号内含换行的字段此前被切断、后半段成独立行静默错位——
    // 按引号数奇偶合并（"" 转义为偶数个，奇数=未闭合）
    const lines: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      while ((line.match(/"/g)?.length ?? 0) % 2 === 1 && i + 1 < rawLines.length) {
        line += '\n' + rawLines[++i];
      }
      lines.push(line);
    }
    if (lines.length < 2) {
      toast.error('CSV 至少需要表头行和一数据行');
      e.target.value = '';
      return;
    }
    const headers = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map(line => {
      const vals = splitCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = vals[i] || ''; });
      return row;
    });
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importCsv(rows);
      setImportResult(result);
      toast.success(`导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`);
      onImported?.();
    } catch (err: any) {
      toast.error(err?.message || '导入失败');
    }
    setImporting(false);
    e.target.value = '';
  };

  return (
    <>
      <div className="rounded-xl border border-dashed border-[color-mix(in_oklch,var(--muted-foreground)_25%,transparent)] bg-[color-mix(in_oklch,var(--muted-foreground)_3%,transparent)] p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] shrink-0">批量导入：</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreview(v => !v)}
              className={`neu-btn-xs ${showPreview ? 'is-active' : ''}`}
              title="查看并下载标准 CSV 模板"
            >
              <Eye size={12} />模板查看与下载
              <ChevronDown size={10} className={`transition-transform ${showPreview ? 'rotate-180' : ''}`} />
            </button>
            <label className={`neu-btn-xs cursor-pointer ${importing ? 'opacity-60 pointer-events-none' : ''}`}>
              {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {importing ? '导入中...' : '导入CSV'}
              <input type="file" accept=".csv" onChange={handleImport} disabled={importing} className="hidden" />
            </label>
          </div>
        </div>

        {/* 模板预览面板 */}
        {showPreview && (
          <div className="rounded-xl bg-[color-mix(in_oklch,var(--background)_60%,transparent)] border border-[color-mix(in_oklch,var(--muted-foreground)_15%,transparent)] overflow-hidden">
            {/* 表头说明 */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
              <div>
                <h4 className="text-xs font-bold text-[var(--foreground)]">CSV 导入模板预览</h4>
                <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">以下为模板的列名与示例数据，按此格式填写后上传即可批量导入专家。</p>
              </div>
              <button onClick={downloadTemplate} className="neu-btn-xs is-info shrink-0">
                <Download size={12} />下载模板文件
              </button>
            </div>
            {/* 字段列表 */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0 px-4 py-3 max-h-[280px] overflow-y-auto">
              {CSV_HEADERS.map((header, i) => {
                const value = CSV_EXAMPLE[i];
                return (
                  <div key={header} className="flex items-center gap-2 py-1.5 border-b border-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)]">
                    <span className="text-[11px] font-bold text-[var(--muted-foreground)] shrink-0 min-w-[72px]">{header}</span>
                    <span className={`text-[11px] truncate ${value ? 'text-[var(--foreground)] font-medium' : 'text-[var(--muted-foreground)]/40 italic'}`}>{value || '（选填）'}</span>
                  </div>
                );
              })}
            </div>
            {/* 填写说明 */}
            <div className="px-4 py-2.5 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-[var(--muted-foreground)]/70">
              <span>姓名/登录账号/初始密码/专业领域为必填字段</span>
              <span>编码保存为 <code className="px-1 py-0.5 rounded bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] text-[10px]">UTF-8 CSV</code> 格式</span>
              <span>空字段保留逗号占位即可</span>
            </div>
          </div>
        )}

        <p className="text-[10px] text-[var(--muted-foreground)]/70 leading-relaxed">下载 CSV 模板按格式填写后上传，可批量创建专家。模板包含姓名、登录账号、专业领域、工作单位、所属部门等字段。</p>
      </div>

      {importResult && (
        <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_5%,transparent)] px-4 py-3 space-y-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--foreground)]">CSV 导入结果</span>
            <button onClick={() => setImportResult(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs">✕ 关闭</button>
          </div>
          <div className="flex gap-4 text-xs text-[var(--muted-foreground)]">
            <span>总计 <strong className="text-[var(--foreground)]">{importResult.total}</strong> 行</span>
            <span>成功 <strong className="text-[var(--success)]">{importResult.imported}</strong></span>
            <span>跳过 <strong className="text-[var(--warning)]">{importResult.skipped}</strong></span>
            <span>失败 <strong className="text-[var(--danger)]">{importResult.failed}</strong></span>
          </div>
          {/* 逐行明细（2026-10-22）：后端本就返回 per-row 结果，此前前端只显汇总——
              「成功 0 跳过 23」却看不到原因的困惑由此而来。跳过/失败行必须给出原因 */}
          {Array.isArray(importResult.results) && importResult.results.length > 0 && (
            <div className="mt-2 max-h-[220px] overflow-y-auto rounded-[10px] border border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
              <table className="w-full table-fixed border-collapse text-[11px]">
                <colgroup><col style={{ width: '28%' }} /><col style={{ width: '14%' }} /><col /></colgroup>
                <thead>
                  <tr className="text-[color:var(--muted-foreground)]">
                    <th className="px-2 py-1.5 text-left font-medium">姓名</th>
                    <th className="px-2 py-1.5 text-center font-medium">状态</th>
                    <th className="px-2 py-1.5 text-left font-medium">原因</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.results.map((r: { 姓名: string; 状态: string; 原因?: string }, i: number) => (
                    <tr key={i} className="border-t border-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)]">
                      <td className="px-2 py-1.5 text-left text-[var(--foreground)]"><span className="block truncate" title={r.姓名}>{r.姓名}</span></td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${
                          r.状态 === '成功' ? 'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[color:var(--success)]'
                          : r.状态 === '失败' ? 'bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-[color:var(--danger)]'
                          : 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[color:var(--warning)]'}`}>{r.状态}</span>
                      </td>
                      <td className="px-2 py-1.5 text-left text-[color:var(--muted-foreground)]"><span className="block truncate" title={r.原因 ?? ''}>{r.原因 ?? '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
