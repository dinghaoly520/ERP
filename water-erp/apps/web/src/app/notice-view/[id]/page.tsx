'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getAnnouncement } from '@/lib/api/announcement';
import type { AnnouncementListItem, AnnouncementType, AnnouncementStatus } from '@/lib/api/announcement';
import { StatusBadge } from '@/components/workbench';
import { PhoneCall, Megaphone } from 'lucide-react';
import { DATA_CLASS_LABELS } from '@water-erp/shared';

/* ── 只读门户视角（2026-09-26）：回收站「查看」与对外展示用——纯公告本体，零管理操作 ── */

const typeTone: Record<AnnouncementType, 'blue' | 'green' | 'orange' | 'gray'> = {
  BID_NOTICE: 'blue', ADDENDUM: 'orange', PREQUAL_NOTICE: 'blue', PRE_WIN_NOTICE: 'green', WIN_NOTICE: 'green', CONTRACT_NOTICE: 'blue', PERFORMANCE_NOTICE: 'green', POLICY: 'orange', PLATFORM: 'gray', FAILED_BID_NOTICE: 'orange', WIN_BID_NOTICE: 'green',
};
const typeLabel: Record<AnnouncementType, string> = {
  BID_NOTICE: '采购公告', ADDENDUM: '补遗公告', PREQUAL_NOTICE: '资格预审公告', PRE_WIN_NOTICE: '中标公示', WIN_NOTICE: '成交公告', CONTRACT_NOTICE: '合同公告', PERFORMANCE_NOTICE: '履行结果公告', POLICY: '政策法规', PLATFORM: '平台通知', FAILED_BID_NOTICE: '流标公告', WIN_BID_NOTICE: '中标公告',
};
const statusTone: Record<AnnouncementStatus, 'green' | 'gray'> = {
  DRAFT: 'gray', PUBLISHED: 'green', ARCHIVED: 'gray', HIDDEN: 'gray', OFFLINE: 'gray',
};
const statusLabel: Record<AnnouncementStatus, string> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已下线', HIDDEN: '已隐藏', OFFLINE: '已下架',
};

interface MetaField { key: string; label: string; area?: boolean; date?: boolean }
const TYPE_META: Record<AnnouncementType, MetaField[]> = {
  PREQUAL_NOTICE: [
    { key: 'title', label: '预审名称' }, { key: 'validUntil', label: '申请截止', date: true },
  ],
  ADDENDUM: [
    { key: 'projectCode', label: '项目编号' }, { key: 'changes', label: '澄清/修改内容', area: true },
    { key: 'newDeadline', label: '调整后递交截止', date: true },
  ],
  BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '招标方式' }, { key: 'budget', label: '预算金额' },
    { key: 'scope', label: '采购内容/范围', area: true }, { key: 'qualification', label: '投标人资格要求', area: true },
    { key: 'downloadDeadline', label: '采购文件下载时间' },
    { key: 'deadline', label: '报名/投标截止', date: true }, { key: 'openTime', label: '开标时间', date: true }, { key: 'contact', label: '联系方式' },
  ],
  PRE_WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '预成交供应商' }, { key: 'amount', label: '预成交价格' },
    { key: 'period', label: '工期/交货期/服务期限' }, { key: 'publicityPeriod', label: '公示期' }, { key: 'objection', label: '异议渠道', area: true },
  ],
  WIN_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'winner', label: '成交供应商' }, { key: 'amount', label: '成交金额' },
    { key: 'period', label: '工期/交货期' }, { key: 'quality', label: '质量标准' }, { key: 'experts', label: '评审专家' },
    { key: 'publicityPeriod', label: '公示期' }, { key: 'objection', label: '异议渠道', area: true },
  ],
  CONTRACT_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'contractCode', label: '合同编号' }, { key: 'supplierName', label: '成交供应商' },
    { key: 'amount', label: '合同价款' }, { key: 'signedAt', label: '签约时间', date: true },
  ],
  PERFORMANCE_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'supplierName', label: '成交供应商' }, { key: 'result', label: '履行结果' },
  ],
  POLICY: [
    { key: 'docNo', label: '文号' }, { key: 'issuer', label: '发布机关' }, { key: 'effectiveDate', label: '生效日期' },
    { key: 'scope', label: '适用范围', area: true },
  ],
  PLATFORM: [
    { key: 'impactScope', label: '影响范围' }, { key: 'changes', label: '功能变化', area: true }, { key: 'schedule', label: '时间安排' },
    { key: 'guide', label: '操作指引', area: true }, { key: 'support', label: '支持渠道' },
  ],
  FAILED_BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '采购方式' }, { key: 'budget', label: '最高限价' },
    { key: 'openTime', label: '开标时间' }, { key: 'resultInfo', label: '开标结果公示信息', area: true },
  ],
  WIN_BID_NOTICE: [
    { key: 'projectCode', label: '项目编号' }, { key: 'method', label: '采购方式' }, { key: 'budget', label: '最高限价' },
    { key: 'openTime', label: '开标时间' }, { key: 'bidder1Name', label: '中标供应商' }, { key: 'bidder1Price', label: '中标价格' },
    { key: 'remark', label: '备注' },
  ],
};

