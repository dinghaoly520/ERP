'use client';

/**
 * A-153 监督推送区块——:3005 开标确认面板·评标后收尾区（EvaluationHandoverBlock 之后）。
 * 评标报告推送公共服务平台监督通道：可配置端点推送 + 离线导出凭证 + 尝试日志。
 * 推送不作为归档闸门（外部平台未接入不得卡归档，spec §4.8）。
 * 外壳/标题/toast/按钮 idiom 镜像同目录 evaluation-handover-block / archive-block。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  FileDown,
  History,
  RadioTower,
  Settings2,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import { supervisionApi, type SupervisionPushLogItem, type SupervisionPushStatus } from '@/lib/api/supervision';

type Props = { bidProjectId: string; isAdmin: boolean };

const LOG_STATUS_LABELS: Record<SupervisionPushLogItem['status'], string> = {
  SUCCESS: '成功',
  FAILED: '失败',
  VOUCHER_EXPORTED: '凭证导出',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type CfgForm = {
  enabled: boolean;
  endpoint: string;
  authToken: string;
  timeoutMs: number;
  platformCode: string;
};

export function SupervisionPushBlock({ bidProjectId, isAdmin }: Props) {
  const [status, setStatus] = useState<SupervisionPushStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<SupervisionPushLogItem[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  // 配置表单（admin）；authToken 永远从 '' 起步——留空 = 保持现有
  const [cfgForm, setCfgForm] = useState<CfgForm>({ enabled: false, endpoint: '', authToken: '', timeoutMs: 8000, platformCode: '' });

  const load = useCallback(() => {
    supervisionApi
      .getStatus(bidProjectId)
      .then((s) => { setStatus(s); setLoadFailed(false); })
      .catch(() => { setStatus(null); setLoadFailed(true); });
  }, [bidProjectId]);

  useEffect(() => { load(); }, [load]);

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), 3200);
  };

  async function handlePush() {
    setBusy(true);
    try {
      // 201 ≠ 推送成功：结果在返回 log 行里（HTTP 成功但平台 4xx/5xx 记 FAILED）
      const log = await supervisionApi.pushNow(bidProjectId);
      if (log.status === 'SUCCESS') showToast('推送成功（公共服务平台已接收）');
      else showToast(`推送失败：${log.errorMessage ?? `HTTP ${log.responseCode ?? '—'}`}`, 'err');
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '推送失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function handleVoucher() {
    setBusy(true);
    try {
      const res = await supervisionApi.exportVoucher(bidProjectId);
      showToast('离线凭证已生成（若新窗口被拦截，可从「推送日志」下载）');
      // 不加 noreferrer——受保护下载依赖 Referer 做门户识别
      window.open(res.downloadUrl, '_blank', 'noopener');
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '凭证导出失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  function openConfig() {
    const cfg = status?.config;
    if (!cfg) return;
    setCfgForm({
      enabled: cfg.enabled,
      endpoint: cfg.endpoint,
      authToken: '', // 留空 = 保持现有 Token（后端判定 ''/'******'）
      timeoutMs: cfg.timeoutMs,
      platformCode: cfg.platformCode,
    });
    setShowConfig(true);
  }

  async function handleSaveConfig() {
    setBusy(true);
    try {
      // 全量替换：五字段一并提交。endpoint 空串会被后端 DTO @IsUrl 拒绝
      // （IsOptional 不豁免 ''），置 undefined 让后端按 '' 落库——效果等同清空。
      await supervisionApi.saveConfig({
        enabled: cfgForm.enabled,
        endpoint: cfgForm.endpoint.trim() || undefined,
        authToken: cfgForm.authToken,
        timeoutMs: cfgForm.timeoutMs,
        platformCode: cfgForm.platformCode.trim(),
      });
      showToast('推送配置已保存');
      setShowConfig(false);
      load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function openLogs() {
    setShowLogs(true);
    setLogsLoading(true);
    try {
      setLogs(await supervisionApi.listLogs(bidProjectId));
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }

  const cfg = status?.config;
  const gate = status?.gate;
  const latest = status?.latest;

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center gap-2.5 min-w-0">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
        >
          <RadioTower size={15} className="text-[var(--accent)]" />
        </div>
        <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">监督推送</h3>
        <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">A-153 · 评标报告 → 公共服务平台监督通道</span>
      </div>

      {feedback && (
        <div
          className="mb-3 flex items-center gap-2 rounded-[12px] px-3.5 py-2 text-xs font-medium"
          style={{
            background: feedback.tone === 'ok' ? 'color-mix(in oklch, var(--success) 10%, transparent)' : 'color-mix(in oklch, var(--danger) 10%, transparent)',
            color: feedback.tone === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {feedback.tone === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {feedback.text}
        </div>
      )}

      {/* 闸门横幅（镜像 EvaluationHandoverBlock 的着色横幅 idiom）*/}
      <div
        className="mb-2.5 flex flex-wrap items-center gap-2 rounded-[14px] px-3.5 py-2.5 text-xs"
        style={{
          background: gate == null
            ? 'color-mix(in oklch, var(--muted-foreground) 8%, transparent)'
            : gate.ready
              ? 'color-mix(in oklch, var(--success) 8%, transparent)'
              : 'color-mix(in oklch, var(--warning) 10%, transparent)',
        }}
      >
        {gate == null
          ? <span className="font-semibold text-[var(--muted-foreground)]">推送前置状态加载中…</span>
          : gate.ready ? (
            <>
              <CheckCircle2 size={13} className="shrink-0 text-[var(--success)]" />
              <span className="font-semibold text-[var(--success)]">推送前置已满足（评标签字闭环 + 回流包已生成）</span>
            </>
          ) : (
            <>
              <AlertTriangle size={13} className="shrink-0 text-[var(--warning)]" />
              <span className="font-semibold text-[var(--warning)]">推送前置未满足：{gate.reason ?? '原因未知'}</span>
            </>
          )}
      </div>

      {/* 状态行 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
        <span>
          推送配置：
          <span className={cfg?.enabled ? 'font-semibold text-[var(--success)]' : 'font-semibold text-[var(--foreground)]'}>
            {cfg ? (cfg.enabled ? '已启用' : '未启用') : '—'}
          </span>
          {cfg?.enabled && cfg.endpoint ? ` · ${cfg.endpoint}` : cfg?.enabled ? ' · 端点走服务端缺省' : ''}
        </span>
        {latest && (
          <span className={latest.status === 'SUCCESS' ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
            最近：{LOG_STATUS_LABELS[latest.status] ?? latest.status} · 第 {latest.attemptNo} 次
          </span>
        )}
        {loadFailed && <span className="text-[var(--warning)]">状态加载失败，可重试操作</span>}
      </div>

      {/* 操作行 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="neu-btn-soft !h-[32px] !text-xs"
          onClick={() => void handleVoucher()}
          disabled={busy || !gate?.ready}
          title={gate?.ready ? '导出签名信封 + 尝试日志离线凭证（JSON）' : '推送前置未满足，暂不可导出'}
        >
          <FileDown size={13} /> 离线导出凭证
        </button>
        <button type="button" className="neu-btn-soft !h-[32px] !text-xs" onClick={() => void openLogs()} disabled={busy}>
          <History size={13} /> 推送日志
        </button>
        {isAdmin && (
          <button type="button" className="neu-btn-soft !h-[32px] !text-xs" onClick={openConfig} disabled={!cfg || busy}>
            <Settings2 size={13} /> 推送配置
          </button>
        )}
        <button
          type="button"
          className="neu-btn-primary !h-[32px] !text-xs shrink-0"
          onClick={() => void handlePush()}
          disabled={busy || !cfg?.enabled || !gate?.ready}
          title={!cfg?.enabled ? '推送未启用（admin 可在「推送配置」开启）' : !gate?.ready ? '推送前置未满足' : '推送评标报告至公共服务平台'}
        >
          <CloudUpload size={13} /> {busy ? '处理中…' : '推送监督平台'}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
        推送结果不影响归档闸门——外部平台未接入时不阻塞完整归档，可改用「离线导出凭证」线下报送。
      </p>

      {/* 配置模态（admin only；全量替换保存）*/}
      <Modal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        title="监督推送配置"
        description="公共服务平台监督通道对接参数（保存为全量替换；Bearer Token 留空 = 保持现有）"
        footer={
          <>
            <button type="button" className="neu-btn-soft !h-[36px] !text-xs" onClick={() => setShowConfig(false)}>取消</button>
            <button type="button" className="neu-btn-primary !h-[36px] !text-xs disabled:opacity-40" onClick={() => void handleSaveConfig()} disabled={busy}>
              保存
            </button>
          </>
        }
      >
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]">
          <input
            type="checkbox"
            checked={cfgForm.enabled}
            onChange={(e) => setCfgForm({ ...cfgForm, enabled: e.target.checked })}
          />
          启用推送（未启用时「推送监督平台」不可用）
        </label>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-[var(--foreground)]">推送端点 URL</div>
          <input
            className="workbench-input w-full"
            placeholder="https://psvp.sc.gov.cn/api/supervision（留空 = 服务端 SUPERVISION_PUSH_URL 缺省）"
            value={cfgForm.endpoint}
            onChange={(e) => setCfgForm({ ...cfgForm, endpoint: e.target.value })}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-[var(--foreground)]">Bearer Token</div>
          <input
            className="workbench-input w-full"
            placeholder={cfg?.authToken ? '已配置——留空保持现有 Token' : '未配置（可选）'}
            value={cfgForm.authToken}
            onChange={(e) => setCfgForm({ ...cfgForm, authToken: e.target.value })}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-[var(--foreground)]">超时（毫秒，1000–60000，默认 8000）</div>
          <input
            className="workbench-input w-full"
            type="number"
            min={1000}
            max={60000}
            step={500}
            value={cfgForm.timeoutMs}
            onChange={(e) => setCfgForm({ ...cfgForm, timeoutMs: Number(e.target.value) || 8000 })}
          />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold text-[var(--foreground)]">平台代码</div>
          <input
            className="workbench-input w-full"
            placeholder="请填写公共服务平台分配的平台代码（暂无自动联动缺省）"
            value={cfgForm.platformCode}
            onChange={(e) => setCfgForm({ ...cfgForm, platformCode: e.target.value })}
          />
        </div>
      </Modal>

      {/* 日志模态（最近 100 条，含凭证行下载）*/}
      <Modal
        open={showLogs}
        onClose={() => setShowLogs(false)}
        title="监督推送日志"
        description="每次推送/凭证导出各记一行（含 HTTP 状态与错误信息）；最近 100 条"
        size="lg"
      >
        <div className="neu-table-card overflow-hidden">
          <table className="neu-table !text-xs">
            <thead>
              <tr>
                <th>时间</th>
                <th>第 N 次</th>
                <th>结果</th>
                <th>HTTP</th>
                <th>错误</th>
                <th>凭证</th>
              </tr>
            </thead>
            <tbody>
              {(logs ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="!py-2 tabular-nums text-[var(--muted-foreground)]">{formatDateTime(l.createdAt)}</td>
                  <td className="!py-2 tabular-nums">{l.attemptNo}</td>
                  <td className="!py-2">
                    <span className={l.status === 'SUCCESS' ? 'font-semibold text-[var(--success)]' : l.status === 'FAILED' ? 'font-semibold text-[var(--danger)]' : 'font-semibold text-[var(--accent)]'}>
                      {LOG_STATUS_LABELS[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className="!py-2 tabular-nums">{l.responseCode ?? '—'}</td>
                  <td className="!py-2 max-w-[220px] truncate" title={l.errorMessage ?? undefined}>{l.errorMessage ?? '—'}</td>
                  <td className="!py-2">
                    {l.voucherAssetId ? (
                      /* 受保护下载禁用 noreferrer（丢 Referer → 门户识别失败 401） */
                      <a href={`/api/upload/files/${l.voucherAssetId}`} target="_blank" rel="noopener" className="font-semibold text-[var(--accent)] hover:underline">
                        下载
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {logsLoading && (
                <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted-foreground)]">加载中…</td></tr>
              )}
              {!logsLoading && (!logs || logs.length === 0) && (
                <tr><td colSpan={6} className="!py-6 text-center text-[var(--muted-foreground)]">暂无推送记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>
    </section>
  );
}
