'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Archive, ClipboardCheck, Clock3, Download, FileArchive, History, PlayCircle, RefreshCw, ShieldCheck, Upload,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import { fetchCurrentUser } from '@/lib/api/auth';
import { apiFetch } from '@/lib/api/api-fetch';

/* ═══════════════════════════════════════════════════════════════
   归档管理（DA/T 103-2024）— 卷台账 / 四性检测 / ASIP 导出
   数据管理页标准三层：page-hero + 工具栏 + neu-table-card
   ═══════════════════════════════════════════════════════════════ */

type VolumeRow = {
  id: string;
  title: string;
  projectCode: string | null;
  currentStage: string;
  status: string;
  requesterDepartment: string | null;
  awardedSupplier: string | null;
  createdAt: string;
  retentionPeriod: 'PERMANENT' | 'Y30' | 'Y10' | null;
  archiveExportedAt: string | null;
  archiveRegistrationKey: string | null;
  stages: Array<{ stageKey: string; status: string; attachments: Array<{ id: string }> }>;
};

type SnapshotRow = {
  code: string; stage: string; materialName: string; sourceType: string;
  isRequired: boolean; status: 'MATCHED' | 'MISSING' | 'PENDING_GENERATED';
  attachmentIds: string[]; fileAssetIds: string[]; blocking: boolean;
};

type CheckResult = {
  overall: 'PASSED' | 'FAILED'; passedCount: number; failedCount: number;
  ranAt: string;
  details?: Array<{ code: string; materialName: string; check: string; status: string; message: string }>;
};

type AuditRow = {
  createdAt: string; username: string | null; method: string; path: string;
  statusCode: number; error: string | null;
};

