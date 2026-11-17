'use client';

/**
 * 数据库「导出汇报材料」弹窗（2026-11-17 用户裁定；同日二次返工）：
 * 图表面板**直接复用数据库页组件本体**（TrendChartPanel/DepartmentPanel/MethodPieChartPanel/
 * ProjectScalePanel/NonAwardDonutPanel/SavingsRankingPanel/SupplierCards/KpiCard）——
 * 同一组件同一设计，非重绘仿制；每面板配数据要点文字说明（前端从数据计算，确定性）。
 * AI 总述走 /ai/dashboard-analysis（缓存优先；载荷 rangeLabel 已注入「未开标=在途非异常」口径，
 * 避免 AI 把区间末端尚未采购的项目当风险强调——2026-11-17 用户裁定）。
 * 导出 PDF（2026-11-17 用户裁定：window.print 受弹窗 fixed+滚动容器所限只出可视域）：
 * 新窗口写入自包含 HTML 报告（与页面同设计的 SVG 图表 + AI 说明 + @page 分页样式），
 * 长内容自然分页后自动唤起打印对话框——用户选「存储为 PDF」即得全文长档。
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/workbench';
import { Building2, FileDown, Loader2, Printer, Sparkles } from 'lucide-react';
import { fetchReportMaterialAnalysis, fetchReportMaterialCache, type ReportMaterialResult } from '@/lib/api/ai';
import { api } from '@/lib/api';
import type { DashboardData } from '@/lib/api/dashboard';
import {
  KpiCard, SavingsRankingPanel, ProjectScalePanel, MethodPieChartPanel,
  SupplierCards, TrendChartPanel, DepartmentPanel,
  type SupplierDetail, type SavingsRankingItem,
} from '@/components/home/dashboard-home';

/* ── PDF 导出：自包含 HTML 报告构建（镜像数据库页图表设计，纯字符串 SVG/HTML）── */

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtWanPdf = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : `${Math.round(v)} 元`);

