/**
 * B6（2026-11 翻新）：大文件加密/解密的全屏进度遮罩。
 * 旧 ≤50MB 时代自述已过时——加密现已 worker 化分块流式（crypto-engine，
 * 主线程零冻结），上传上限提至 500MB，大文件全程可达数分钟。本遮罩职责：
 * ①进度行——task 内 report({phase,doneBytes,totalBytes}) 直写 DOM 文本
 *   （零 React/零 state，formatProgress 纯函数出文案）；
 * ②防误关——遮罩期间用户误判死机刷新/关页 = 密文与已上传部分全部重来；
 * ③可取消——opts.cancel 提供时渲染取消按钮，点击仅回调，中止后由调用方
 *   令 task reject，遮罩待 task 落定才撤（不抢跑）。
 * 不变保留：data-sp-busy（session-kick 据此让位的关键操作标记）、双 rAF
 * （开跑前遮罩必已绘制）、引用计数（并发嵌套只挂一层）、SSR 安全、纯 DOM。
 */
export interface OverlayProgress {
  phase: string;
  doneBytes?: number;
  totalBytes?: number;
}

const BYTES_PER_MB = 1048576;

const fmtMB = (bytes: number): string => `${(bytes / BYTES_PER_MB).toFixed(1)}MB`;

/** 无总量时只报已处理量——动词转完成态：加密中→已加密（非「中」尾缀原样） */
const donePhase = (phase: string): string =>
  phase.endsWith("中") ? `已${phase.slice(0, -1)}` : phase;

/** 纯函数：`加密中 37%（185.0MB/500.0MB）`；totalBytes 缺省/0 → `已加密 185.0MB` */
export function formatProgress(p: OverlayProgress): string {
  if (p.totalBytes === undefined || p.totalBytes === 0) {
    return p.doneBytes === undefined
      ? donePhase(p.phase)
      : `${donePhase(p.phase)} ${fmtMB(p.doneBytes)}`;
  }
  const done = p.doneBytes ?? 0;
  // 整数百分比：向下取整 + 封顶 100（doneBytes 异常超总量时字节数照实显示）
  const pct = Math.min(100, Math.floor((done / p.totalBytes) * 100));
  return `${p.phase} ${pct}%（${fmtMB(done)}/${fmtMB(p.totalBytes)}）`;
}

let overlayCount = 0;
let overlayEl: HTMLDivElement | null = null;
let progressEl: HTMLDivElement | null = null;
let cancelRowEl: HTMLDivElement | null = null;
let cancelBtnEl: HTMLButtonElement | null = null;
/** 活跃可取消任务的回调栈：并发遮罩共享一张卡，栈顶即按钮当前回调 */
const cancelStack: Array<() => void> = [];

/** 内联样式纯 DOM 助手（模块不引 CSS——保持零依赖可入 worker 外任意调用方） */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cssText: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = cssText;
  if (text !== undefined) node.textContent = text;
  return node;
}

function syncCancelButton() {
  if (!cancelRowEl || !cancelBtnEl) return;
  cancelRowEl.style.display = cancelStack.length > 0 ? "flex" : "none";
  cancelBtnEl.disabled = false;
  cancelBtnEl.textContent = "取消";
}

