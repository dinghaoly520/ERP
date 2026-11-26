/**
 * 浏览器侧文件 SHA-256（2026-11-24 项目管理同文件查重）：crypto.subtle 需 secure
 * context（dev=localhost / 生产 https 均满足）。整读 arrayBuffer——500MB 上限件会
 * 短时占同量内存，桌面工作台可接受；调用方失败降级（查重不可用不阻断上传）。
 */
export async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
