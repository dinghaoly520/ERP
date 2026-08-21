'use client';

import { useEffect, useState } from 'react';
import { getApprovalHistory } from '@/lib/api/supplier';
import type { ApprovalRecord } from '@/lib/api/supplier';
import { Loader2, CheckCircle2, XCircle, RotateCcw, FileText, Paperclip } from 'lucide-react';

/** 快照日期格式化（ISO 字符串 → zh-CN 日期）；空值/非法值返回空串由调用侧兜底 */
function fmtDate(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN');
}

const ACTION_META: Record<string, { label: string; color: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  APPROVED: { label: '审核通过', color: 'var(--success)', icon: CheckCircle2 },
  REJECTED: { label: '审核不通过', color: 'var(--danger)', icon: XCircle },
  RETURNED: { label: '退回补正', color: 'var(--warning)', icon: RotateCcw },
};

/** 供应商审核历史（不可变留痕）：验证人 + 是否同意 + 时间 + 理由 + 申请完整快照 */
export function ApprovalHistory({ supplierId }: { supplierId: string }) {
  const [records, setRecords] = useState<ApprovalRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getApprovalHistory(supplierId).then(setRecords).catch(() => setRecords([])).finally(() => setLoading(false));
  }, [supplierId]);

  if (loading) {
    return <div className="py-8 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="animate-spin mx-auto mb-2" />加载审核历史…</div>;
  }
  if (!records || records.length === 0) {
    return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">暂无审核记录</p>;
  }

  return (
    <div className="space-y-3">
      {records.map(r => {
        const meta = ACTION_META[r.action] || { label: r.action, color: 'var(--muted-foreground)', icon: FileText };
        const Icon = meta.icon;
        const isExpanded = expanded === r.id;
        return (
          <div key={r.id} className="rounded-xl border border-[var(--border)] overflow-hidden">
            {/* 头部：结论 + 验证人 + 时间 + 理由 */}
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)] transition-colors"
              onClick={() => setExpanded(isExpanded ? null : r.id)}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full shrink-0" style={{ backgroundColor: `color-mix(in oklch, ${meta.color} 16%, transparent)`, color: meta.color }}>
                <Icon size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: meta.color }}>{meta.label}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">验证人：{r.reviewer?.displayName || r.reviewer?.username || '—'}</span>
                </div>
                <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {new Date(r.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {r.reason && <span className="ml-2">理由：{r.reason}</span>}
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[var(--muted-foreground)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
            </button>

            {/* 展开的申请快照 */}
            {isExpanded && (
              <div className="border-t border-[var(--border)] px-4 py-4 bg-[color-mix(in_oklch,var(--foreground)_1.5%,transparent)]">
                {/* 注册 2.0：logo（旧快照无此字段则不渲染） */}
                {r.snapshot.logoUrl && (
                  <img src={r.snapshot.logoUrl} alt="公司 logo" className="mb-3 h-12 w-12 rounded-lg bg-[var(--muted)]/20 object-cover" />
                )}
                <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <SnapshotItem label="企业名称" value={r.snapshot.name} />
                  <SnapshotItem label="供应商编号" value={r.snapshot.supplierNo} mono />
                  <SnapshotItem label="统一社会信用代码" value={r.snapshot.creditCode} mono />
                  <SnapshotItem label="机构代码" value={r.snapshot.organizationCode} mono />
                  <SnapshotItem label="企业类型" value={r.snapshot.enterpriseType} />
                  <SnapshotItem label="所属行业" value={r.snapshot.industry} />
                  <SnapshotItem label="法定代表人" value={r.snapshot.legalPerson} />
                  <SnapshotItem label="法定代表人身份证号" value={r.snapshot.legalPersonIdCard} mono />
                  <SnapshotItem label="法人联系电话" value={r.snapshot.legalPersonPhone} mono />
                  <SnapshotItem label="注册资本" value={r.snapshot.registeredCapital} />
                  <SnapshotItem label="国别" value={r.snapshot.country} />
                  <SnapshotItem label="行政区域" value={r.snapshot.region} />
                  <SnapshotItem label="公司邮箱" value={r.snapshot.companyEmail} />
                  <SnapshotItem label="公司官网" value={r.snapshot.companyWebsite} />
                  <SnapshotItem label="注册地址" value={r.snapshot.registeredAddress} full />
                  <SnapshotItem label="详细地址" value={r.snapshot.detailedAddress} full />
                  <SnapshotItem label="经营范围" value={r.snapshot.businessScope} full />
                  <SnapshotItem label="业务标签" value={r.snapshot.tags?.join('、')} full />
                  <SnapshotItem label="注册类型" value={r.snapshot.isTemporary ? '临时供应商' : '正式供应商'} />
                </dl>

                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">联系人</p>
                  <div className="space-y-1">
                    {(r.snapshot.contacts ?? []).map((c, i) => (
                      <div key={i} className="text-xs text-[var(--muted-foreground)]">
                        {c.name}{c.gender ? ` · ${c.gender}` : ''} · {c.phone}{c.idCard ? ` · 身份证 ${c.idCard}` : ''}{c.isPrimary ? ' · 主要' : ''}{c.position ? ` · ${c.position}` : ''}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">资质材料（{(r.snapshot.qualifications ?? []).length}）</p>
                  <div className="space-y-1">
                    {(r.snapshot.qualifications ?? []).map((q, i) => (
                      <div key={i} className="text-xs text-[var(--muted-foreground)]">
                        {q.type} · {q.name}{q.validFrom || q.validTo ? ` · ${fmtDate(q.validFrom) || '…'} ~ ${fmtDate(q.validTo) || '…'}` : ''}
                        {/* 注册 2.0：资质文件 + 附加材料链接（旧快照无则不渲染） */}
                        {(q.fileUrl || (Array.isArray(q.attachments) && q.attachments.length > 0)) && (
                          <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {q.fileUrl && (
                              <a href={q.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">资质文件</a>
                            )}
                            {Array.isArray(q.attachments) && q.attachments.map((att, j) => (
                              <a key={j} href={att.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline">
                                <Paperclip size={10} />{att.name || `附件 ${j + 1}`}
                              </a>
                            ))}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 注册 2.0：银行账户（旧快照无此块则不渲染） */}
                {Array.isArray(r.snapshot.bankAccounts) && r.snapshot.bankAccounts.length > 0 && (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">银行账户（{r.snapshot.bankAccounts.length}）</p>
                    <div className="space-y-1">
                      {r.snapshot.bankAccounts.map((b, i) => (
                        <div key={b.id || i} className="text-xs text-[var(--muted-foreground)]">
                          {b.accountName} · {b.bankName}{b.bankBranch ? ` · ${b.bankBranch}` : ''} · <span className="font-mono">{b.accountNo}</span>{b.isDefault ? ' · 默认' : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 注册 2.0：主体业绩（旧快照无此块则不渲染） */}
                {Array.isArray(r.snapshot.performances) && r.snapshot.performances.length > 0 && (
                  <div className="mt-3 border-t border-[var(--border)] pt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">主体业绩（{r.snapshot.performances.length}）</p>
                    <div className="space-y-1">
                      {r.snapshot.performances.map((p, i) => (
                        <div key={p.id || i} className="text-xs text-[var(--muted-foreground)]">
                          {p.projectName}{p.clientName ? ` · ${p.clientName}` : ''}{p.contractAmount ? ` · ${p.contractAmount}` : ''}{p.signDate ? ` · ${fmtDate(p.signDate) || '…'}` : ''}
                          {Array.isArray(p.proofFiles) && p.proofFiles.length > 0 && (
                            <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              {p.proofFiles.map((f, j) => (
                                <a key={j} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline">
                                  <Paperclip size={10} />{f.name || `证明材料 ${j + 1}`}
                                </a>
                              ))}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SnapshotItem({ label, value, mono = false, full = false }: { label: string; value?: string | null; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <dt className="text-[11px] text-[var(--muted-foreground)]">{label}</dt>
      <dd className={`text-[13px] font-semibold text-[var(--foreground)] ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd>
    </div>
  );
}