/** 月度趋势 SVG（镜像 TrendChartPanel：金额渐变曲线+面积、立项↑/归档↓镜像柱、在执行阶梯线、双轴刻度） */
function trendSvg(S: DashboardData['trendSeries']): string {
  if (!S.length) return '<p class="empty">区间内暂无采购活动</p>';
  const W = 1000, lp = 46, rp = 46, tp = 22, mh = 104, bandHalf = 44;
  const cy = tp + mh + bandHalf + 12, axisY = cy + bandHalf + 6, ch = axisY + 26;
  const caw = W - lp - rp, dc = S.length;
  const bw = Math.max(14, Math.min(44, (caw / dc) * 0.5)), gap = Math.max(6, Math.min(16, bw * 0.4));
  const tw = dc * (bw + gap) - gap, sx = lp + Math.max(0, (caw - tw) / 2);
  const xc = (i: number) => sx + i * (bw + gap) + bw / 2;
  const ma = Math.max(...S.map(i => i.amount), 1);
  const mi = Math.max(...S.map(i => Math.max(i.initiated ?? 0, i.archived ?? 0)), 1);
  const mAct = Math.max(...S.map(i => i.active ?? 0), 1);
  const amtY = (v: number) => tp + (1 - v / ma) * mh;
  const initH = (v: number) => Math.max(v > 0 ? 3 : 0, (v / mi) * bandHalf);
  const actY = (v: number) => cy - (v / mAct) * (bandHalf - 8) - 4;
  const pts = S.map((it, i) => ({ x: xc(i), y: amtY(it.amount) }));
  const lineD = pts.map((p, i) => i === 0 ? `M ${p.x} ${p.y}` : `C ${pts[i - 1].x + (p.x - pts[i - 1].x) * 0.4} ${pts[i - 1].y}, ${p.x - (p.x - pts[i - 1].x) * 0.4} ${p.y}, ${p.x} ${p.y}`).join(' ');
  const areaD = `${lineD} L ${pts[pts.length - 1].x} ${tp + mh} L ${pts[0].x} ${tp + mh} Z`;
  const stepD = S.map((it, i) => { const x0 = xc(i) - (bw + gap) / 2, x1 = xc(i) + (bw + gap) / 2; return `${i === 0 ? 'M' : 'L'} ${x0} ${actY(it.active ?? 0)} L ${x1} ${actY(it.active ?? 0)}`; }).join(' ');
  const grid = [0, 0.5, 1].map(t => { const y = tp + (1 - t) * mh; return `<line x1="${lp}" y1="${y}" x2="${W - rp}" y2="${y}" stroke="oklch(0.65 0.03 250 / 0.22)" stroke-dasharray="${t === 0 ? 'none' : '3 4'}"/><text x="${lp - 6}" y="${y + 3}" text-anchor="end" class="ax">${(t * ma).toFixed(0)}万</text>`; }).join('');
  const rAxis = [0, 0.5, 1].map(t => { const y = cy - t * mi / 1 * bandHalf; return `<text x="${W - rp + 6}" y="${y + 3}" text-anchor="start" class="ax">${Math.round(t * mi)}${t === 1 ? '项' : ''}</text>`; }).join('');
  const bars = S.map((it, i) => {
    const x = sx + i * (bw + gap); const ih = initH(it.initiated ?? 0), ah = initH(it.archived ?? 0);
    const lbl = `<line x1="${x + bw / 2}" x2="${x + bw / 2}" y1="${axisY}" y2="${axisY + 5}" stroke="oklch(0.55 0.05 250 / 0.6)"/><text x="${x + bw / 2}" y="${ch - 6}" text-anchor="middle" class="ax">${it.label}</text>`;
    return `${ih > 0 ? `<rect x="${x}" y="${cy - ih}" width="${bw}" height="${ih}" rx="3" fill="oklch(0.63 0.128 247 / 0.85)"/>` : ''}${ah > 0 ? `<rect x="${x}" y="${cy}" width="${bw}" height="${ah}" rx="3" fill="oklch(0.6 0.13 175 / 0.85)"/>` : ''}${lbl}`;
  }).join('');
  const dots = pts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="oklch(0.58 0.14 164)" stroke="oklch(1 0 0 / 0.95)" stroke-width="2"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${ch}" style="width:100%">
<defs><linearGradient id="amtl" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="oklch(0.63 0.128 247)"/><stop offset="55%" stop-color="oklch(0.58 0.14 164)"/><stop offset="100%" stop-color="oklch(0.6 0.13 175)"/></linearGradient>
<linearGradient id="amta" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="oklch(0.58 0.14 164 / 0.22)"/><stop offset="100%" stop-color="oklch(0.58 0.14 164 / 0.02)"/></linearGradient></defs>
${grid}${rAxis}<line x1="${lp}" y1="${cy}" x2="${W - rp}" y2="${cy}" stroke="oklch(0.6 0.05 250 / 0.4)"/><line x1="${lp}" y1="${axisY}" x2="${W - rp}" y2="${axisY}" stroke="oklch(0.6 0.05 250 / 0.3)"/>
${bars}${stepD ? `<path d="${stepD}" fill="none" stroke="oklch(0.55 0.14 280 / 0.85)" stroke-width="1.5" stroke-dasharray="4 2.5" stroke-linecap="round"/>` : ''}
<path d="${areaD}" fill="url(#amta)"/><path d="${lineD}" fill="none" stroke="url(#amtl)" stroke-width="5" opacity="0.16" stroke-linecap="round"/><path d="${lineD}" fill="none" stroke="url(#amtl)" stroke-width="2.4" stroke-linecap="round"/>${dots}</svg>
<div class="lg"><span><i class="sw" style="background:linear-gradient(90deg,oklch(0.63 0.128 247),oklch(0.6 0.13 175))"></i>成交金额</span><span><i class="sq" style="background:oklch(0.63 0.128 247)"></i>立项</span><span><i class="sq" style="background:oklch(0.6 0.13 175)"></i>归档</span><span><i class="dash"></i>在执行</span></div>`;
}

/** 环形图 SVG（镜像 MethodPieChartPanel：六色环 + 中心总数）+ 右侧图例 */
const PC_PDF = ['oklch(0.63 0.128 247)', 'oklch(0.55 0.14 164)', 'oklch(0.65 0.15 83)', 'oklch(0.55 0.14 280)', 'oklch(0.6 0.15 27)', 'oklch(0.55 0.12 175)'];
function donutSvg(items: Array<{ name: string; count: number; share: number; amountLabel?: string }>, centerLabel: string): string {
  if (!items.length) return '<p class="empty">暂无数据</p>';
  let a = 0;
  const segs = items.map((m, i) => { const ang = (m.share / 100) * 360; const s = { sa: a, ea: a + ang, c: PC_PDF[i % PC_PDF.length], m }; a += ang; return s; });
  const total = items.reduce((s, m) => s + m.count, 0);
  const cx = 90, cy = 90, r = 64, ir = 41;
  const paths = segs.map(seg => {
    const sr = ((seg.sa - 90) * Math.PI) / 180, er = ((seg.ea - 90) * Math.PI) / 180, la = seg.ea - seg.sa > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos(sr), y1 = cy + r * Math.sin(sr), x2 = cx + r * Math.cos(er), y2 = cy + r * Math.sin(er);
    const x3 = cx + ir * Math.cos(er), y3 = cy + ir * Math.sin(er), x4 = cx + ir * Math.cos(sr), y4 = cy + ir * Math.sin(sr);
    return `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${la} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${la} 0 ${x4} ${y4} Z" fill="${seg.c}" opacity="0.9"/>`;
  }).join('');
  const legend = items.slice(0, 8).map((m, i) => `<li><i class="sq" style="background:${PC_PDF[i % PC_PDF.length]}"></i><span class="nm">${esc(m.name)}</span><b>${m.share}%</b><span class="mut">${m.count} 项${m.amountLabel ? ` · ${esc(m.amountLabel)}` : ''}</span></li>`).join('');
  return `<div class="duo"><svg viewBox="0 0 180 180" style="width:180px">${paths}<text x="${cx}" y="${cy - 3}" text-anchor="middle" style="font-size:17px;font-weight:700;fill:oklch(0.28 0.03 258)">${total}</text><text x="${cx}" y="${cy + 13}" text-anchor="middle" style="font-size:9px;fill:oklch(0.55 0.03 258)">${esc(centerLabel)}</text></svg><ul class="dl">${legend}</ul></div>`;
}

