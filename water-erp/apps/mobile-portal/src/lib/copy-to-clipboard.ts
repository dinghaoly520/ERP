/**
 * 复制到剪贴板（对齐四姊妹门户 2026-10-16 加固口径）：
 * navigator.clipboard 仅 https/localhost 可用——局域网 http 演示环境直用=点击无反应。
 * 降级走 document.execCommand('copy') + 临时 textarea（已废弃但 http 下唯一可用）；
 * iOS Safari 需 readonly + focus + setSelectionRange 显式选区，且移出视口用
 * fixed;top:-9999px 而非仅 opacity；removeChild 放 finally——execCommand 抛错也不残留
 * 隐形 textarea。两者都失败返回 false——调用方必须据返回值给反馈，禁止无条件 toast「已复制」。
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
