/* =================================================================
   ca-selftest-dialog — SCCA 连接与加解密自检（cgzxui 化 2026-10-14）
   本机链四步：连接探测 → 双证枚举 → P7 签名（盾内）→ 密钥封装往返
   触发方式：trigger prop 渲染入口按钮（页面用 neu-btn-soft）。
   mock 轨 raw SM2 六项自检已随全面适配删除。
   ================================================================= */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Usb, ShieldCheck, LoaderCircle, X, Check, TriangleAlert, KeyRound } from 'lucide-react';
import * as scca from '@/utils/scca-ukey';
import type { SccaDualCert } from '@water-erp/ukey';
import { SpDialog } from '@/components/ui';

type ItemStatus = 'pending' | 'running' | 'pass' | 'fail';
interface SelftestItem { key: string; label: string; status: ItemStatus; detail: string }

const WRAP_JSON = '{"iv":"fedcba9876543210fedcba9876543210","k":"0123456789abcdef0123456789abcdef"}';
const SIGN_TEXT = 'SCCA-selftest-' + '水发集团连接自检';

export function CaSelftestDialog({ trigger, onRefresh }: {
  trigger: React.ReactNode;
  onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [pin, setPin] = useState('');
  const [needPin, setNeedPin] = useState(false);
  const [certs, setCerts] = useState<SccaDualCert[]>([]);
  const [selected, setSelected] = useState<SccaDualCert | null>(null);
  const [items, setItems] = useState<SelftestItem[]>([
    { key: 'connect', label: '本机连接（证书助手）', status: 'pending', detail: 'wss://localhost:36171' },
    { key: 'enumerate', label: '双证枚举', status: 'pending', detail: '签名证 + 加密证' },
    { key: 'sign', label: '盾内数字签名', status: 'pending', detail: 'SM2/SM3 附加式签名' },
    { key: 'wrap', label: '密钥封装往返', status: 'pending', detail: 'GM/T 0010 数字信封加解封比对' },
  ]);
  const actionIdRef = useRef(0);

  const setItem = useCallback((key: string, patch: Partial<SelftestItem>) => {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)));
  }, []);

  const run = useCallback(async () => {
    const actionId = ++actionIdRef.current;
    setRunning(true);
    setItems(prev => prev.map(i => ({ ...i, status: 'pending' as ItemStatus, detail: i.detail })));

    // ① 连接
    setItem('connect', { status: 'running' });
    const online = await scca.probeScca();
    if (actionId !== actionIdRef.current) return;
    if (!online) { setItem('connect', { status: 'fail', detail: '证书助手未启动或被浏览器拦截' }); setRunning(false); return; }
    setItem('connect', { status: 'pass', detail: '证书助手在线' });

    // ② 枚举
    setItem('enumerate', { status: 'running' });
    let list: SccaDualCert[] = [];
    try {
      list = await scca.listSccaCerts();
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setItem('enumerate', { status: 'fail', detail: e?.message ?? '枚举失败' });
      setRunning(false); return;
    }
    if (actionId !== actionIdRef.current) return;
    if (!list.length) { setItem('enumerate', { status: 'fail', detail: '未找到证书' }); setRunning(false); return; }
    setCerts(list);
    setItem('enumerate', { status: 'pass', detail: `${list.length} 个容器（双证同容器）` });

    // ③④ 需要 PIN——弹 PIN 输入
    setSelected(list[0]!);
    setNeedPin(true);
  }, [setItem]);

  const finishWithPin = useCallback(async () => {
    if (!pin || !selected) return;
    const actionId = ++actionIdRef.current;
    setNeedPin(false);
    setPin('');
    try {
      await scca.loginScca(selected.container, pin);
      // ③ 签名
      setItem('sign', { status: 'running' });
      const p7 = await scca.signSccaP7(selected.container, SIGN_TEXT);
      if (actionId !== actionIdRef.current) return;
      if (!p7 || p7.length < 100) { setItem('sign', { status: 'fail', detail: '签名值异常' }); setRunning(false); return; }
      setItem('sign', { status: 'pass', detail: `${p7.length} 字符 P7（GM/T 0010 格式，签名真伪以服务端验签为准）` });

      // ④ 封装往返
      setItem('wrap', { status: 'running' });
      const wrapped = await scca.wrapSccaKey(selected.enc.pem, WRAP_JSON);
      const unwrapped = await scca.unwrapSccaKey(selected.container, wrapped);
      if (actionId !== actionIdRef.current) return;
      // unwrap 返回 base64 明文——与 WRAP_JSON 的 base64 比对
      const expected = (await import('@/utils/scca-ukey')).b64Of(WRAP_JSON);
      if (unwrapped === expected) {
        setItem('wrap', { status: 'pass', detail: '密文可解且明文一致（接收方=加密证书）' });
      } else {
        setItem('wrap', { status: 'fail', detail: '往返明文不一致' });
      }
    } catch (e: any) {
      if (actionId !== actionIdRef.current) return;
      setItem('sign', { status: 'fail', detail: e?.message ?? '签名失败' });
      setItem('wrap', { status: 'fail', detail: '未执行（签名失败）' });
    } finally {
      setRunning(false);
    }
  }, [pin, selected, setItem]);

  const close = useCallback(() => {
    actionIdRef.current++;
    setOpen(false);
    setNeedPin(false);
    setPin('');
    onRefresh?.();
  }, [onRefresh]);

  return (
    <>
      <span onClick={() => { setOpen(true); void run(); }}>{trigger}</span>

      <SpDialog open={open} onClose={close} title="CA 连接与加解密自检" width={520}>
        <div className="flex flex-col gap-2">
          {items.map(item => (
            <div key={item.key} className="flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm
              [box-shadow:inset_0_1px_0_oklch(1_0_0/0.6),2px_2px_4px_oklch(0.55_0.03_258/0.08)]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[var(--brand-soft)] text-[var(--brand)]">
                {item.key === 'connect' && <Usb size={14} strokeWidth={1.9} />}
                {item.key === 'enumerate' && <KeyRound size={14} strokeWidth={1.9} />}
                {(item.key === 'sign' || item.key === 'wrap') && <ShieldCheck size={14} strokeWidth={1.9} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[var(--ink)]">{item.label}</div>
                <div className="truncate text-xs text-[var(--fg-3)]">{item.detail}</div>
              </div>
              {item.status === 'pending' && <span className="text-xs text-[var(--fg-3)]">待测</span>}
              {item.status === 'running' && <LoaderCircle size={15} className="animate-spin text-[var(--brand)]" strokeWidth={1.9} />}
              {item.status === 'pass' && <Check size={15} className="text-[var(--success)]" strokeWidth={2.2} />}
              {item.status === 'fail' && <X size={15} className="text-[var(--danger)]" strokeWidth={2.2} />}
            </div>
          ))}
        </div>

        {needPin && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-sm text-[var(--fg-2)]">
              <TriangleAlert size={14} className="text-[var(--warning)]" strokeWidth={1.9} />
              签名与封装需解锁 U盾——请输入 PIN：
            </div>
            <div className="flex items-center gap-3">
              <input type="password" value={pin} autoFocus
                onChange={e => setPin(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') finishWithPin(); }}
                className="neu-input flex-1 font-mono"
                placeholder="PIN 码" autoComplete="one-time-code" />
              <button onClick={finishWithPin} disabled={!pin} className="neu-btn-primary !h-[38px] px-4">继续</button>
            </div>
          </div>
        )}

        <div className="mt-4 flex items-start gap-2 rounded-[10px] bg-[var(--warning-soft)] px-3 py-2.5 text-xs text-[var(--warning)]">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" strokeWidth={1.9} />
          <span>自检覆盖本机链（连接/枚举/盾内签名/密钥封装往返）。签名真伪与证书可信状态由服务端在登录/绑定时验证——自检通过不代表服务端验签通过。</span>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={close} disabled={running} className="neu-btn-soft !h-9 justify-center px-4">关闭</button>
        </div>
      </SpDialog>
    </>
  );
}
