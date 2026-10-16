/**
 * 复制到剪贴板（secure context 降级兜底，2026-10-16）：
 * navigator.clipboard 仅 https/localhost 可用——局域网 http 访问 :3005 演示环境时
 * 直接 undefined，调用点静默吞错=「点击无反应」（邀请码复制按钮实录）。
 * 降级走 document.execCommand('copy') + 临时 textarea（已废弃但 http 下唯一可用）；
 * 两者都失败返回 false——调用方必须据返回值给反馈，禁止无条件 toast「已复制」。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 权限拒绝/焦点丢失等 → 降级兜底 */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS Safari 需显式选区
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
