/**
 * 鉴权文件读取/下载（2026-09-30 第二轮审计 B1-2）。
 *
 * 裸 `<a href="/api/upload/files/:id">` 只能凭 cookie——单设备登录体系下同浏览器
 * 他 tab 登录会覆盖 cookie，本人文件的引用链授权（后端 canAccessFile 按
 * supplierId 反查）在「新登录者」身份下不命中 → 统一 403「无权访问该文件」。
 * 统一改走 fetch 携带 X-Supplier-Token（后端 tokenFromRequest 头优先、cookie
 * 回退）；无 tab token（新开 tab / 无头客户端）自然退化为纯 cookie，行为不变。
 */
import { toast } from "sonner";
import { getSupplierToken } from "./session-store";

export function authedHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "X-Portal": "supplier" };
  const token = getSupplierToken();
  if (token) headers["X-Supplier-Token"] = token;
  return headers;
}

/** fetch 文件为 Blob；非 2xx 抛 Error（文案取响应体 error 字段，无则 HTTP 兜底） */
export async function fetchAuthedFile(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: "include", headers: authedHeaders() });
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* 非 JSON（如 404 HTML）用兜底文案 */ }
    throw new Error(String(body.error ?? `文件获取失败（HTTP ${res.status}）`));
  }
  return res.blob();
}

/** 新标签打开（浏览器内建 PDF/图片预览）；objectURL 延迟回收，预览器加载完不失效 */
export async function openAuthedFile(url: string): Promise<void> {
  const blob = await fetchAuthedFile(url);
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** 触发浏览器下载（fileName 指定保存名，缺省由浏览器定） */
export async function downloadAuthedFile(url: string, fileName?: string): Promise<void> {
  const blob = await fetchAuthedFile(url);
  await saveBlob(blob, fileName);
}

/**
 * 已持有 blob 的落盘下载（2026-10-19 收口：bids/[id] 与 announcements/[id] 的 doDownload
 * 原各自内联「离屏 anchor + click 后立即 revokeObjectURL」——真实浏览器中 revoke 抢在读取
 * blob URL 之前，下载静默失败/截断（API 已 200、fetch/blob 均成功，唯独不落盘）。
 * 与 downloadAuthedFile 同一口径：挂 DOM 锚 + 60s 延迟 revoke。
 */
export async function saveBlob(blob: Blob, fileName?: string): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  if (fileName) a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** 页面 onClick 便捷封装：view=新标签预览 / download=保存；失败统一 toast（带后端文案） */
export function authedFileAction(url: string, mode: "view" | "download", fileName?: string): void {
  const op = mode === "view" ? openAuthedFile(url) : downloadAuthedFile(url, fileName);
  op.catch((e: unknown) => toast.error(e instanceof Error ? e.message : "文件获取失败"));
}