/** 结构化元数据芯片（纯展示，与 :3005 编辑页同源逻辑） */
function MetaBlock({ ann }: { ann: AnnouncementListItem }) {
  const meta = (ann.metadata || {}) as Record<string, any>;
  const hasVal = (f: { key: string }) => !!meta[f.key] || (f.key === 'amount' && meta.winner?.price != null);
  const allFields = (TYPE_META[ann.type] || []).filter(hasVal);
  if (allFields.length === 0) return null;
  const shortFields = allFields.filter(f => !f.area);
  const areaFields = allFields.filter(f => f.area);
  return (
    <div style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)', paddingTop: '0.75rem' }}>
      <div className="flex flex-col gap-2.5">
        {shortFields.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {shortFields.map(f => {
              let raw = meta[f.key];
              if (f.key === 'amount' && !raw && meta.winner?.price != null) raw = meta.winner.price;
              if (raw && typeof raw === 'object') {
                raw = Array.isArray(raw)
                  ? raw.map((x: any) => x?.supplierName ?? x?.name ?? '').filter(Boolean).join('、')
                  : (raw.supplierName ?? raw.name ?? JSON.stringify(raw));
              }
              let display = raw;
              if (f.date && raw) {
                const parsed = new Date(raw);
                display = Number.isNaN(parsed.getTime())
                  ? '待定'
                  : parsed.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
              }
              if ((f.key === 'budget' || f.key === 'amount') && raw) {
                const n = Number(raw);
                if (!isNaN(n) && n >= 10000) display = (n / 10000).toFixed(0) + ' 万元';
              }
              const isCode = f.key === 'projectCode' || f.key === 'docNo';
              const isMoney = f.key === 'budget' || f.key === 'amount';
              const isDate = f.date;
              const labelColor = isCode ? 'text-[var(--accent)]' : isMoney ? 'text-[var(--success)]' : isDate ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)]';
              const valueClass = isCode ? 'text-[var(--accent-strong)] font-mono tracking-[-0.02em]' : isMoney ? 'text-[var(--success)] font-black text-[0.85rem] tabular-nums' : 'text-[var(--foreground)]';
              return (
                <span key={f.key} className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--surface)] px-3 py-1.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.55),1px_1px_2px_oklch(0.55_0.03_258/0.06),-1px_-1px_1px_oklch(1_0_0/0.7)]">
                  <span className={'text-[0.65rem] font-bold uppercase tracking-[0.08em] ' + labelColor}>{f.label}</span>
                  <span className={'text-[0.75rem] font-semibold ' + valueClass}>{display}</span>
                </span>
              );
            })}
          </div>
        )}
        {areaFields.map(f => (
          <div key={f.key} className="rounded-[10px] bg-[var(--accent-soft)]/20 px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.4),inset_1px_1px_3px_oklch(0.55_0.03_258/0.06),inset_-1px_-1px_3px_oklch(1_0_0/0.6)]">
            <span className="text-[0.6rem] font-bold uppercase tracking-[0.1em] text-[var(--accent-strong)]/70">{f.label}</span>
            <p className="mt-1.5 text-[0.78rem] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap">{meta[f.key]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnnouncementPublicViewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ann, setAnn] = useState<AnnouncementListItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAnnouncement(id).then(setAnn).catch(() => setAnn(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="text-sm text-[var(--muted-foreground)]">正在加载公告…</div>
    </div>
  );

  if (!ann) return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Megaphone size={24} className="text-[var(--muted-foreground)]" />
      <p className="text-sm font-semibold text-[var(--foreground)]">公告不存在或无权访问</p>
      <button onClick={() => router.push('/notice')} className="neu-btn-soft">返回公告列表</button>
    </div>
  );

  const objectionContact = String(ann.metadata?.objectionContact ?? '').trim();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* ══ 标题卡片（门户视角：徽标 + 标题 + 元信息，无任何操作按钮）══ */}
        <div className="page-hero">
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon">
                <Megaphone size={17} />
              </div>
              <div className="min-w-0">
                <div className="page-hero__title truncate">{ann.title}</div>
                <div className="page-hero__sub">
                  {ann.type === 'BID_NOTICE' && typeof ann.metadata?.method === 'string' && ann.metadata.method.trim() ? ann.metadata.method.trim() : typeLabel[ann.type]}
                  {ann.publishDate && <span> · {new Date(ann.publishDate).toLocaleDateString('zh-CN')} 发布</span>}
                  <span> · 浏览 {ann.viewCount}</span>
                </div>
              </div>
            </div>
            <div className="page-hero__right">
              <div className="flex items-center gap-1.5">
                <StatusBadge tone={typeTone[ann.type]}>{ann.type === 'BID_NOTICE' && typeof ann.metadata?.method === 'string' && ann.metadata.method.trim() ? ann.metadata.method.trim() : typeLabel[ann.type]}</StatusBadge>
                <StatusBadge tone={statusTone[ann.status]}>{statusLabel[ann.status]}</StatusBadge>
                {ann.isTop && <StatusBadge tone="red">置顶</StatusBadge>}
                {ann.dataClass && (
                  <StatusBadge tone={ann.dataClass === 'confidential' ? 'red' : 'gray'}>
                    {DATA_CLASS_LABELS[ann.dataClass as keyof typeof DATA_CLASS_LABELS] ?? ann.dataClass}
                  </StatusBadge>
                )}
              </div>
            </div>
          </div>

          {/* 结构化元数据 */}
          <MetaBlock ann={ann} />
        </div>

        {/* ══ AI 摘要（只读，仅在有值时展示）══ */}
        {ann.aiSummary && (
          <div className="neu-table-card mt-5 p-5">
            <div className="mb-2 text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">AI 摘要</div>
            <p className="text-[0.85rem] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-words">{ann.aiSummary}</p>
          </div>
        )}

        {/* ══ 正文 ══ */}
        <div className="neu-table-card mt-5 p-5 sm:p-6">
          {ann.content ? (
            <div
              className="prose prose-sm text-[var(--foreground)] leading-relaxed break-words [&_table]:w-full [&_table]:border-collapse [&_table_td]:border [&_table_td]:border-[var(--border)] [&_table_td]:px-3 [&_table_td]:py-2 [&_table_td]:break-all [&_table_th]:border [&_table_th]:border-[var(--border)] [&_table_th]:px-3 [&_table_th]:py-2 [&_table_th]:bg-[var(--muted)]/60 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              dangerouslySetInnerHTML={{ __html: ann.content }}
            />
          ) : (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无正文内容</p>
          )}
        </div>

        {/* ══ 异议联系方式（对齐 :3002 门户展示）══ */}
        {objectionContact && (() => {
          const isHtml = /<[a-z][\s\S]*>/i.test(objectionContact);
          return (
            <div className="neu-table-card mt-5 p-5">
              <div className="mb-2 flex items-center gap-2">
                <PhoneCall size={14} className="text-[var(--accent)]" />
                <span className="text-sm font-bold text-[var(--accent-strong)]">异议联系方式</span>
              </div>
              {isHtml ? (
                <div className="text-[0.85rem] leading-relaxed text-[var(--foreground)]" dangerouslySetInnerHTML={{ __html: objectionContact }} />
              ) : (
                <p className="text-[0.85rem] leading-relaxed whitespace-pre-wrap text-[var(--foreground)]">{objectionContact}</p>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