function ensureOverlay() {
  if (overlayEl) return;
  const root = el(
    "div",
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;background:oklch(0.35 0.06 258 / 0.32)",
  );
  root.setAttribute("role", "alert");
  // 验收补（C11）：遮罩自身即 busy 标记——session-kick 据此让位（覆盖提交页等未打标调用方）
  root.setAttribute("data-sp-busy", "1");

  // cgzxui 对齐（2026-11-05 修复波）：取消钮三态（新拟态凸起→悬停抬升→按压内陷）
  // 经 <style> 规则承载（cssText 只留版式）；spinner 动画改类承载——reduced-motion
  // 媒体查询可整灭（内联 animation shorthand 灭不掉）。色值全部 oklch 字面量：
  // 遮罩挂在 body 下，页面级 CSS 变量（.flow-page 等）作用域不可达，勿用 var()。
  const spinCss = document.createElement("style");
  spinCss.textContent =
    "@keyframes sp-crypto-spin{to{transform:rotate(360deg)}}" +
    ".sp-crypto-spin-anim{animation:sp-crypto-spin .9s linear infinite}" +
    ".sp-crypto-cancel{background:oklch(0.985 0.005 258);border:none;box-shadow:inset 0 1px 0 oklch(1 0 0/0.7),2px 2px 4px oklch(0.55 0.03 258/0.1),-1px -1px 3px oklch(1 0 0/0.85)}" +
    ".sp-crypto-cancel:hover:not(:disabled){transform:translateY(-1px);box-shadow:inset 0 1px 0 oklch(1 0 0/0.7),3px 3px 6px oklch(0.55 0.03 258/0.14),-1px -1px 3px oklch(1 0 0/0.85)}" +
    ".sp-crypto-cancel:active:not(:disabled){transform:none;box-shadow:inset 2px 2px 5px oklch(0.55 0.03 258/0.15),inset -2px -2px 5px oklch(1 0 0/0.5)}" +
    ".sp-crypto-cancel:disabled{opacity:.6;cursor:default}" +
    "@media (prefers-reduced-motion: reduce){.sp-crypto-spin-anim{animation:none}.sp-crypto-cancel:hover:not(:disabled){transform:none}}";
  root.appendChild(spinCss);

  // 卡片视觉对齐 cgzxui 弹窗语言（.gdlg-pn 同源）：无外侧框线、表面渐变、方向性
  // 双影（inset 高光 + 右下柔影 + 左上负向影，非全向投影）、tabular-nums
  const card = el(
    "div",
    "width:420px;max-width:calc(100vw - 48px);background:linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258));border-radius:16px;padding:24px 28px;box-shadow:inset 0 1px 0 oklch(1 0 0 / 0.75), 6px 6px 16px oklch(0.3 0.05 258 / 0.18), -1px -1px 3px oklch(1 0 0 / 0.85)",
  );
  const headerRow = el("div", "display:flex;align-items:center;gap:14px");
  const spinner = el(
    "div",
    "width:28px;height:28px;flex:none;border-radius:50%;border:3px solid oklch(0.55 0.03 258 / 0.12);border-top-color:oklch(0.5 0.16 258)",
  );
  spinner.className = "sp-crypto-spin-anim"; // 动画入类（reduced-motion 灭动画的挂点）
  headerRow.appendChild(spinner);
  // 进度行：初始文案沿用 B6 加密语境，首个 report() 起被实时覆盖（解密等场景自纠）
  const progress = el(
    "div",
    "flex:1;min-width:0;color:oklch(0.28 0.03 258);font-size:15px;font-weight:600;line-height:1.5;letter-spacing:.01em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere",
    "正在加密投标文件（国密 SM4 双层密封）…",
  );
  headerRow.appendChild(progress);
  card.appendChild(headerRow);
  card.appendChild(el("div", "height:1px;background:oklch(0.6 0.04 258 / 0.16);margin:16px 0 12px"));
  card.appendChild(
    el(
      "div",
      "color:oklch(0.47 0.025 258);font-size:12px;line-height:1.6",
      "大文件加密可能需要数分钟，请勿刷新或关闭本页面",
    ),
  );

  const cancelRow = el("div", "display:none;justify-content:flex-end;margin-top:14px");
  // 版式走 cssText；背景/边框/三态影子走上方 <style> 的 .sp-crypto-cancel 规则
  const cancelBtn = el(
    "button",
    "padding:8px 20px;border-radius:12px;color:oklch(0.28 0.03 258);font-size:13px;font-weight:600;font-family:inherit;cursor:pointer",
    "取消",
  );
  cancelBtn.type = "button";
  cancelBtn.className = "sp-crypto-cancel";
  cancelRow.appendChild(cancelBtn);
  card.appendChild(cancelRow);
  root.appendChild(card);
  document.body.appendChild(root);

  cancelBtn.addEventListener("click", () => {
    const top = cancelStack[cancelStack.length - 1];
    if (!top) return;
    // 点击只回调并锁定按钮——task 由调用方 reject，遮罩随之在 finally 撤除
    cancelBtn.disabled = true;
    cancelBtn.textContent = "正在取消…";
    top();
  });

  overlayEl = root;
  progressEl = progress;
  cancelRowEl = cancelRow;
  cancelBtnEl = cancelBtn;
}

export async function withCryptoOverlay<T>(
  task: (report: (p: OverlayProgress) => void) => Promise<T>,
  opts?: { cancel?: () => void },
): Promise<T> {
  const report = (p: OverlayProgress) => {
    // 纯 DOM 文本直写：无 React/无 state，遮罩已撤或 SSR 下为安全 noop
    if (progressEl) progressEl.textContent = formatProgress(p);
  };
  if (typeof document === "undefined") return task(report); // SSR 安全
  overlayCount++;
  ensureOverlay();
  const cancel = opts?.cancel;
  if (cancel) {
    cancelStack.push(cancel);
    syncCancelButton();
  }
  // 双 rAF：确保遮罩（含首帧进度行）已绘制到屏幕后才开跑任务
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    return await task(report);
  } finally {
    overlayCount--;
    if (cancel) {
      const idx = cancelStack.lastIndexOf(cancel);
      if (idx >= 0) cancelStack.splice(idx, 1);
      syncCancelButton();
    }
    if (overlayCount === 0 && overlayEl) {
      overlayEl.remove();
      overlayEl = null;
      progressEl = null;
      cancelRowEl = null;
      cancelBtnEl = null;
      cancelStack.length = 0; // 正常已空——防御异常路径泄漏
    }
  }
}
