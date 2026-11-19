/**
 * 剪贴板复制（门户自包含副本，同 web/bid/supplier 口径）：
 * navigator.clipboard 仅 https/localhost 可用，http 演示环境直用=点击无反应或谎报
 * 「已复制」——execCommand 降级返回真实布尔，调用方必须按结果反馈。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 降级 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
