/**
 * :3006 专家门户单设备登录——被顶下线 / 账号冻结 提示（2026-09-20，移植自 :3004/:3005）。
 *
 * 后端 AuthGuard 对失效会话返回 401：
 *  - SESSION_REPLACED：该账号已在其他设备/浏览器登录（后登录者顶掉先登录者——
 *    评标中他人冒用身份证号口令登录即踢真专家，冒用会话无法与真会话并存）。
 *    弹窗询问「是否反馈」，点是 → POST /auth/security-feedback 通知管理员，再回登录页；
 *  - ACCOUNT_FROZEN：账号被管理员冻结，单按钮提示。
 * DOM 直插全屏遮罩（不经 React，任何页面状态下都能弹出），不可关闭。
 * 与 :3004 的差异：本门户 globals.css 无 neu-icon-well / neu-btn-group，图标井与
 * 按钮行用内联样式；纯 cookie 会话（无 X-*-Token 头），反馈请求经 Next 代理自动带
 * token_expert cookie——被踢设备的 cookie 仍是自己的旧 token，后端验签确认反馈人身份。
 */

let shown = false;

function goToLogin() {
  if (window.location.pathname !== '/login') window.location.href = '/login';
}

/** 反馈给管理员：身份取 token_expert cookie 里的旧 token（签名仍有效，仅会话被顶） */
function sendSecurityFeedback() {
  return fetch('/api/auth/security-feedback', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Portal': 'expert' },
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
  if (typeof window === 'undefined' || shown) return;
  shown = true;

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'background:oklch(0.2 0.02 258 / 0.45)',
    'backdrop-filter:blur(4px)',
  ].join(';');

  const card = document.createElement('div');
  card.className = 'neu-card';
  card.style.cssText = 'max-width:400px;width:100%;padding:28px;text-align:center;';

  const iconWell = document.createElement('div');
  iconWell.style.cssText = [
    'margin:0 auto 16px',
    'width:52px',
    'height:52px',
    'border-radius:16px',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:oklch(0.985 0.005 258)',
    'box-shadow:inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75)',
  ].join(';');
  iconWell.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:15px;font-weight:600;color:var(--foreground);';
  title.textContent = spec.title;

  const desc = document.createElement('div');
  desc.style.cssText = 'margin-top:8px;font-size:13px;line-height:1.7;color:var(--muted-foreground);';
  desc.textContent = spec.desc;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'margin-top:20px;display:flex;gap:12px;justify-content:center;';

  const makeBtn = (text: string, primary: boolean, onClick: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = primary ? 'neu-btn-primary' : 'neu-btn-soft';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
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
    title: '登录已失效',
    desc: `${message && message.trim() ? message : '该账号已在其他设备登录'}。是否向管理员反馈？`,
    primaryText: '反馈给管理员',
    onPrimary: () => {
      void sendSecurityFeedback().finally(goToLogin);
    },
    secondaryText: '直接重新登录',
    onSecondary: goToLogin,
  });
  // 长时间无操作也强制回登录页（被顶下线 = 会话已不可用）
  window.setTimeout(goToLogin, 20000);
}

/** 账号被冻结：仅提示，回登录页 */
export function showFrozenOverlay(message?: string) {
  renderOverlay({
    title: '账号已被冻结',
    desc: message && message.trim() ? message : '该账号已被冻结，请联系管理员处理。',
    primaryText: '知道了',
    onPrimary: goToLogin,
  });
  window.setTimeout(goToLogin, 20000);
}
