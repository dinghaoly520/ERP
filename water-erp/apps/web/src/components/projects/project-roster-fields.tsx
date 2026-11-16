'use client';

import { Crown, Building2 } from 'lucide-react';
import { StatusBadge } from '@/components/workbench';

/**
 * 项目名册展示件（2026-11-16 自 project-detail-panel 抽出共用）：评审专家名单表 +
 * 参与供应商名单列表——纯展示（2026-11-13 用户裁定：项目基本信息两处不允许编辑）。
 * 消费方：项目管理详情面板、采购台账详情展开区（统一两处呈现）。
 */

export const cleanMulti = (v?: string | null): string => {
  if (!v?.trim()) return '—';
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of v.replace(/[（）()]/g, '').split(/[、，,;；]/)) {
    const t = raw.trim();
    if (t && !seen.has(t)) { seen.add(t); items.push(t); }
  }
  return items.length ? items.join('、') : '—';
};

export function ExpertInfoField({ value }: { value: string | null | undefined }) {
  // 2026-11-12 用户裁定：项目基本信息·评审专家名单不允许编辑——编辑弹窗与增删行机器整体移除，
  // 纯展示名单表（名单维护走专家抽取/替换流程，不走基本信息手编）
  const hasValue = value !== null && value !== undefined && value !== '';

  // Parse experts from a pipe-delimited string: "姓名|部门|专业|职称|角色" per line. 续行合并
  //（2026-10-27 实录：存量多值专业含换行拆出假行）——不足 4 竖线的行与下一行顿号续接凑齐 5
  // 字段才出记录；写入侧已清杀字段内换行，此为存量兜底。
  const parseExperts = (raw: string | null | undefined) => {
    if (!raw || !raw.trim()) return [];
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const records: string[] = [];
    let buf = '';
    for (let i = 0; i < lines.length; i++) {
      buf = buf ? `${buf}、${lines[i]}` : lines[i];
      if ((buf.match(/\|/g) || []).length >= 4 || i === lines.length - 1) { records.push(buf); buf = ''; }
    }
    if (buf) records.push(buf);
    return records.map(line => {
      const parts = line.split('|');
      return {
        name: (parts[0] ?? '').trim(),
        department: (parts[1] ?? '').trim(),
        specialty: (parts[2] ?? '').trim(),
        title: (parts[3] ?? '').trim(),
        role: (parts[4] ?? '').trim(),
      };
    });
  };

  const experts = parseExperts(hasValue ? String(value) : null);

  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">评审专家名单</span>
      </div>
      {hasValue && experts.length > 0 ? (
        <div className="overflow-x-auto rounded-[10px]" style={{ background: 'oklch(1 0 0 / 0.3)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
          <table className="neu-table w-full min-w-[500px]">
            <thead>
              <tr>
                <th className="text-center" style={{ width: 24 }}>#</th>
                <th className="text-center" style={{ width: '22%', minWidth: 120 }}>专家</th>
                <th className="text-center">部门</th>
                <th className="text-center">专业</th>
                <th className="text-center">职称</th>
                <th className="text-center" style={{ width: 80 }}>角色</th>
              </tr>
            </thead>
            <tbody>
              {experts.map((expert, i) => (
                <tr key={i}>
                  <td className="text-center tabular-nums" style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)', verticalAlign: 'top' }}>{i + 1}</td>
                  <td className="font-medium text-center" style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--foreground)', verticalAlign: 'top' }}>
                    <span className="inline-flex items-center gap-1">{expert.name}{(expert as any).role?.includes('组长') ? <span title="评审组长"><Crown size={12} className="text-[#7c3aed]" aria-label="评审组长" /></span> : null}</span>
                  </td>
                  <td className="text-center" style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)', verticalAlign: 'top' }}>{cleanMulti(expert.department)}</td>
                  <td className="text-center" style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)', verticalAlign: 'top' }}>{cleanMulti(expert.specialty)}</td>
                  <td className="text-center" style={{ paddingTop: 6, paddingBottom: 6, fontSize: 13, color: 'var(--muted-foreground)', verticalAlign: 'top' }}>{cleanMulti(expert.title)}</td>
                  <td className="text-center" style={{ paddingTop: 6, paddingBottom: 6, verticalAlign: 'top' }}>{((expert as any).role === '候补' || (expert as any).role === '补选') ? <StatusBadge tone="orange">候补</StatusBadge> : ((expert as any).role ? <StatusBadge tone="blue">正选</StatusBadge> : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-[color:var(--muted-foreground)]/50">待补充</div>
      )}
    </div>
  );
}

export function BiddingUnitsField({ label, value }: { label: string; value: string | number | null | undefined }) {
  // 2026-11-12 用户裁定：项目基本信息·供应商参与/邀请不允许编辑——编辑弹窗与增删行机器
  // 整体移除，纯展示名单（参与名单=公告自动收集∪项目登记；邀请名单走供应商邀请流程卡）
  const hasValue = value !== null && value !== undefined && value !== '';
  const units = hasValue ? String(value).split(/[、,\n]/).filter(u => u.trim()) : [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">{label}</span>
      </div>
      {units.length > 0 ? (
        <div className="space-y-1.5">
          {units.map((unit, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-[color:var(--foreground)]"
              style={{
                background: 'color-mix(in oklch, var(--accent) 4%, oklch(1 0 0 / 0.5))',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.55), 1px 1px 2px oklch(0.55 0.03 258 / 0.06)',
              }}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-[9px] font-bold text-white tabular-nums"
                style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>
                {i + 1}
              </span>
              <Building2 size={13} className="shrink-0 text-[color:var(--accent)]" />
              <span className="min-w-0 truncate">{unit.trim()}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[color:var(--muted-foreground)]/50">待补充</div>
      )}
    </div>
  );
}
