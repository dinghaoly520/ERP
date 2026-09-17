/* =================================================================
   CA及签章测试 · 加解密自检（六项）— 大平台「CA加解密测试」清单等价物

   私钥侧运算（签名/解密）必须走 UKeyAdapter —— 即真实经过介质
   （vendor=本机中间件+U盾 / mock=浏览器软件介质）内的私钥；
   公钥与对称侧为调用方本地 sm-crypto 层运算。
   六项恰好覆盖双信封投标的全部密码原语与链路：
   SM2 签名/验签/加解密 + SM4 文件层 + 介质会话。
   ================================================================= */
import { randomHex, sm2EncryptHex, sm4Decrypt, sm4Encrypt, verifyEnvelopeMsg } from './sm-crypto-layer';
import type { CertInfo, UKeyAdapter } from './types';

export type CaSelfTestItemKey =
  | 'sign'
  | 'verify'
  | 'pubEncrypt'
  | 'privDecrypt'
  | 'sm4Encrypt'
  | 'sm4Decrypt';

export type CaSelfTestItemStatus = 'pass' | 'fail' | 'skipped';

export interface CaSelfTestItemResult {
  key: CaSelfTestItemKey;
  /** 检测项中文名（与 UI 展示同口径） */
  label: string;
  status: CaSelfTestItemStatus;
  /** 耗时（ms）；skipped 项为 0 */
  ms: number;
  /** 通过=值摘要；失败=错误原因；跳过=跳过原因 */
  detail: string;
}

const LABELS: Record<CaSelfTestItemKey, string> = {
  sign: '对数据签名进行检测',
  verify: '对签名数据验签进行检测',
  pubEncrypt: '对公钥加密消息进行检测',
  privDecrypt: '对私钥解密进行检测',
  sm4Encrypt: '对文件对称加密进行检测',
  sm4Decrypt: '对文件对称解密进行检测',
};

/** 「文件」模拟数据规模（字节）：文件量级、又不拖慢页面 */
const FILE_TEST_BYTES = 64 * 1024;

/** SM2 明文上限 ~（曲线点+摘要约束），消息级检测用 32 字节随机数 */
const MSG_TEST_BYTES = 32;

const truncate = (hex: string, head = 12): string =>
  hex.length <= head * 2 ? hex : `${hex.slice(0, head)}…(${hex.length} hex)`;

function item(
  key: CaSelfTestItemKey,
  status: CaSelfTestItemStatus,
  detail: string,
  ms = 0,
): CaSelfTestItemResult {
  return { key, label: LABELS[key], status, detail, ms };
}

async function timed(
  run: () => Promise<string>,
): Promise<{ ok: true; value: string; ms: number } | { ok: false; error: string; ms: number }> {
  const t0 = Date.now();
  try {
    return { ok: true, value: await run(), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

/**
 * 顺序执行六项自检。依赖链：verify←sign、privDecrypt←pubEncrypt、sm4Decrypt←sm4Encrypt；
 * 前置失败时后续依赖项记 skipped（其余不受牵连）。onResult 在每项完成后即时回调（UI 逐项点亮）。
 */
export async function runCaSelfTest(
  adapter: UKeyAdapter,
  cert: CertInfo,
  onResult?: (r: CaSelfTestItemResult) => void,
): Promise<CaSelfTestItemResult[]> {
  const results: CaSelfTestItemResult[] = [];
  const emit = (r: CaSelfTestItemResult) => {
    results.push(r);
    onResult?.(r);
  };

  const msg = `ca-selftest:${randomHex(MSG_TEST_BYTES)}`;

  // ── ①② 签名 → 验签 ──
  let sig = '';
  {
    const r = await timed(() => adapter.sign(cert.certSn, msg));
    if (r.ok && r.value) {
      sig = r.value;
      emit(item('sign', 'pass', `签名值 ${truncate(sig)}（经介质私钥运算）`, r.ms));
    } else {
      emit(item('sign', 'fail', r.ok ? '介质返回空签名值' : r.error, r.ms));
    }
  }
  if (sig) {
    const t0 = Date.now();
    const ok = verifyEnvelopeMsg(msg, sig, cert.publicKey);
    emit(
      item(
        'verify',
        ok ? 'pass' : 'fail',
        ok ? '验签通过（证书公钥）' : '验签未通过：签名值与所选证书公钥不匹配',
        Date.now() - t0,
      ),
    );
  } else {
    emit(item('verify', 'skipped', '前置项「数据签名」未通过，无签名值可验'));
  }

  // ── ③④ 公钥加密 → 介质私钥解密（往返比对） ──
  const plainHex = randomHex(MSG_TEST_BYTES);
  let cipher = '';
  {
    const t0 = Date.now();
    try {
      cipher = sm2EncryptHex(cert.publicKey, plainHex);
      emit(item('pubEncrypt', 'pass', `密文 ${truncate(cipher)}`, Date.now() - t0));
    } catch (e) {
      emit(item('pubEncrypt', 'fail', e instanceof Error ? e.message : String(e), Date.now() - t0));
    }
  }
  if (cipher) {
    const r = await timed(() => adapter.decrypt(cert.certSn, cipher));
    const ok = r.ok && r.value === plainHex;
    emit(
      item(
        'privDecrypt',
        ok ? 'pass' : 'fail',
        ok
          ? `解密成功，与原文一致（介质私钥运算）`
          : r.ok
            ? '解密结果与原文不一致'
            : r.error,
        r.ms,
      ),
    );
  } else {
    emit(item('privDecrypt', 'skipped', '前置项「公钥加密」未通过，无密文可解'));
  }

  // ── ⑤⑥ 文件对称加密 → 解密（SM4-CBC，双信封文件层同款） ──
  const fileHex = randomHex(FILE_TEST_BYTES);
  const sm4Key = randomHex(16);
  const sm4Iv = randomHex(16);
  let fileCipher = '';
  {
    const t0 = Date.now();
    try {
      fileCipher = sm4Encrypt(sm4Key, sm4Iv, fileHex);
      emit(
        item('sm4Encrypt', 'pass', `${FILE_TEST_BYTES} 字节 → 密文 ${fileCipher.length} hex`, Date.now() - t0),
      );
    } catch (e) {
      emit(item('sm4Encrypt', 'fail', e instanceof Error ? e.message : String(e), Date.now() - t0));
    }
  }
  if (fileCipher) {
    const t0 = Date.now();
    try {
      const back = sm4Decrypt(sm4Key, sm4Iv, fileCipher);
      const ok = back === fileHex;
      emit(
        item(
          'sm4Decrypt',
          ok ? 'pass' : 'fail',
          ok ? `${FILE_TEST_BYTES} 字节解密后与原文一致` : '解密结果与原文不一致',
          Date.now() - t0,
        ),
      );
    } catch (e) {
      emit(item('sm4Decrypt', 'fail', e instanceof Error ? e.message : String(e), Date.now() - t0));
    }
  } else {
    emit(item('sm4Decrypt', 'skipped', '前置项「文件对称加密」未通过，无密文可解'));
  }

  return results;
}
