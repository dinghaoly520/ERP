/**
 * :3004 供应商门户单设备登录——被顶下线 / 账号冻结 提示（2026-09-18，移植自 :3005）。
 *
 * 后端 AuthGuard 对失效会话返回 401：
 *  - SESSION_REPLACED：该账号已在其他设备/浏览器/标签页登录（后登录者顶掉先登录者）。弹窗询问
 *    「是否反馈」，点是 → POST /auth/security-feedback 通知管理员处理，再回登录页；
 *  - ACCOUNT_FROZEN：账号被管理员冻结，单按钮提示。
 * DOM 直插全屏遮罩（不经 React，任何页面状态下都能弹出），不可关闭。
 * 会话体系（2026-09-28 tab 级 token）：请求优先带本 tab 的 X-Supplier-Token（sessionStorage）。
 * 反馈身份取该旧 token（签名仍有效，仅 sid 被顶）——同浏览器场景下 cookie 已被新登录者
 * 覆盖，带 cookie 反馈会冒名成新登录者；跨设备场景 cookie 仍是自己的旧 token，两头皆准。
 */

import { getSupplierToken, clearSupplierToken } from "./session-store";

let shown = false;

function goToLogin() {
  clearSupplierToken();
  if (window.location.pathname !== "/login") window.location.href = "/login";
}

/** 反馈给管理员：身份取本 tab 旧 token（签名仍有效，仅会话被顶）；无则回退 cookie */
function sendSecurityFeedback() {
  const token = getSupplierToken();
  return fetch("/api/auth/security-feedback", {
    method: "POST",
    credentials: "include",
    headers: { "X-Portal": "supplier", ...(token ? { "X-Supplier-Token": token } : {}) },
  }).catch(() => {
    /* 反馈失败不阻塞回登录页 */
  });
}

interface OverlaySpec {
  title: string;
  desc: string;
  primaryText: string;
  onPrimary?: () => void;
  secondaryText?: string;
  onSecondary?: () => void;
}

function renderOverlay(spec: OverlaySpec) {
  if (typeof window === "undefined" || shown) return;
  shown = true;
  // 广播会话失效（2026-09-30 B1-2）：实时通知 / 开标 WS 收到后立即断开并停止重连——
  // 否则重连 handshake 携带的是覆盖者的 cookie，旧 tab 会继续弹出他人账号的通知内容。
  window.dispatchEvent(new Event("supplier:session-invalid"));

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:99999",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:24px",
    "background:oklch(0.2 0.02 258 / 0.45)",
    "backdrop-filter:blur(4px)",
  ].join(";");

  const card = document.createElement("div");
  card.className = "neu-card";
  card.style.cssText = "max-width:400px;width:100%;padding:28px;text-align:center;";

  const iconWell = document.createElement("div");
  iconWell.className = "neu-icon-well";
  iconWell.style.cssText = "margin:0 auto 16px;width:52px;height:52px;border-radius:16px;display:flex;align-items:center;justify-content:center;";
  iconWell.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  const title = document.createElement("div");
  title.style.cssText = "font-size:15px;font-weight:600;color:var(--foreground);";
  title.textContent = spec.title;

  const desc = document.createElement("div");
  desc.style.cssText = "margin-top:8px;font-size:13px;line-height:1.7;color:var(--muted-foreground);";
  desc.textContent = spec.desc;

  const btnRow = document.createElement("div");
  btnRow.className = "neu-btn-group";
  btnRow.style.cssText = "margin-top:20px;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;";

  // 两个按钮统一白瓷片设计（cgzxui 白瓷片语义）：纯白底 + 顶部内高光 + 方向性双影。
  // 主次区分不再靠底色，而靠字重（primary=700 / secondary=600）与文字色（主=品牌蓝 / 次=muted）。
  // inline style 直接覆盖——overlay 是 DOM 直插，CSS 类级联在特定加载时序下可能不生效。
  const makeBtn = (text: string, primary: boolean, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 20px;border:none;border-radius:9px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap;" +
      (primary
        ? "font-weight:700;color:var(--accent-strong,var(--brand,#064ea2));"
        : "font-weight:600;color:var(--fg-2,#5a6d8a);") +
      "background:oklch(1 0 0);box-shadow:inset 0 1px 0 oklch(1 0 0/0.95),2px 2px 6px oklch(0.55 0.03 258/0.16),-1px -1px 2px oklch(1 0 0/0.95);transition:transform 0.2s ease,box-shadow 0.2s ease;";
    btn.textContent = text;
    // hover 三态：inline style 不支持 :hover，用事件切换 box-shadow + transform
    const baseShadow = "inset 0 1px 0 oklch(1 0 0/0.95),2px 2px 6px oklch(0.55 0.03 258/0.16),-1px -1px 2px oklch(1 0 0/0.95)";
    const hoverShadow = "inset 0 1px 0 oklch(1 0 0/0.95),3px 3px 8px oklch(0.55 0.03 258/0.2),-2px -2px 4px oklch(1 0 0/0.98)";
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "translateY(-1px)";
      btn.style.boxShadow = hoverShadow;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "";
      btn.style.boxShadow = baseShadow;
    });
    btn.addEventListener("click", onClick);
    return btn;
  };

  if (spec.onSecondary && spec.secondaryText) {
    btnRow.appendChild(makeBtn(spec.secondaryText, false, spec.onSecondary));
  }
  btnRow.appendChild(makeBtn(spec.primaryText, true, spec.onPrimary ?? goToLogin));

  card.append(iconWell, title, desc, btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

/** 被顶下线：询问是否反馈管理员，两条路径都回登录页 */
export function showSessionReplacedOverlay(message?: string) {
  renderOverlay({
    title: "登录已失效",
    desc: `${message && message.trim() ? message : "该账号已在其他设备登录"}。是否向管理员反馈？`,
    primaryText: "反馈给管理员",
    onPrimary: () => {
      void sendSecurityFeedback().finally(goToLogin);
    },
    secondaryText: "直接重新登录",
    onSecondary: goToLogin,
  });
  // 长时间无操作也强制回登录页（被顶下线 = 会话已不可用）
  window.setTimeout(goToLogin, 20000);
}

/** 账号被冻结：仅提示，回登录页 */
export function showFrozenOverlay(message?: string) {
  renderOverlay({
    title: "账号已被冻结",
    desc: message && message.trim() ? message : "该账号已被冻结，请联系管理员处理。",
    primaryText: "知道了",
    onPrimary: goToLogin,
  });
  window.setTimeout(goToLogin, 20000);
}
