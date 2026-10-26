'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { importCsv } from '@/lib/api/expert';
import { Workbook } from 'exceljs';
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

  /** ExcelJS 单元格值归一为字符串（number 直取全位整数、公式取 result、富文本拼接、日期取日期段） */
  const normCell = (v: unknown): string => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v.trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const o = v as { result?: unknown; text?: string; richText?: Array<{ text: string }> };
    if (Array.isArray(o.richText)) return o.richText.map(t => t.text).join('').trim();
    if (o.result !== undefined && o.result !== null) return normCell(o.result);
    if (typeof o.text === 'string') return o.text;
    return String(v);
  };

  /** .xlsx 解析（2026-10-22 用户口径：不止 CSV）——首工作表、首行为表头、其余为数据行（跳过整行空） */
  const parseXlsxRows = async (file: File): Promise<Array<Record<string, string>>> => {
    const wb = new Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('工作簿中没有工作表');
    const matrix: Array<Array<unknown>> = [];
    ws.eachRow((row) => { matrix.push(((row.values ?? []) as Array<unknown>).slice(1)); });
    if (matrix.length < 2) throw new Error('Excel 至少需要表头行和一数据行');
    const headers = matrix[0].map(normCell);
    return matrix.slice(1)
      .filter(vals => vals.some(v => normCell(v) !== ''))
      .map(vals => {
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { if (h) row[h] = normCell(vals[i]); });
        return row;
      });
  };

  /** 控制字符/替换符计数（二进制防呆口径：\t\n\r 以外的 C0 控制符 + UTF-8 解码失败替换符）。
   *  写法刻意不用正则转义序列：控制字符字面量一旦经传输层转写，git 会判文件为二进制（25bf02a3 实录）。 */
  const countBadChars = (s: string): number => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c <= 8 || (c >= 14 && c <= 31) || c === 0xfffd) n++;
    }
    return n;
  };

  /** CSV 文本解析（编码自动识别 UTF-8/UTF-16/GB18030 / BOM 剥离 / CRLF 清理 / 跨行引号合并 / 二进制防呆 / 科学计数法展开） */
  const parseCsvRows = async (file: File): Promise<Array<Record<string, string>>> => {
    // 格式魔数先行，命中即给可操作指引（2026-10-26：GBK 中文 CSV 曾被「不是 CSV 文本」笼统
    // 误杀——先判真实格式再谈编码，见下方编码识别）
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      throw new Error('该文件是 xlsx（zip）格式——无需转 CSV，直接选择该 .xlsx 文件导入即可（已支持）');
    }
    if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
      throw new Error('该文件是旧版 .xls 格式——暂不支持，请在 Excel 中另存为 .xlsx（推荐）或 CSV 后重试');
    }
    // 编码识别：BOM 优先（UTF-16LE/BE）；无 BOM 先按 UTF-8 解码，无效字节占比高则回退 GB18030
    // （Excel「CSV(逗号分隔)」默认 ANSI/GBK 口径——中文双字节在 UTF-8 下全是替换符，旧版 2%
    // 阈值必误杀，2026-10-26 根治）
    let text: string;
    let encodingNote = '';
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      text = new TextDecoder('utf-16le').decode(buf.subarray(2));
      encodingNote = 'UTF-16LE';
    } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      text = new TextDecoder('utf-16be').decode(buf.subarray(2));
      encodingNote = 'UTF-16BE';
    } else {
      const utf8 = new TextDecoder('utf-8').decode(buf);
      const badUtf8 = countBadChars(utf8);
      if (badUtf8 > 3 && badUtf8 > buf.length * 0.01) {
        const gb = new TextDecoder('gb18030').decode(buf);
        if (countBadChars(gb) <= gb.length * 0.02) {
          text = gb;
          encodingNote = 'GB18030';
        } else {
          throw new Error('文件内容无法按文本解析——不是有效的 UTF-8 / GBK 编码 CSV，疑似二进制。请用 Excel 打开确认后另存为 .xlsx（推荐）或「CSV UTF-8」再导入');
        }
      } else {
        text = utf8;
      }
    }
    if (encodingNote) {
      toast.info(`已按 ${encodingNote} 编码自动识别读取——建议日后另存为「CSV UTF-8」更稳妥`);
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // 兜底防呆（2026-10-22 实录：二进制被当文本解析，乱码行数≠名单行数、全部静默跳过；
    // 魔数未命中的 rar/7z 等压缩包在此拦截）
    if (countBadChars(text) > text.length * 0.02) {
      throw new Error('当前文件疑似二进制/压缩包，不是 CSV 文本——xlsx 可直接导入；压缩包请先解压，其他格式请转为 xlsx 或 CSV UTF-8');
    }
    const rawLines = text.trim().split('\n').map(l => l.replace(/\r$/, ''));
    // 跨行引号字段合并（四审 P2）：引号内含换行的字段此前被切断、后半段成独立行静默错位
    const lines: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i];
      while ((line.match(/"/g)?.length ?? 0) % 2 === 1 && i + 1 < rawLines.length) {
        line += '\n' + rawLines[++i];
      }
      lines.push(line);
    }
    if (lines.length < 2) throw new Error('CSV 至少需要表头行和一数据行');
    const headers = splitCsvLine(lines[0]);
    // Excel 数值化陷阱（2026-10-22 实录：手机号列被当数值存成科学计数法 1.38E+10）：尽力展开
    const expandSci = (v: string): string => {
      const m = v.trim().match(/^(\d)(?:\.(\d+))?[eE]\+?(\d+)$/);
      if (!m) return v;
      return Number(v).toFixed(0);
    };
    return lines.slice(1).map(line => {
      const vals = splitCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = (h.includes('联系电话') || h.includes('手机') || h.includes('电话') || h.includes('身份证')) ? expandSci(vals[i] || '') : (vals[i] || '');
      });
      return row;
    });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const done = () => { setImporting(false); e.target.value = ''; };
    if (/\.xls$/i.test(file.name)) {
      toast.error('暂不支持旧版 .xls——请另存为 .xlsx（推荐，已支持直接导入）或 CSV 后重试');
      e.target.value = '';
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const rows = (/\.xlsx$/i.test(file.name) ? await parseXlsxRows(file) : await parseCsvRows(file));
      // 表头关键列校验（与后端 pick 的宽松匹配同口径）：缺关键列时逐行必然「缺少必填」全跳过
      const sampleKeys = Object.keys(rows[0] ?? {});
      const hasCol = (keys: string[]) => sampleKeys.some(h => keys.some(k => h.includes(k)));
      if (rows.length === 0 || !hasCol(['姓名', '名称']) || !hasCol(['登录账号', '账号', '用户名']) || !hasCol(['专业领域', '专业'])) {
        toast.error('表头缺少关键列（姓名 / 登录账号 / 专业领域）——请点击「模板查看与下载」获取标准模板填写');
        done();
        return;
      }
      // Excel 数值身份证失真预警：数值仅 15 位有效数字，18 位身份证尾位会被清零
      const idLike = sampleKeys.find(h => h.includes('身份证'));
      if (idLike && rows.some(r => /\d{15,}0{3}/.test(r[idLike] ?? ''))) {
        toast.warning('身份证号疑似数值失真（末位多个 0）——请将该列设为「文本」格式后重填再导入');
      }
      const result = await importCsv(rows);
      setImportResult(result);
      toast.success(`导入完成：成功 ${result.imported} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条`);
      onImported?.();
    } catch (err: any) {
      toast.error(err?.message || '导入失败');
    }
    done();
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
              {importing ? '导入中...' : '导入 Excel/CSV'}
              <input type="file" accept=".csv,.xlsx" onChange={handleImport} disabled={importing} className="hidden" />
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

        <p className="text-[10px] text-[var(--muted-foreground)]/70 leading-relaxed">支持 .xlsx 与 .csv（模板两用）；必填姓名/登录账号/初始密码/专业领域。身份证与手机号列请设为「文本」格式，避免 Excel 数值失真。</p>
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
