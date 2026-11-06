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
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `操作历史-${title}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.txt`;
  const blob = new Blob([`﻿${content}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return entries.length;
}
