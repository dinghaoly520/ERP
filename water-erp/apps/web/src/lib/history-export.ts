'use client';

/**
 * 操作历史 txt 导出（2026-11-06 用户裁定）：三个操作历史窗口（通知中心/供应商库/专家库）
 * 右上角导出按钮共用——按时间正序、按天分段的纯文本文档，UTF-8 带 BOM（Windows 记事本
 * 直开不乱码）。门户自包含（无共享组件包惯例），仅 web 门户消费。
 */

/** 一条可导出的历史记录（各窗口把自有 item 投影成此形状） */
export interface HistoryExportEntry {
  /** ISO 时间（用于排序与按天分段） */
  at: string;
  /** 操作人「姓名（角色）」；本人视图可空 */
  operator?: string;
  /** 动作中文标签 */
  action: string;
  /** 资源/对象行（项目名/供应商名/专家名） */
  subject?: string;
  /** 明细行（键值串，如「专家数：5 · 抽取方式：随机抽取」） */
  detail?: string;
  /** 元信息（IP · 设备） */
  meta?: string;
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayTitle(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * 生成 txt 文档体：头块（范围/导出时间/条数）+ 按天分段（正序），
 * 段内条目按时间正序：`[HH:mm:ss] 操作人 · 动作` + 缩进的资源/明细/来源行。
 */
export function buildHistoryTxt(title: string, scope: string, entries: HistoryExportEntry[]): string {
  const sorted = [...entries].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const lines: string[] = [
    '══════════════════════════════════════',
    `操作历史导出 · ${title}`,
    `范围：${scope}`,
    `导出时间：${fmtFull(new Date().toISOString())}`,
    `记录条数：${sorted.length} 条（按时间正序）`,
    '══════════════════════════════════════',
    '',
  ];
  let currentDay = '';
  for (const e of sorted) {
    const day = dayKey(e.at);
    if (day !== currentDay) {
      if (currentDay) lines.push('');
      lines.push(`──────── ${dayTitle(day)} ────────`, '');
      currentDay = day;
    }
    lines.push(`[${fmtTime(e.at)}] ${[e.operator, e.action].filter(Boolean).join(' · ')}`);
    if (e.subject) lines.push(`    ${e.subject}`);
    if (e.detail) lines.push(`    ${e.detail}`);
    if (e.meta) lines.push(`    来源：${e.meta}`);
  }
  return lines.join('\n') + '\n';
}

/** 触发浏览器下载（Blob + a[download]；带 BOM 防 Windows 记事本乱码） */
export function downloadHistoryTxt(title: string, scope: string, entries: HistoryExportEntry[]): number {
  const content = buildHistoryTxt(title, scope, entries);
  return downloadTxt(`操作历史-${title}`, content, entries.length);
}

/* ═══ 系统操作日志导出（2026-11-09 操作历史统一配下载）——请求日志版式，
   与按天分段的活动留痕版式区分：一行一请求，含方法/路径/状态/耗时/来源 IP ═══ */

/** 一条可导出的请求日志 */
export interface OperationLogExportEntry {
  at: string;
  /** 操作人姓名（displayName，username 回退）；匿名请求可空 */
  operator?: string;
  role?: string | null;
  portal?: string | null;
  method: string;
  path: string;
  query?: string | null;
  statusCode: number;
  durationMs?: number | null;
  ip?: string | null;
}

const PORTAL_LABELS: Record<string, string> = {
  web: '采购管理端', bid: '开评标端', supplier: '供应商门户',
  expert: '专家门户', public: '信息门户', mobile: '移动驾驶舱',
};

/** 生成请求日志 txt：头块（筛选摘要/条数）+ 逐行请求记录（新→旧原序，时间正序呈现） */
export function buildOperationLogTxt(scope: string, entries: OperationLogExportEntry[], truncatedTo?: number): string {
  const sorted = [...entries].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const lines: string[] = [
    '══════════════════════════════════════',
    '系统操作日志导出',
    `范围：${scope}`,
    `导出时间：${fmtFull(new Date().toISOString())}`,
    `记录条数：${sorted.length} 条${truncatedTo ? `（总量超限，已截取最近 ${truncatedTo} 条——如需完整请收窄筛选）` : ''}`,
    '══════════════════════════════════════',
    '',
  ];
  for (const e of sorted) {
    const date = new Date(e.at);
    const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const head = `[${mmdd} ${fmtTime(e.at)}] ${[e.operator, e.role, e.portal ? PORTAL_LABELS[e.portal] ?? e.portal : null].filter(Boolean).join(' · ') || '匿名请求'}`;
    lines.push(`${head}`);
    lines.push(`    ${e.method} ${e.path}${e.query ? `?${e.query}` : ''} → ${e.statusCode}${e.durationMs != null ? `（${e.durationMs}ms）` : ''}${e.ip ? ` · ${e.ip}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

/** 下载请求日志 txt（同 BOM 口径）；truncatedTo 透传截断说明，返回实际条数 */
export function downloadOperationLogTxt(scope: string, entries: OperationLogExportEntry[], truncatedTo?: number): number {
  const content = buildOperationLogTxt(scope, entries, truncatedTo);
  return downloadTxt('系统操作日志', content, entries.length);
}

/** 下载共底层：命名 + Blob 触发 */
function downloadTxt(namePrefix: string, content: string, count: number): number {
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `${namePrefix}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.txt`;
  const blob = new Blob([`﻿${content}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return count;
}