const RETENTION_LABEL: Record<string, string> = { PERMANENT: '永久', Y30: '30 年', Y10: '10 年' };
const STAGE_LABEL: Record<string, string> = {
  PROCUREMENT_DEMAND: '采购需求', INITIATION: '采购立项', TENDER_DOCUMENT: '采购文件',
  SUPPLIER_INVITATION: '供应商邀请', PUBLIC_ANNOUNCEMENT: '公告公示', EXPERT_SELECTION: '专家抽取',
  BID_EVALUATION: '开标评标', AWARD_DECISION: '定标', CONTRACT: '合同', ARCHIVED: '已归档',
};
const SOURCE_LABEL: Record<string, string> = {
  attachment: '系统附件', fileAsset: '回流件', manual: '人工补传', generated: '系统生成',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/archive${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json();
}

function ArchivePageInner() {
  const params = useSearchParams();
  const focusPmi = params.get('pmi');

  const [rows, setRows] = useState<VolumeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportedFilter, setExportedFilter] = useState<'all' | 'yes' | 'no'>('all');

  // 质检弹窗
  const [inspect, setInspect] = useState<{ row: VolumeRow; snapshot: SnapshotRow[]; check: CheckResult | null } | null>(null);
  // 导出端点方法级 @Roles('admin','leader')——staff 点击必 403；按钮随角色隐藏（检测/质检类级含 staff 不受限）
  const [canExport, setCanExport] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchCurrentUser()
      .then((u) => { if (alive) setCanExport(u.role === 'admin' || u.role === 'leader'); })
      .catch(() => { if (alive) setCanExport(false); });
    return () => { alive = false; };
  }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null);
  const [registrationKey, setRegistrationKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ items: VolumeRow[]; total: number; exportedTotal?: number }>(`/items${exportedFilter !== 'all' ? `?exported=${exportedFilter}` : ''}`);
      setRows(r.items);
      setTotalVolumes(r.total);
      setExportedVolumes(r.exportedTotal ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [exportedFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }
  }, [toast]);

  // 归档待办直达：?pmi=xxx 自动开质检弹窗
  useEffect(() => {
    if (!focusPmi || rows.length === 0 || inspect) return;
    const row = rows.find((r) => r.id === focusPmi);
    if (row) void openInspect(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPmi, rows]);

  // 服务端全量口径（2026-09-28 审计 P2：此前以 rows.length 冒充总量，take 200 截断后失真）
  const [totalVolumes, setTotalVolumes] = useState(0);
  const [exportedVolumes, setExportedVolumes] = useState<number | null>(null);
  const stats = useMemo(() => ({
    total: totalVolumes || rows.length,
    // exported 服务端全量；pending 依赖卷内阶段明细，仅当前页推导（KPI 副标题口径）
    exported: exportedVolumes ?? rows.filter((r) => r.archiveExportedAt).length,
    pending: rows.filter((r) => !r.archiveExportedAt && (r.stages?.some((s) => ['AWARD_DECISION', 'CONTRACT'].includes(s.stageKey) && s.attachments.length > 0) ?? false)).length,
  }), [rows, totalVolumes, exportedVolumes]);

  async function openInspect(row: VolumeRow) {
    setBusy(row.id);
    try {
      const snapshot = await api<{ rows: SnapshotRow[] }>(`/items/${row.id}/snapshot`);
      const check = await api<CheckResult | null>(`/items/${row.id}/check-latest`);
      setInspect({ row, snapshot: snapshot.rows, check: check ?? null });
      // S2 审计 + D3 登记表状态（懒加载，失败不阻塞）
      api<AuditRow[]>(`/items/${row.id}/audit`).then(setAuditRows).catch(() => setAuditRows(null));
      setRegistrationKey(row.archiveRegistrationKey ?? null);
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function uploadRegistration(pmiId: string, file: File) {
    setBusy(pmiId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch(`/api/archive/items/${pmiId}/registration-scan`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Portal': 'web' },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? '上传失败');
      setRegistrationKey(body.objectKey);
      setToast('登记表扫描件已回传（纸电关联闭环）');
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function runCheck(pmiId: string) {
    setBusy(pmiId);
    try {
      const check = await api<CheckResult>(`/items/${pmiId}/check`, { method: 'POST' });
      if (inspect) setInspect({ ...inspect, check });
      setToast(`检测完成：${check.overall === 'PASSED' ? '全部通过' : `${check.failedCount} 项不合格`}`);
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function exportAsip(pmiId: string, retentionPeriod: VolumeRow['retentionPeriod'] = null) {
    setBusy(pmiId);
    try {
      // M2：不硬编码期限——已划定的保留原值（后端无参即不更新），未划定的默认 Y30。
      // 修复（2026-09-28 审计 P1）：此前行内导出恒传 Y30，已划定 PERMANENT/Y10 的卷被静默改写。
      const body = retentionPeriod ? {} : { retentionPeriod: 'Y30' as const };
      const r = await api<{ fileCount: number; zipSha256: string }>(`/items/${pmiId}/export-asip`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setToast(`归档信息包已导出（${r.fileCount} 件，指纹 ${r.zipSha256.slice(0, 12)}…）`);
      void load();
      if (inspect) void openInspect(inspect.row);
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setBusy(null);
    }
  }

  function download(pmiId: string) {
    window.open(`/api/archive/items/${pmiId}/package`, '_blank');
  }

  // 划定保管期限（§9.3 永久/30年/10年）——后端 PATCH /items/:pmiId/retention 此前前端零接线（2026-09-28 审计）
  const [retentionEdit, setRetentionEdit] = useState<VolumeRow | null>(null);
  const [retentionValue, setRetentionValue] = useState<'PERMANENT' | 'Y30' | 'Y10'>('Y30');
  const [retentionSaving, setRetentionSaving] = useState(false);
  async function saveRetention() {
    if (!retentionEdit) return;
    setRetentionSaving(true);
    try {
      await api<{ id: string; retentionPeriod: string }>(`/items/${retentionEdit.id}/retention`, {
        method: 'PATCH',
        body: JSON.stringify({ retentionPeriod: retentionValue }),
      });
      setToast(`已划定保管期限：${RETENTION_LABEL[retentionValue]}`);
      setRetentionEdit(null);
      void load();
    } catch (e: any) {
      setToast(e.message);
    } finally {
      setRetentionSaving(false);
    }
  }

  return (
    <div className="flow-page">
      <div className="px-[clamp(28px,4vw,72px)] pt-4 pb-8">
        {/* page-hero */}
        <div className="page-hero">
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon"><Archive size={17} /></div>
              <div>
                <div className="page-hero__title">归档管理</div>
                <div className="page-hero__sub">DA/T 103-2024 招标投标电子文件归档：范围勾稽 · 四性检测 · 归档信息包</div>
              </div>
            </div>
            <div className="page-hero__right">
              <button onClick={() => void load()} disabled={loading} className="neu-btn-xs">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.16)', paddingTop: '1rem' }} />
          <div className="grid grid-cols-3 gap-2">
            <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">归档卷总数</span>
              <span className="text-[1.55rem] font-black tabular-nums leading-none text-[var(--foreground)]">{stats.total}</span>
            </div>
            <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">已导出 ASIP</span>
              <span className="text-[1.55rem] font-black tabular-nums leading-none text-[var(--foreground)]">{stats.exported}</span>
            </div>
            <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">流程终结待归档</span>
              <span className="text-[1.55rem] font-black tabular-nums leading-none text-[var(--foreground)]">{stats.pending}</span>
            </div>
          </div>
        </div>

        {/* 工具栏 */}
        <div className="neu-table-card mt-4">
          <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
            <div className="neu-tab-bar">
              {([['all', '全部'], ['no', '待归档'], ['yes', '已导出']] as const).map(([v, label]) => (
                <button key={v} className={`neu-tab ${exportedFilter === v ? 'is-active' : ''}`} onClick={() => setExportedFilter(v)}>{label}</button>
              ))}
            </div>
            {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
          </div>

          <div className="overflow-x-auto">
            <table className="neu-table w-full min-w-[860px]">
              <thead>
                <tr>
                  <th>项目（卷）</th>
                  <th>当前阶段</th>
                  <th>归档材料</th>
                  <th>保管期限</th>
                  <th>归档状态</th>
                  <th style={{ width: 260 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const attTotal = r.stages?.reduce((n, s) => n + s.attachments.length, 0) ?? 0;
                  return (
                    <tr key={r.id} className="row-clickable">
                      <td>
                        <div className="text-[0.85rem] font-bold text-[var(--foreground)]">{r.title}</div>
                        <div className="text-[0.7rem] text-[var(--muted-foreground)]">{r.projectCode ?? '—'} · {r.requesterDepartment ?? '—'}</div>
                      </td>
                      <td><span className="text-[0.8rem]">{STAGE_LABEL[r.currentStage] ?? r.currentStage}</span></td>
                      <td><span className="text-[0.8rem] tabular-nums">{attTotal} 件</span></td>
                      <td><span className="text-[0.8rem]">{r.retentionPeriod ? RETENTION_LABEL[r.retentionPeriod] : '未划定'}</span></td>
                      <td>
                        {r.archiveExportedAt ? (
                          <span className="text-[0.75rem] font-semibold text-[var(--success)]">已导出 {new Date(r.archiveExportedAt).toLocaleDateString()}</span>
                        ) : (
                          <span className="text-[0.75rem] font-semibold text-[var(--muted-foreground)]">未导出</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <button className="neu-btn-xs" disabled={busy === r.id} onClick={() => void openInspect(r)}>
                            <ClipboardCheck size={13} /> 质检
                          </button>
                          <button className="neu-btn-xs" disabled={busy === r.id} onClick={() => void runCheck(r.id)}>
                            <PlayCircle size={13} /> 检测
                          </button>
                          {canExport && (
                            <>
                              {!r.retentionPeriod && (
                                <button className="neu-btn-xs" disabled={busy === r.id} onClick={() => { setRetentionValue('Y30'); setRetentionEdit(r); }}>
                                  <Clock3 size={13} /> 划定期限
                                </button>
                              )}
                              <button className="neu-btn-xs is-success" disabled={busy === r.id} onClick={() => void exportAsip(r.id, r.retentionPeriod)}>
                                <FileArchive size={13} /> 导出
                              </button>
                            </>
                          )}
                          {r.archiveExportedAt && (
                            <button className="neu-btn-xs" onClick={() => download(r.id)}>
                              <Download size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="py-10 text-center text-sm text-[var(--muted-foreground)]">暂无项目</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 划定保管期限弹窗（§9.3；此前后端端点零接线） */}
      {retentionEdit && (
        <Modal
          open
          onClose={() => setRetentionEdit(null)}
          title="划定保管期限"
          description={<>项目：<strong className="text-[var(--foreground)]">{retentionEdit.title}</strong>（{retentionEdit.projectCode ?? '—'}）</>}
          footer={
            <>
              <button onClick={() => setRetentionEdit(null)} className="neu-btn-soft">取消</button>
              <button onClick={() => void saveRetention()} disabled={retentionSaving} className="neu-btn-soft is-success">
                {retentionSaving ? '保存中...' : '确认划定'}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--muted-foreground)]">依据 DA/T 103-2024 §9.3 划定；划定后导出归档信息包将保留原值，不再默认 Y30。</p>
            <div className="flex gap-2">
              {(['PERMANENT', 'Y30', 'Y10'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRetentionValue(v)}
                  className={retentionValue === v ? 'neu-btn-xs is-info' : 'neu-btn-xs'}
                >
                  {RETENTION_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* 质检弹窗（Modal 化，2026-09-18 cgzxui 表单弹窗范式） */}
      {inspect && (
        <Modal
          open
          onClose={() => setInspect(null)}
          title={
            <span className="flex items-center gap-2">
              <span className="neu-icon-well inline-flex h-7 w-7 items-center justify-center rounded-[9px]"><ShieldCheck size={14} strokeWidth={1.9} className="text-[var(--accent)]" /></span>
              归档质检
            </span>
          }
          description={
            <span>
              <span className="font-semibold text-[color:var(--foreground)]">{inspect.row.title}</span>
              {' '}· <span className="font-mono">{inspect.row.projectCode ?? '—'}</span> · 卷内按阶段整理（DA/T 103-2024 §9.2）
              {inspect.check && (
                <span className={`ml-2 font-semibold ${inspect.check.overall === 'PASSED' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                  最近检测：{inspect.check.overall === 'PASSED' ? '通过' : `${inspect.check.failedCount} 项不合格`}（{new Date(inspect.check.ranAt).toLocaleString()}）
                </span>
              )}
            </span>
          }
          size="2xl"
          className="!max-w-[980px]"
          footer={
            <>
              <button type="button" className="neu-btn-soft !h-9 !text-xs" disabled={!!busy} onClick={() => void runCheck(inspect.row.id)}><ShieldCheck size={13} strokeWidth={1.9} /> 运行检测</button>
              <button type="button" className="neu-btn-soft !h-9 !text-xs" onClick={() => setInspect(null)}>关闭</button>
            </>
          }
        >
          <div>
              <table className="neu-table w-full min-w-[720px]">
                <thead>
                  <tr><th style={{ width: 60 }}>序号</th><th style={{ width: 70 }}>阶段</th><th>归档材料</th><th style={{ width: 80 }}>来源</th><th style={{ width: 90 }}>状态</th><th>命中</th></tr>
                </thead>
                <tbody>
                  {inspect.snapshot.map((s) => (
                    <tr key={s.code}>
                      <td className="tabular-nums text-[0.75rem]">{s.code}</td>
                      <td className="text-[0.75rem]">{s.stage}</td>
                      <td className="text-[0.82rem] font-semibold">
                        {s.materialName}
                        {s.isRequired && <span className="ml-1.5 text-[10px] font-bold text-[var(--danger)]">必选</span>}
                      </td>
                      <td className="text-[0.75rem] text-[var(--muted-foreground)]">{SOURCE_LABEL[s.sourceType] ?? s.sourceType}</td>
                      <td>
                        <span className={`text-[0.72rem] font-semibold ${
                          s.status === 'MATCHED' ? 'text-[var(--success)]'
                          : s.status === 'PENDING_GENERATED' ? 'text-[var(--muted-foreground)]'
                          : s.blocking ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`}>
                          {s.status === 'MATCHED' ? '✓ 已归集' : s.status === 'PENDING_GENERATED' ? '导出时生成' : s.blocking ? '✗ 缺件（阻断）' : '缺件（提示）'}
                        </span>
                      </td>
                      <td className="text-[0.72rem] tabular-nums text-[var(--muted-foreground)]">
                        {s.attachmentIds.length + s.fileAssetIds.length > 0 ? `${s.attachmentIds.length + s.fileAssetIds.length} 件` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inspect.check?.details && inspect.check.details.some((d) => d.status === 'FAIL') && (
                <>
                  <hr className="wb-section-rule my-4" />
                  <p className="mb-2 text-xs font-bold text-[var(--danger)]">不合格明细</p>
                  <ul className="space-y-1">
                    {inspect.check.details.filter((d) => d.status === 'FAIL').map((d, i) => (
                      <li key={i} className="text-xs text-[var(--foreground)]">
                        <span className="font-semibold">[{d.check}]</span> {d.materialName} — {d.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* D3 纸电关联：登记表回传（A.1h） */}
              <hr className="wb-section-rule my-4" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[var(--foreground)]">移交接收登记表（纸电关联）</p>
                  <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                    {registrationKey
                      ? '✓ 已回传签章扫描件，与归档信息包同卷互链'
                      : '导出 ASIP 后打印「其他/移交接收登记表」→ 双方签章 → 扫描回传此处'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={fileInputRef} type="file" hidden
                    accept="image/*,.pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && inspect) void uploadRegistration(inspect.row.id, f);
                      e.target.value = '';
                    }}
                  />
                  <button className="neu-btn-xs" disabled={!!busy} onClick={() => fileInputRef.current?.click()}>
                    <Upload size={13} /> {registrationKey ? '重新上传' : '上传扫描件'}
                  </button>
                  {registrationKey && (
                    <a className="neu-btn-xs" href={`/api/archive/items/${inspect.row.id}/registration`} target="_blank" rel="noreferrer">
                      <Download size={13} />
                    </a>
                  )}
                </div>
              </div>

              {/* S2 归档审计（A.1g） */}
              {auditRows && auditRows.length > 0 && (
                <>
                  <hr className="wb-section-rule my-4" />
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
                    <History size={13} /> 归档操作审计（最近 {auditRows.length} 条）
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {auditRows.map((a, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-[11px] text-[var(--muted-foreground)]">
                        <span className="tabular-nums">{new Date(a.createdAt).toLocaleString()}</span>
                        <span className="font-semibold text-[var(--foreground)]">{a.username ?? '—'}</span>
                        <span className="font-mono">{a.method} {a.path.replace(`/api/archive/items/${inspect.row.id}`, '…')}</span>
                        <span className={a.statusCode >= 400 ? 'font-bold text-[var(--danger)]' : 'text-[var(--success)]'}>{a.statusCode}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-[var(--foreground)] px-4 py-2.5 text-sm text-[var(--background)] shadow-[2px_3px_8px_oklch(0.45_0.05_258/0.25),-1px_-1px_3px_oklch(1_0_0/0.15)]">
          {toast}
        </div>
      )}
    </div>
  );
}

/** useSearchParams 需由 Suspense 包裹，确保 /archive 可正常预渲染。 */

export default function ArchivePage() {
  return (
    <Suspense>
      <ArchivePageInner />
    </Suspense>
  );
}