/** 横条组（镜像页面横条：值深浅单 hue + 右端数值） */
function hbarsHtml(items: Array<{ label: string; value: number }>, fmt: (v: number) => string): string {
  if (!items.length) return '<p class="empty">暂无数据</p>';
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="hb">${items.map(it => `<div class="row"><span class="lb">${esc(it.label)}</span><div class="tr"><div class="fill" style="width:${Math.max(1.5, (it.value / max) * 100)}%;background:oklch(${(0.66 - 0.24 * (it.value / max)).toFixed(3)} 0.12 258)"></div></div><b>${esc(fmt(it.value))}</b></div>`).join('')}</div>`;
}

/** 通用表格（widths 可选：各列百分比宽——table-fixed 布局，未给的列均分余量） */
function tableHtml(head: string[], rows: string[][], widths?: number[]): string {
  if (!rows.length) return '<p class="empty">暂无数据</p>';
  const colgroup = widths ? `<colgroup>${widths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>` : '';
  return `<table class="tb${widths ? ' fixed' : ''}">${colgroup}<thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/** 组装自包含 HTML 报告并唤起新窗口打印（用户选「存储为 PDF」得长档） */
function exportReportPdf(data: DashboardData, ai: ReportMaterialResult | null, companyName: string, companyId: string) {
  // 视角迁移（2026-11-17 用户裁定）：全部公司=各公司维度；单公司=部门维度
  const dimStats = companyId === 'all' ? data.companyStats : data.departmentStats;
  const dimLabel = companyId === 'all' ? '公司' : '部门';
  const s = data.summary;
  const seg = (min: number, max: number) => data.trendSeries.reduce((n, t) => n + t.projects.filter(p => {
    const bs = String(p.budgetLabel || '');
    const b = bs.includes('万') ? parseFloat(bs.replace('万', '').replace(/,/g, '').trim()) * 10000 : parseFloat(bs.replace('元', '').replace(/,/g, '')) || 0;
    return b >= min && b < max;
  }).length, 0);
  const scaleItems = [
    { label: '小额 <10万', value: seg(0, 100000) }, { label: '中小 10-50万', value: seg(100000, 500000) },
    { label: '中型 50-200万', value: seg(500000, 2000000) }, { label: '大型 >200万', value: seg(2000000, Infinity) },
  ];
  const savingsRate = s.awardedBudget > 0 ? ((s.totalSavings / s.awardedBudget) * 100).toFixed(1) : '0'; // 分母=已成交（2026-11-17 裁定）
  const doneRate = s.totalCount > 0 ? Math.round((s.completedCount / s.totalCount) * 100) : 0;
  const note = (k: string) => `<p class="note"><b>说明：</b>${esc(ai?.sections?.[k as keyof typeof ai.sections] || '')}</p>`;
  const aiBlock = ai?.overview ? `<section class="card ai"><h2>AI 综合分析</h2><p class="ov">${esc(ai.overview)}</p><div class="tri">${([['主要亮点', ai.highlights], ['关注事项', ai.concerns], ['工作建议', ai.suggestions]] as const).map(([t, l]) => `<div><h4>${t}</h4><ul>${l.slice(0, 5).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div></section>` : '';
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${companyName}采购数据汇报材料</title><style>
@page { size: A4; margin: 0; }
.pfoot { position: fixed; left: 0; right: 0; bottom: 6mm; text-align: center; font-size: 9px; color: oklch(0.62 0.03 258); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: "PingFang SC","Microsoft YaHei","Source Han Sans SC",sans-serif; color: oklch(0.28 0.03 258); font-size: 12px; line-height: 1.6; background: #fff; padding: 12mm 10mm 14mm; }
h1 { font-size: 20px; letter-spacing: -0.02em; }
.meta { color: oklch(0.55 0.03 258); font-size: 11px; margin: 4px 0 14px; }
.card { border-top: 2px solid oklch(0.5 0.12 258); padding: 10px 0 4px; margin: 14px 0; page-break-inside: avoid; }
.card h2 { font-size: 14px; margin-bottom: 8px; }
.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 12px 0; }
.kpi { border: 1px solid oklch(0.88 0.02 258); border-radius: 8px; padding: 8px 4px; text-align: center; page-break-inside: avoid; }
.kpi .l { font-size: 10px; color: oklch(0.55 0.03 258); } .kpi .v { font-size: 14px; font-weight: 800; margin-top: 3px; }
.tri { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 8px; }
.tri h4 { font-size: 11px; margin-bottom: 4px; } .tri ul { padding-left: 14px; } .tri li { font-size: 10.5px; color: oklch(0.47 0.03 258); margin-bottom: 2px; }
.ov { font-size: 11.5px; }
.note { background: oklch(0.95 0.02 258); border-radius: 8px; padding: 8px 10px; font-size: 11px; margin-top: 8px; }
.note b { color: oklch(0.5 0.12 258); }
.tb { width: 100%; border-collapse: collapse; font-size: 10.5px; }
.tb th { text-align: left; color: oklch(0.55 0.03 258); font-size: 10px; border-bottom: 1px solid oklch(0.85 0.02 258); padding: 4px 6px; }
.tb td { border-bottom: 1px solid oklch(0.93 0.02 258); padding: 5px 6px; }
.tb.fixed { table-layout: fixed; }
.tb.fixed td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.duo { display: flex; gap: 16px; align-items: center; }
.dl { list-style: none; flex: 1; } .dl li { display: flex; align-items: center; gap: 6px; padding: 2.5px 0; font-size: 11px; }
.dl .nm { flex: 1; } .dl b { color: oklch(0.42 0.03 258); }
.sq { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: none; }
.sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; flex: none; }
.dash { width: 14px; border-top: 2px dashed oklch(0.55 0.14 280 / 0.85); display: inline-block; flex: none; }
.lg { display: flex; justify-content: center; gap: 14px; font-size: 10px; color: oklch(0.55 0.03 258); margin-top: 4px; }
.lg span { display: inline-flex; align-items: center; gap: 4px; }
.hb .row { display: flex; align-items: center; gap: 8px; padding: 2.5px 0; }
.hb .lb { width: 110px; text-align: right; font-size: 10.5px; color: oklch(0.55 0.03 258); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hb .tr { flex: 1; height: 13px; background: oklch(0.94 0.01 258); border-radius: 4px; overflow: hidden; }
.hb .fill { height: 100%; border-radius: 4px; }
.hb b { width: 64px; font-size: 10.5px; }
.ax { font-size: 9px; fill: oklch(0.6 0.06 250); }
.empty { color: oklch(0.55 0.03 258); text-align: center; padding: 20px 0; }
.no-print { display: none; }
</style></head><body>
<div class="pfoot">${companyName}</div>
<h1>${companyName}采购数据汇报材料</h1>
<p class="meta">${new Date().toLocaleDateString('zh-CN')}</p>
<div class="kpis">${[
    ['预算总金额', s.totalBudgetLabel], ['已成交预算', s.awardedBudgetLabel], ['成交总额', s.totalAwardLabel],
    ['节约资金', s.totalSavingsLabel], ['节资率', `${savingsRate}%`], ['成交率', `${doneRate}%（${s.completedCount}/${s.totalCount}）`],
  ].map(([l, v]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
${aiBlock}
<section class="card"><h2>一、节约资金排行</h2>${tableHtml(['项目', '部门', '方式', '控制金额', '成交金额', '节约', '节约率'], data.savingsRanking.slice(0, 10).map(r => [r.project, r.department, r.method, r.controlAmountLabel, r.awardAmountLabel, r.savingsLabel, `${r.savingsRate}%`]), [24, 13, 13, 13, 13, 12, 12])}${note('savings')}</section>
<section class="card"><h2>二、采购执行趋势</h2>${trendSvg(data.trendSeries)}${note('trend')}</section>
<section class="card"><h2>三、${dimLabel}采购分析</h2>${hbarsHtml([...dimStats].sort((a, b) => b.amount - a.amount).slice(0, 10).map(d => ({ label: d.name, value: d.amount })), fmtWanPdf)}${note('department')}</section>
<section class="card"><h2>四、采购方式分布</h2>${donutSvg(data.methodStats, '总项目')}${note('method')}</section>
<section class="card"><h2>五、项目规模分析</h2>${hbarsHtml(scaleItems, v => `${v} 项`)}${note('scale')}</section>
<section class="card"><h2>六、重点供应商动态</h2>${tableHtml(['供应商', '参与', '中标', '中标率', '累计成交'], data.supplierStats.slice(0, 8).map(x => [x.name, `${x.participatedCount} 次`, `${x.winCount} 次`, `${x.hitRate}%`, x.awardAmountLabel]))}${note('supplier')}</section>
</body></html>`;
  const w = window.open('', '_blank', 'width=1080,height=860');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* 用户可手动 Ctrl+P */ } }, 400);
}

