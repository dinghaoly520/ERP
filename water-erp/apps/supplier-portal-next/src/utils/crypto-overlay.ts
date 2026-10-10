/**
 * B6（第四波）：同步国密 SM4 加密的全屏遮罩——sm-crypto 无流式 CBC，大文件（≤50MB）
 * 整体加密会冻结主线程分钟级；遮罩在进入同步段前先行落屏（双 rAF），防止用户
 * 误判死机刷新/关页=加密与已传部分全部重来。纯 DOM 实现零 React 耦合，套在
 * encryptAndUploadFile / reencryptDualFile 两个收口点，所有调用方自动受益。
 */
let overlayCount = 0;
let overlayEl: HTMLDivElement | null = null;

function ensureOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement("div");
  overlayEl.setAttribute("role", "alert");
  // 验收补（C11）：遮罩自身即 busy 标记——session-kick 据此让位（覆盖提交页等未打标调用方）
  overlayEl.setAttribute("data-sp-busy", "1");
  overlayEl.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(15,23,42,.55);color:#fff;font-size:14px;font-weight:600;letter-spacing:.02em";
  overlayEl.innerHTML =
    '<div style="width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;animation:sp-crypto-spin .9s linear infinite"></div>' +
    "正在加密投标文件（国密 SM4 双层密封）…" +
    '<div style="font-size:12px;font-weight:400;opacity:.85">大文件加密可能需要数分钟，请勿刷新或关闭本页面</div>' +
    "<style>@keyframes sp-crypto-spin{to{transform:rotate(360deg)}}</style>";
  document.body.appendChild(overlayEl);
}

export async function withCryptoOverlay<T>(task: () => Promise<T>): Promise<T> {
  if (typeof document === "undefined") return task(); // SSR 安全
  overlayCount++;
  ensureOverlay();
  // 双 rAF：确保遮罩已绘制到屏幕后才进入同步冻结段
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return await task();
  } finally {
    overlayCount--;
    if (overlayCount === 0 && overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }
}
