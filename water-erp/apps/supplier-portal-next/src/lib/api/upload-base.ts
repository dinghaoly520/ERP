import { apiOrigin, PORTS } from "@water-erp/config";

/**
 * 上传端点 base：开发环境直连 API origin（Next dev 代理对 ~1.5MB+ 请求体截断，
 * 50MB 级标书上传 multipart 尾部丢失 → 502/multer "Unexpected end of form"，2026-09-10 实测），
 * 生产仍走同源 /api 代理（CORS/域名策略不变）。
 *
 * 浏览器端不读 apiOrigin()——API_ORIGIN 是服务端 env、不会内联进浏览器包，
 * LAN 设备访问时会解析成客户端自己的 localhost（2026-10-09 局域网缺口）；
 * 按 window.location 主机推导后，本机 localhost 与局域网 IP 访问均自适应。
 * SSR（无 window）仍走 apiOrigin()，服务端 env 可用。
 */
export function resolveUploadBase(): string {
  if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_API_BASE) {
    if (typeof window !== "undefined") {
      return `${window.location.protocol}//${window.location.hostname}:${PORTS.api}/api`;
    }
    return `${apiOrigin()}/api`;
  }
  return process.env.NEXT_PUBLIC_API_BASE || "/api";
}

export const UPLOAD_BASE = resolveUploadBase();
