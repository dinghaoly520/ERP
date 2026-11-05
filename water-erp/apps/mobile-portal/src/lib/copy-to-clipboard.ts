/**
 * 复制到剪贴板（四门户 2026-10-16 加固口径）：navigator.clipboard 仅 https/localhost 可用，降级
 * execCommand+临时 textarea（iOS Safari 需 readonly+显式选区、fixed 移出视口、finally 移除防残留）；
 * 双双失败返回 false——调用方必须据返回值给反馈，禁止无条件 toast「已复制」。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 降级 */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS Safari 需显式选区
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  } finally {
    document.body.removeChild(ta);
  }
}
