/**
 * 守护式下载（#166③ 口径 · 2026-11-18 §五.4-1 自 signing-tab 抽 lib 共用）：
 * fetch+blob 带名落盘——显式 X-Portal 头让门户判定确定性成立（不依赖 Referer 直链族），
 * 文件名优先取 Content-Disposition（upload 端点直出 asset.originalName），回退调用方给定名。
 * 直链消费点新增下载语义时一律走本 helper（守护式为全库最强口径——:3005 opening-handover-zip
 * 等处仍是裸 <a> 靠服务端 CD 落盘，无 X-Portal 确定性，勿以其为对标）；
 * target=_blank 的查看语义直链不在此列（auth 已由 portal-cookie 子域反查兜底）。
 */
import { toast } from 'sonner';

export async function downloadAsBlob(url: string, fallbackName: string, failLabel = '文件') {
  try {
    const res = await fetch(url, { credentials: 'include', headers: { 'X-Portal': 'bid' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cd = res.headers.get('Content-Disposition') ?? '';
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd);
    let name = fallbackName;
    if (m) { try { name = decodeURIComponent(m[1]) || fallbackName; } catch { name = m[1].includes('%') ? fallbackName : m[1]; } } // P3：decode 失败不丢下载——含 % 判非编码名回退
    const blob = await res.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    URL.revokeObjectURL(u);
  } catch {
    toast.error(`${failLabel}下载失败，请稍后重试`);
  }
}
