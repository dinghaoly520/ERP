/**
 * bid-portal 会话失效全屏遮罩（X-P2-01，2026-09-29 审查修复）。
 * 冻结/被顶/JWT 过期此前在 :3007 无遮罩无跳转——现场端只显示接口错误横幅，
 * 主持人无感知继续操作全部失败。遮罩形态从 :3006 session-kick 简化移植
 * （本门户无「反馈管理员」双按钮体系，主持人是内部人员，单按钮重登即可）。
 */

/** 客户端跳 :3006 登录页——按当前访问主机构建（模块级 portalURL 绝对常量在 LAN
 * 平板上会跳 localhost：224debd3 修过 proxy 同款，此处为 app-shell 客户端侧同源修复）。 */
export function expertLoginUrl(extra = '?forceLogin=1'): string {
  if (typeof window === 'undefined') return `/login${extra}`;
  const { protocol, hostname } = window.location;
  const expertPort = 3006; // PORTS.expert
  return `${protocol}//${hostname}:${expertPort}/login${extra}`;
}

function goToLogin() {
  window.location.href = expertLoginUrl();
}

interface OverlaySpec {
  title: string;
  desc: string;
  primaryText: string;
  onPrimary?: () => void;
}

function renderOverlay(spec: OverlaySpec) {
  if (document.getElementById('bid-session-overlay')) return; // 幂等：遮罩已在不重复注入

  const overlay = document.createElement('div');
  overlay.id = 'bid-session-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
    'background:oklch(0.28 0.03 258 / 0.55);backdrop-filter:blur(2px);';
  const card = document.createElement('div');
  card.style.cssText =
    'max-width:400px;padding:28px 32px;border-radius:18px;text-align:center;' +
    'background:oklch(0.975 0.012 258);color:oklch(0.32 0.04 258);' +
    'box-shadow:6px 6px 14px oklch(0.75 0.02 258 / 0.5),-6px -6px 14px oklch(1 0 0 / 0.9);';
  const title = document.createElement('div');
  title.textContent = spec.title;
  title.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:10px;';
  const desc = document.createElement('div');
  desc.textContent = spec.desc;
  desc.style.cssText = 'font-size:13px;line-height:1.7;margin-bottom:20px;opacity:0.85;';
  const btn = document.createElement('button');
  btn.textContent = spec.primaryText;
  btn.style.cssText =
    'padding:9px 26px;border-radius:12px;border:1px solid oklch(0.82 0.02 258);cursor:pointer;' +
    'font-size:13px;font-weight:600;background:oklch(0.94 0.015 258);color:oklch(0.32 0.04 258);';
  btn.addEventListener('click', spec.onPrimary ?? goToLogin);
  card.append(title, desc, btn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

/** 会话被顶下线（他处登录）：提示后回登录页（经 :3006 分流重登） */
export function showSessionReplacedOverlay(message?: string) {
  renderOverlay({
    title: '登录已失效',
    desc: `${message && message.trim() ? message : '该账号已在其他设备登录'}。请重新登录后继续现场操作。`,
    primaryText: '重新登录',
  });
  window.setTimeout(() => {
    if (document.getElementById('bid-session-overlay')) goToLogin();
  }, 30000);
}

/** 账号被冻结 */
export function showFrozenOverlay(message?: string) {
  renderOverlay({
    title: '账号已被冻结',
    desc: message && message.trim() ? message : '该账号已被冻结，请联系管理员处理。',
    primaryText: '知道了',
  });
  window.setTimeout(() => {
    if (document.getElementById('bid-session-overlay')) goToLogin();
  }, 30000);
}
