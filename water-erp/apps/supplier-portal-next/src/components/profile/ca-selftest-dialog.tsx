"use client";

/**
 * CA及签章测试弹窗 — Tab1「CA加解密测试」，对齐大平台（金格/CA厂商）检测清单。
 * 六项自检走 @water-erp/ukey runCaSelfTest（纯逻辑层，契约由
 * apps/api ukey-ca-selftest.spec.ts 锁定）：私钥侧（签名/解密）必须经介质
 * adapter——页面已解锁则复用同一会话（检测运算顺带给厂商会话续活），
 * 未解锁时弹窗内联 key密码 走 openUkey 初始化（mock 重开同库无冲突、
 * vendor 重新 unlock 幂等）。Tab2「CA签章测试」（可视化签章）待 CA 签章
 * 专项接入后补，tab 位先行占位禁用。
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, Loader2, ShieldCheck, XCircle } from "lucide-react";
import {
  runCaSelfTest,
  type CaSelfTestItemKey,
  type CertInfo,
  type MockUKeyAdapter,
  type VendorUKeyAdapter,
} from "@water-erp/ukey";
import { detectUkey, openUkey, type UkeyKind } from "@/utils/ukey-factory";
import { extractCn, isOwnCert } from "@/utils/ukey-cert-match";
import { SpButton, SpDialog, SpInput, SpSelect } from "@/components/ui";

const ITEM_ORDER: CaSelfTestItemKey[] = [
  "sign",
  "verify",
  "pubEncrypt",
  "privDecrypt",
  "sm4Encrypt",
  "sm4Decrypt",
];

type ItemState =
  | { status: "pending" }
  | { status: "running" }
  | { status: "pass"; detail: string; ms: number }
  | { status: "fail"; detail: string; ms: number }
  | { status: "skipped"; detail: string };

const PENDING_ALL: Record<CaSelfTestItemKey, ItemState> = Object.fromEntries(
  ITEM_ORDER.map((k) => [k, { status: "pending" } as ItemState]),
) as Record<CaSelfTestItemKey, ItemState>;

const LABELS: Record<CaSelfTestItemKey, string> = {
  sign: "对数据签名进行检测",
  verify: "对签名数据验签进行检测",
  pubEncrypt: "对公钥加密消息进行检测",
  privDecrypt: "对私钥解密进行检测",
  sm4Encrypt: "对文件对称加密进行检测",
  sm4Decrypt: "对文件对称解密进行检测",
};

export function CaSelftestDialog({
  open,
  onClose,
  ukey,
  ukeyKind: pageKind,
  companyName,
}: {
  open: boolean;
  onClose: () => void;
  /** 页面已解锁的介质（可空——空则弹窗内自行初始化） */
  ukey: MockUKeyAdapter | VendorUKeyAdapter | null;
  ukeyKind: UkeyKind;
  companyName: string;
}) {
  const [kind, setKind] = useState<UkeyKind>(pageKind);
  const [adapter, setAdapter] = useState<MockUKeyAdapter | VendorUKeyAdapter | null>(null);
  const [certs, setCerts] = useState<CertInfo[]>([]);
  const [certSn, setCertSn] = useState("");
  const [pin, setPin] = useState("");
  const [initializing, setInitializing] = useState(false);
  const [items, setItems] = useState<Record<CaSelfTestItemKey, ItemState>>(PENDING_ALL);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const selectedCert = useMemo(() => certs.find((c) => c.certSn === certSn) ?? null, [certs, certSn]);

  /* 开弹窗即复位；页面已解锁则直接枚举证书，否则先探测介质轨别 */
  useEffect(() => {
    if (!open) return;
    setItems(PENDING_ALL);
    setRunning(false);
    setFinished(false);
    setPin("");
    setCertSn("");
    setCerts([]);
    if (ukey) {
      setAdapter(ukey);
      setKind(pageKind);
      void enumerate(ukey);
    } else {
      setAdapter(null);
      void detectUkey().then(setKind);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function enumerate(target: MockUKeyAdapter | VendorUKeyAdapter) {
    const list = await target.listCertificates();
    setCerts(list);
    // 默认选本企业证书（与 U盾 卡片同口径），无本企业证则选首张
    const own = list.find((c) => isOwnCert(c.certDn, companyName));
    setCertSn((own ?? list[0])?.certSn ?? "");
    return list;
  }

  async function handleInit() {
    setInitializing(true);
    try {
      if (adapter) {
        await enumerate(adapter);
        toast.success("已重新枚举证书");
        return;
      }
      if (!pin) { toast.warning("请输入证书口令（key密码）"); return; }
      const opened = await openUkey(pin);
      setKind(opened.kind);
      setAdapter(opened.adapter);
      setPin(""); // 口令用完即清，不残留
      const list = await enumerate(opened.adapter);
      if (list.length === 0) toast.warning("介质内未检测到证书");
      else toast.success(`CA 初始化成功（${list.length} 张证书）`);
    } catch (e: any) {
      toast.error(e?.message || "初始化失败");
    } finally { setInitializing(false); }
  }

  async function startTest() {
    if (!adapter || !selectedCert) { toast.warning("没有选择CA证书！"); return; }
    setItems(PENDING_ALL);
    setFinished(false);
    setRunning(true);
    try {
      const final = await runCaSelfTest(adapter, selectedCert, (r) => {
        setItems((prev) => ({ ...prev, [r.key]: r }));
      });
      setRunning(false);
      setFinished(true);
      const passCount = final.filter((r) => r.status === "pass").length;
      if (passCount === final.length) toast.success(`CA自检 ${passCount}/${final.length} 项全部通过`);
      else toast.warning(`CA自检 ${passCount}/${final.length} 项通过，存在未通过项`);
    } catch (e: any) {
      setRunning(false);
      toast.error(e?.message || "检测执行异常");
    }
  }

  const passCount = ITEM_ORDER.filter((k) => items[k].status === "pass").length;

  function statusTag(k: CaSelfTestItemKey) {
    const s = items[k];
    switch (s.status) {
      case "pass": return <span className="ukey-tag ukey-tag--success">通过</span>;
      case "fail": return <span className="ukey-tag ukey-tag--danger">未通过</span>;
      case "skipped": return <span className="ukey-tag ukey-tag--warning">未执行</span>;
      case "running": return <span className="ukey-tag ukey-tag--info">检测中</span>;
      default: return <span className="ukey-tag ukey-tag--info">未检测</span>;
    }
  }

  function statusIcon(k: CaSelfTestItemKey) {
    const s = items[k];
    if (s.status === "running") return <Loader2 size={15} strokeWidth={1.85} className="shrink-0 animate-spin text-brand" />;
    if (s.status === "pass") return <CheckCircle2 size={15} strokeWidth={1.85} className="shrink-0 text-success" />;
    if (s.status === "fail") return <XCircle size={15} strokeWidth={1.85} className="shrink-0 text-danger" />;
    return <CircleDashed size={15} strokeWidth={1.85} className="shrink-0 text-muted-foreground" />;
  }

  return (
    <SpDialog
      open={open}
      onClose={onClose}
      title="CA及签章测试"
      width={620}
      footer={
        <>
          <SpButton disabled={!adapter || !selectedCert || running} onClick={() => void startTest()}>重新检测</SpButton>
          <SpButton variant="primary" icon={ShieldCheck} loading={running} disabled={!adapter || !selectedCert} onClick={() => void startTest()}>
            开始检测
          </SpButton>
        </>
      }
    >
      {/* tab 位：Tab2 可视化签章待专项接入，占位禁用 */}
      <div className="neu-tab-bar mb-4">
        <button type="button" className="neu-tab is-active">CA加解密测试</button>
        <button type="button" className="neu-tab" disabled title="CA签章测试待签章控件专项接入后开放">CA签章测试</button>
      </div>

      <div className="ca-form">
        <div className="ca-form-row">
          <label>选择CA类型</label>
          <SpSelect value={kind} disabled>
            <option value="vendor">国密 SM2 · 本机CA驱动</option>
            <option value="mock">国密 SM2 · 浏览器模拟介质</option>
          </SpSelect>
          <span className="ca-hint">SM2 / SM3 / SM4</span>
        </div>
        <div className="ca-form-row">
          <label>选择CA证书</label>
          <SpSelect value={certSn} onChange={(e) => setCertSn(e.target.value)} disabled={!adapter || running}>
            {certs.length === 0 ? (
              <option value="">{adapter ? "介质内无证书" : "请先初始化CA"}</option>
            ) : (
              certs.map((c) => (
                <option key={c.certSn} value={c.certSn}>
                  {c.certSn} · {extractCn(c.certDn) || c.certDn}
                  {companyName && !isOwnCert(c.certDn, companyName) ? "（其他单位）" : ""}
                </option>
              ))
            )}
          </SpSelect>
          {adapter ? (
            <span className="ca-hint text-success">已初始化{ukey ? "（共享U盾解锁会话）" : ""}</span>
          ) : (
            <SpButton icon={ShieldCheck} loading={initializing} onClick={() => void handleInit()}>初始化CA</SpButton>
          )}
        </div>
        {!adapter && (
          <div className="ca-form-row">
            <label>key密码</label>
            <SpInput
              type="password"
              placeholder={kind === "vendor" ? "输入证书口令（PIN）" : "输入 U盾口令（首次使用将自动创建）"}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleInit(); }}
            />
            <span className="ca-hint">初始化后口令即清</span>
          </div>
        )}
      </div>

      <div className="ca-check-list">
        {ITEM_ORDER.map((k) => {
          const s = items[k];
          return (
            <div key={k} className="ca-check-row">
              {statusIcon(k)}
              <div className="ca-check-main">
                <span className="ca-check-label">{LABELS[k]}</span>
                {s.status !== "pending" && s.status !== "running" && (
                  <span className="ca-check-detail">
                    {s.detail}
                    {s.status !== "skipped" && ` · ${s.ms}ms`}
                  </span>
                )}
              </div>
              {statusTag(k)}
            </div>
          );
        })}
      </div>

      {finished && (
        <div className={`ca-summary ${passCount === ITEM_ORDER.length ? "is-ok" : "is-bad"}`}>
          {passCount === ITEM_ORDER.length
            ? "全部 6 项通过——介质签名/解密与浏览器密码层链路正常，可用于双信封投标。"
            : `通过 ${passCount}/6 项——未通过项详见上方说明；介质或驱动异常时请联系 CA 服务机构。`}
        </div>
      )}
    </SpDialog>
  );
}