/** 汇报小节：编号徽标 + 面板（复用数据库页组件，自带题名）+ AI 说明（失败回退模板要点） */
function Section({ n, note, children }: { n: number; note: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="report-sheet break-inside-avoid">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold text-white" style={{ background: 'var(--accent)' }}>{n}</span>
      </div>
      <div className="mb-3 min-h-[240px]">{children}</div>
      <div className="rounded-[10px] bg-[color-mix(in_oklch,var(--accent)_5%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--foreground)]"><strong className="text-[var(--accent)]">说明：</strong>{note}</div>
    </section>
  );
}

export function ReportMaterialModal({ open, onClose, data, companyId }: {
  open: boolean; onClose: () => void; data: DashboardData | null; companyId: string;
}) {
  const [ai, setAi] = useState<ReportMaterialResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);

  /* 富载荷（比页面 AI 更宽：趋势含立项/归档、部门含完成率、规模分层/节资榜/供应商明细） */
  const payload = useMemo(() => {
    if (!data) return null;
    const scaleSegments = [
      { label: '小额', range: '<10万', min: 0, max: 100000 }, { label: '中小', range: '10-50万', min: 100000, max: 500000 },
      { label: '中型', range: '50-200万', min: 500000, max: 2000000 }, { label: '大型', range: '>200万', min: 2000000, max: Infinity },
    ].map(seg => {
      let count = 0, amount = 0;
      data.trendSeries.forEach(t => t.projects.forEach(p => {
        const bs = String(p.budgetLabel || '');
        const b = bs.includes('万') ? parseFloat(bs.replace('万', '').replace(/,/g, '').trim()) * 10000 : parseFloat(bs.replace('元', '').replace(/,/g, '')) || 0;
        if (b >= seg.min && b < seg.max) { count++; amount += b; }
      }));
      return { label: seg.label, range: seg.range, count, amountLabel: amount >= 10000 ? `${(amount / 10000).toFixed(1)}万` : `${amount.toFixed(0)}元`, share: data.summary.totalCount > 0 ? Math.round((count / data.summary.totalCount) * 100) : 0 };
    });
    return {
      startDate: data.range.startDate ?? undefined,
      endDate: data.range.endDate ?? undefined,
      rangeLabel: `${data.range.startDate && data.range.endDate ? `${data.range.startDate} ~ ${data.range.endDate}` : '全部区间'}（区间末端尚未开标的项目为正常在途采购，不属于异常或风险）`,
      // 权威比率随载荷下发（2026-11-17：LLM 自行除法有舍入漂移——15.148% 被写成 15.2%）
      summary: {
        ...data.summary,
        savingsRate: `${data.summary.awardedBudget > 0 ? ((data.summary.totalSavings / data.summary.awardedBudget) * 100).toFixed(1) : '0'}%`,
        doneRate: `${data.summary.totalCount > 0 ? Math.round((data.summary.completedCount / data.summary.totalCount) * 100) : 0}%`,
      },
      trendSeries: data.trendSeries.map(t => ({ label: t.label, count: t.count, amount: t.amount, initiated: t.initiated, archived: t.archived, active: t.active })),
      // 视角迁移（2026-11-17 用户裁定）：全部公司时本维度送公司统计（AI 按公司解读）；单公司送部门
      departmentStats: (companyId === 'all' ? data.companyStats : data.departmentStats).map(d => ({ name: d.name, amountLabel: d.amountLabel, completedRate: d.completedRate, topMethod: d.topMethod, projectCount: d.projects.length })),
      methodStats: data.methodStats.map(m => ({ name: m.name, count: m.count, amountLabel: m.amountLabel, share: m.share })),
      scaleSegments,
      savingsRanking: data.savingsRanking.slice(0, 5).map(r => ({ project: r.project, method: r.method, savingsLabel: r.savingsLabel, savingsRate: r.savingsRate, controlAmountLabel: r.controlAmountLabel, awardAmountLabel: r.awardAmountLabel })),
      supplierStats: data.supplierStats.slice(0, 6).map(s => ({ name: s.name, participatedCount: s.participatedCount, winCount: s.winCount, hitRate: s.hitRate, awardAmountLabel: s.awardAmountLabel })),
    };
  }, [data]);

  useEffect(() => {
    if (!open || !payload || !data) return;
    let cancelled = false;
    setAi(null); setAiError(false); setAiLoading(true);
    (async () => {
      try {
        // 缓存优先（2026-11-17 用户裁定：数据未变直接命中，不再每次请求 LLM）
        const cache = await fetchReportMaterialCache(companyId, data.range.startDate ?? undefined, data.range.endDate ?? undefined);
        if (!cancelled && cache.hit && cache.result) { setAi(cache.result); setAiLoading(false); return; }
        const res = await fetchReportMaterialAnalysis(payload, companyId);
        if (!cancelled) setAi(res);
      } catch {
        if (!cancelled) setAiError(true);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, payload, companyId]);

  const suppliers: SupplierDetail[] = useMemo(
    () => data ? data.supplierStats.map(s => ({ ...s, id: s.name })) : [],
    [data],
  );

  /* 署名随公司选择器（2026-11-17 用户裁定）：全部=「集团及各子公司」；
     单公司=公司名；多公司（逗号分隔）=「、」连接。数据源同 CompanySelect。 */
  const [companyName, setCompanyName] = useState('集团及各子公司');
  useEffect(() => {
    if (!open) return;
    if (companyId === 'all') { setCompanyName('集团及各子公司'); return; }
    let cancelled = false;
    api.get<Array<{ id: string; name: string }>>('/companies')
      .then(list => {
        if (cancelled) return;
        const names = companyId.split(',').map(id => list.find(c => c.id === id.trim())?.name).filter(Boolean) as string[];
        setCompanyName(names.length > 0 ? names.join('、') : '集团及各子公司');
      })
      .catch(() => { if (!cancelled) setCompanyName('集团及各子公司'); });
    return () => { cancelled = true; };
  }, [open, companyId]);

  if (!data) return null;
  const s = data.summary;
  const doneRate = s.totalCount > 0 ? Math.round((s.completedCount / s.totalCount) * 100) : 0;
  // 节资率分母=已成交预算（2026-11-17 用户裁定：未成交项目不计入——与数据库页 sr 同口径）
  const savingsRate = s.awardedBudget > 0 ? (s.totalSavings / s.awardedBudget) * 100 : 0;

  /* —— 各维度数据要点（说明文字，前端确定性计算）—— */
  const S = data.trendSeries;
  const totalAmount = S.reduce((x, t) => x + t.amount, 0);
  const peak = S.reduce((m, t) => (t.amount > m.amount ? t : m), S[0] ?? { label: '—', amount: 0, count: 0 } as never);
  const lastActive = [...S].reverse().find(t => t.count > 0);
  const trendNote = S.length
    ? `区间共 ${S.length} 个统计桶、采购 ${s.totalCount} 项、成交金额合计 ${totalAmount.toFixed(1)} 万元。成交金额峰值出现在 ${peak.label}（${peak.amount.toFixed(1)} 万元）；最近有采购活动的月份为 ${lastActive?.label ?? '—'}。副带柱体上行为立项节点、下行为归档节点，虚线阶梯为在执行净值（累计立项减累计归档）。`
    : '区间内暂无采购活动。';
  const dimStats = companyId === 'all' ? data.companyStats : data.departmentStats;
  const deptTop = dimStats[0];
  const deptTop2 = dimStats[1];
  const dimLabel = companyId === 'all' ? '公司' : '部门';
  const deptNote = dimStats.length
    ? `共 ${dimStats.length} 个${dimLabel}发生采购。${deptTop ? `${deptTop.name} 金额最高（${deptTop.amountLabel}，完成率 ${deptTop.completedRate}%，主要方式 ${deptTop.topMethod || '—'}）` : ''}${deptTop2 ? `；其次为 ${deptTop2.name}（${deptTop2.amountLabel}）` : ''}。完成率=该${dimLabel}已成交项目占其项目总数的比例。`
    : `暂无${dimLabel}数据。`;
  const mTop = data.methodStats[0];
  const mTop2 = data.methodStats[1];
  const methodNote = data.methodStats.length
    ? `${mTop ? `最主要采购方式为 ${mTop.name}（${mTop.count} 项、占 ${mTop.share}%、金额 ${mTop.amountLabel}）` : ''}${mTop2 ? `，其次 ${mTop2.name}（${mTop2.share}%）` : ''}。方式结构反映采购合规路径的分布，占比随公司采购制度要求动态变化。`
    : '暂无方式数据。';
  const segsOf = (min: number, max: number) => data.trendSeries.reduce((n, t) => n + t.projects.filter(p => {
    const bs = String(p.budgetLabel || ''); let b = 0;
    if (bs.includes('万')) b = parseFloat(bs.replace('万', '').replace(/,/g, '').trim()) * 10000; else b = parseFloat(bs.replace('元', '').replace(/,/g, '')) || 0;
    return b >= min && b < max;
  }).length, 0);
  const smallN = segsOf(0, 100000), midN = segsOf(100000, 2000000), bigN = segsOf(2000000, Infinity);
  const scaleNote = `按预算金额四档分层：小额（<10 万）${smallN} 项、中小/中型（10-200 万）${segsOf(100000, 500000) + segsOf(500000, 2000000)} 项、大型（>200 万）${bigN} 项。小额高频与大型低频的结构是否符合业务预期，可结合部门与方式分布交叉解读。`;
  const rankTop = data.savingsRanking[0];
  const rankNote = data.savingsRanking.length
    ? `按节约资金（控制金额 − 成交金额）排序的 Top 项目。${rankTop ? `节约最多的是「${rankTop.project.slice(0, 24)}」（${rankTop.savingsLabel}，节约率 ${rankTop.savingsRate}%，方式 ${rankTop.method}）` : ''}；区间合计节约 ${s.totalSavingsLabel}、节资率 ${savingsRate.toFixed(1)}%。`
    : '暂无节约数据（需已成交项目）。';
  const supTop = data.supplierStats[0];
  const supNote = data.supplierStats.length
    ? `${supTop ? `${supTop.name} 中标 ${supTop.winCount} 次（参与 ${supTop.participatedCount} 次、中标率 ${supTop.hitRate}%、累计 ${supTop.awardAmountLabel}）` : ''}。卡片展示参与/中标活跃度与主要活跃部门，供供应商集中度研判。`
    : '暂无供应商参与数据。';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="4xl"
      icon={<FileDown size={14} />}
      title="采购数据汇报材料"
      description={new Date().toLocaleDateString('zh-CN')}
      footer={
        <>
          <button onClick={onClose} className="neu-btn-soft">关闭</button>
          <button onClick={() => exportReportPdf(data, ai, companyName, companyId)} disabled={aiLoading} className="neu-btn-primary is-water !h-[38px] gap-1.5">
            <Printer size={14} /> {aiLoading ? '说明生成中…' : '导出 PDF'}
          </button>
        </>
      }
    >
      <div className="report-print-root flex flex-col gap-5">

        {/* KPI 摘要（复用数据库页 KpiCard 同款） */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
          <KpiCard label="预算总金额" value={s.totalBudgetLabel} signal="normal" index={1} reducedMotion />
          <KpiCard label="未成交预算" value={s.pendingBudgetLabel} signal={s.pendingBudget > 0 ? 'warning' : 'normal'} index={2} reducedMotion />
          <KpiCard label="已成交预算" value={s.awardedBudgetLabel} signal="success" index={3} reducedMotion />
          <KpiCard label="成交总额" value={s.totalAwardLabel} signal="normal" index={4} reducedMotion />
          <KpiCard label="节约资金" value={s.totalSavingsLabel} signal={s.totalSavings > 0 ? 'success' : 'normal'} index={5} reducedMotion />
          <KpiCard label="节资率" value={`${savingsRate.toFixed(1)}%`} signal={savingsRate > 5 ? 'success' : 'warning'} index={6} reducedMotion />
          <KpiCard label="已成交项目" value={`${s.completedCount}/${s.totalCount}`} index={7} reducedMotion />
          <KpiCard label="成交率" value={`${doneRate}%`} signal={doneRate >= 60 ? 'success' : 'normal'} index={8} reducedMotion />
        </div>

        {/* AI 综合分析 */}
        <section className="report-sheet">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--accent)]" />
            <h3 className="text-sm font-bold text-[var(--foreground)]">AI 综合分析</h3>
          </div>
          {aiLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[var(--muted-foreground)]"><Loader2 size={15} className="animate-spin" /> 正在生成整体分析与各板块说明…</div>
          ) : aiError ? (
            <p className="text-xs leading-5 text-[var(--muted-foreground)]">AI 分析暂不可用，各板块说明已回退为数据要点。</p>
          ) : ai && ai.overview ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-6 text-[var(--foreground)]">{ai.overview}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {([['主要亮点', ai.highlights, 'var(--success)'], ['关注事项', ai.concerns, 'var(--warning)'], ['工作建议', ai.suggestions, 'var(--accent)']] as const).map(([t, list, c]) => (
                  <div key={t}>
                    <div className="mb-1 text-[11px] font-bold" style={{ color: c }}>{t}</div>
                    <ul className="flex flex-col gap-1">
                      {list.slice(0, 5).map((x, i) => <li key={i} className="text-[11px] leading-5 text-[var(--muted-foreground)]">· {x}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* ① 节约资金排行（2026-11-17 用户裁定：提前至首位；说明 AI 生成） */}
        <Section n={1} note={aiLoading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在生成说明…</span> : (ai?.sections?.savings || rankNote)}>
          <SavingsRankingPanel items={data.savingsRanking as SavingsRankingItem[]} index={1} reducedMotion />
        </Section>

        {/* ② 采购执行趋势（复用 TrendChartPanel） */}
        <Section n={2} note={aiLoading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在生成说明…</span> : (ai?.sections?.trend || trendNote)}>
          <TrendChartPanel profile={data} index={2} reducedMotion />
        </Section>

        {/* ③ 维度采购分析（2026-11-17 用户裁定：全部公司=各公司视角；单公司=部门） */}
        <Section n={3} note={aiLoading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在生成说明…</span> : (ai?.sections?.department || deptNote)}>
          {companyId === 'all' ? (
            <section className="wb-panel h-full">
              <div className="wb-panel-header"><div className="flex items-center gap-2"><Building2 size={15} className="text-[var(--accent)]" /><h2 className="text-[0.92rem] font-semibold tracking-[-0.025em] text-[var(--foreground)]">各公司采购分析</h2></div></div>
              <div className="wb-panel-body flex flex-col justify-center gap-2.5 p-4">
                {[...data.companyStats].sort((a, b) => b.amount - a.amount).map(c => (
                  <div key={c.name} className="flex items-center gap-3">
                    <span className="w-[150px] shrink-0 truncate text-right text-[11px] text-[var(--muted-foreground)]" title={c.name}>{c.name}</span>
                    <div className="h-[16px] flex-1 overflow-hidden rounded-[4px]" style={{ background: 'oklch(0.94 0.01 258)' }}>
                      <div className="h-full rounded-[4px]" style={{ width: `${Math.max(1.5, (c.amount / Math.max(...data.companyStats.map(x => x.amount), 1)) * 100)}%`, background: 'var(--accent)' }} />
                    </div>
                    <span className="w-[72px] shrink-0 text-[11px] font-semibold tabular-nums text-[var(--foreground)]">{c.amountLabel}</span>
                  </div>
                ))}
                {data.companyStats.length === 0 && <div className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无公司数据</div>}
              </div>
            </section>
          ) : (
            <DepartmentPanel profile={data} index={3} reducedMotion />
          )}
        </Section>

        {/* ④ 采购方式分布（复用 MethodPieChartPanel） */}
        <Section n={4} note={aiLoading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在生成说明…</span> : (ai?.sections?.method || methodNote)}>
          <MethodPieChartPanel profile={data} index={4} reducedMotion />
        </Section>

        {/* ⑤ 项目规模分析（复用 ProjectScalePanel） */}
        <Section n={5} note={aiLoading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在生成说明…</span> : (ai?.sections?.scale || scaleNote)}>
          <ProjectScalePanel profile={data} index={5} reducedMotion />
        </Section>

        {/* ⑥ 重点供应商动态（复用 SupplierCards） */}
        <Section n={6} note={aiLoading ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在生成说明…</span> : (ai?.sections?.supplier || supNote)}>
          <SupplierCards suppliers={suppliers} index={6} reducedMotion />
        </Section>

      </div>
    </Modal>
  );
}
