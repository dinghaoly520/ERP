/**
 * :3005 单设备登录——被顶下线 / 账号冻结 提示（2026-08-21）。
 *
 * 后端 AuthGuard 对失效会话返回 401：
 *  - SESSION_REPLACED：账号已在其他设备/标签页登录。弹窗询问「是否反馈」，
 *    点是 → POST /auth/security-feedback 通知管理员处理，再回登录页；
 *  - ACCOUNT_FROZEN：账号被管理员冻结，单按钮提示。
 * DOM 直插全屏遮罩（不经 React，任何页面状态下都能弹出），不可关闭。
 * 回到登录页时账号密码由 session-store 的 prefill 预填。
 */

let shown = false;
// 2026-10-29：页面加载时 N 个并行请求同时 401（会话被顶/过期）会调度 N 个 goToLogin
// （20s 兜底定时器 + overlay 按钮回调），毫秒级连发 location.href 赋值形成「机关枪导航风暴」，
// 用户看到登录后无限闪跳/重复登录。一次性守卫：本页面生命周期内只允许发起一次跳转。
let redirecting = false;
// 待触发的兜底跳转定时器（重复调度时去重，防止 N 个 401 排 N 个定时器）
let fallbackTimer: number | undefined;

function goToLogin() {
  if (redirecting) return;
  if (window.location.pathname === "/login") return;
  redirecting = true;
  // 会话已被顶/失效：清掉本 tab 的陈旧 token，否则 SessionWatchdog/页面数据请求
  // 会继续带着死 token 轰 401，形成新一轮 overlay/定时器堆积
  try {
    window.sessionStorage.removeItem("webToken");
  } catch {
    /* 存储不可用忽略 */
  }
  window.location.href = "/login";
}

function scheduleFallbackRedirect() {
  if (fallbackTimer !== undefined) return;
  fallbackTimer = window.setTimeout(() => {
    fallbackTimer = undefined;
    goToLogin();
  }, 20000);
}

/** 反馈给管理员：携带本 tab 自己的旧 token（cookie 可能已是其他账号的），后端用其 JWT 确认反馈人身份 */
function sendSecurityFeedback() {
  let token: string | null = null;
  try {
    token = window.sessionStorage.getItem("webToken");
  } catch {
    /* 存储不可用忽略 */
  }
  return fetch("/api/auth/security-feedback", {
    method: "POST",
    credentials: "include",
    headers: { "X-Portal": "web", ...(token ? { "X-Web-Token": token } : {}) },
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

  const makeBtn = (text: string, primary: boolean, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = primary ? "neu-btn-primary" : "neu-btn-soft";
    btn.textContent = text;
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

/** 被顶下线：询问是否反馈管理员，两条路径都回登录页（账号密码预填） */
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
  // 长时间无操作也强制回登录页（被顶下线 = 会话已不可用；重复调度自动去重）
  scheduleFallbackRedirect();
}

/** 账号被冻结：仅提示，回登录页 */
export function showFrozenOverlay(message?: string) {
  renderOverlay({
    title: "账号已被冻结",
    desc: message && message.trim() ? message : "该账号已被冻结，请联系管理员处理。",
    primaryText: "知道了",
    onPrimary: goToLogin,
  });
  scheduleFallbackRedirect();
}
