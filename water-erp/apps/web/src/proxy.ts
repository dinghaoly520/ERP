import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiLoopbackOrigin } from '@water-erp/config';

const AUTH_COOKIE_NAME = 'token_web';

// 2026-10-29：Turbopack dev 沙箱里 middleware 的流式转发偶发「响应丢失」——后端已 200（OperationLog
// 有记录、个位数 ms），浏览器却永远 pending（客户端重试洪流 auth/me 每秒 8-16 次，用户侧升级为
// 整页重载风暴）。改为：手动 AbortController 超时（AbortSignal.timeout 在该沙箱不可用，实测致全挂）
// + 响应体 arrayBuffer 缓冲后回传（不走 upstream.body 流管道）。
// 2026-10-29 二次加固（用户裁定「不允许出现后端服务未启动」）：
//   a) 连接层失败（拒连/重置——请求未抵达后端，任意方法重放安全）全方法自动重试 4 次
//      （400ms/1s/3s/8s 退避，总跨度 ~12s）——桥接 nest watch 重编译/瞬时抖动窗口；
//   b) 响应体读取中断的请求已抵达后端，仅幂等（GET/HEAD）重试一次（保留原语义）；
//   c) /api/ai/* 为 LLM 慢路径（后端内部另有 3 次重试退避，合法耗时可达分钟级），
//      超时单独放宽——否则 15s 硬超时会把「后端活着只是慢」误杀成 502 后端服务未启动。
// 注意：大文件下载经此代理会整包缓冲（dev 可接受；生产走域名/直连轨道）。
const UPSTREAM_TIMEOUT_MS = 15_000;
const UPSTREAM_TIMEOUT_SLOW_MS = 120_000;
const TRANSPORT_RETRY_DELAYS_MS = [400, 1_000, 3_000, 8_000];
/** LLM 慢路径：后端内部另有重试退避，合法耗时可达分钟级。除 /api/ai/* 外还包括
 *  文件导入 AI 识别（解析 PDF/docx + LLM 全字段分析，同步慢路径）——2026-10-30 实录：
 *  import-autofill 未列入时吃 15s 硬超时，被误杀成 502「后端服务未启动」。 */
const UPSTREAM_SLOW_PATH_PREFIXES = ['/api/ai/'];
const UPSTREAM_SLOW_PATH_EXACT = ['/api/tender-write/import-autofill'];

function upstreamTimeoutFor(pathname: string): number {
  return UPSTREAM_SLOW_PATH_PREFIXES.some((p) => pathname.startsWith(p))
    || UPSTREAM_SLOW_PATH_EXACT.includes(pathname)
    ? UPSTREAM_TIMEOUT_SLOW_MS
    : UPSTREAM_TIMEOUT_MS;
}

interface UpstreamResult {
  status: number;
  statusText: string;
  headers: Headers;
  body: ArrayBuffer;
}

async function fetchUpstreamBuffered(
  targetUrl: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<UpstreamResult> {
  const idempotent = init.method === 'GET' || init.method === 'HEAD';
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  let transportAttempt = 0;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(targetUrl, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      // 连接层失败：请求未抵达后端，重放安全——全方法重试
      if (transportAttempt >= TRANSPORT_RETRY_DELAYS_MS.length) throw err;
      const delay = TRANSPORT_RETRY_DELAYS_MS[transportAttempt++];
      console.warn(`[proxy] upstream 不可达（第 ${transportAttempt} 次），${delay}ms 后重试 ${init.method} ${targetUrl}`);
      await sleep(delay);
      continue;
    }
    try {
      const body = await res.arrayBuffer();
      return { status: res.status, statusText: res.statusText, headers: res.headers, body };
    } catch (err) {
      // 响应体中断：请求已抵达后端，非幂等重放不安全——仅 GET/HEAD 重试一次
      if (!idempotent || attempt >= 1) throw err;
      console.warn(`[proxy] upstream 响应体中断，重试 GET ${targetUrl}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function proxy(request: NextRequest) {
  // ★ API proxy: forward /api/* to NestJS with full cookie passthrough
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const targetUrl = `${apiLoopbackOrigin()}${request.nextUrl.pathname}${request.nextUrl.search}`;

    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!['host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'expect', 'content-length'].includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    // ★ 从 request.cookies 重建 cookie 串 —— Next.js 会把原始 cookie header 解析到
    //    request.cookies API，导致 request.headers.get('cookie') 返回 null。
    const allCookies = request.cookies.getAll();
    if (allCookies.length > 0) {
      headers.set('cookie', allCookies.map((c) => `${c.name}=${c.value}`).join('; '));
    }
    if (!headers.has('x-portal')) headers.set('x-portal', 'web');

    const init: RequestInit = { method: request.method, headers };
    if (!['GET', 'HEAD'].includes(request.method)) {
      init.body = await request.arrayBuffer();
    }

    try {
      const upstream = await fetchUpstreamBuffered(targetUrl, init, upstreamTimeoutFor(request.nextUrl.pathname));
      const resHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
          resHeaders.set(key, value);
        }
      });
      return new NextResponse(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: resHeaders,
      });
    } catch (err) {
      // 分型报真实原因（2026-10-30 用户裁定：不允许「后端服务未启动」假错误直抛）——
      // 超时（AbortError）≠ 后端未启动；传输层失败报底层信息供定位
      const isTimeout = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
      if (isTimeout) {
        return new NextResponse(
          JSON.stringify({
            statusCode: 504,
            code: 'UPSTREAM_TIMEOUT',
            error: `后端响应超时：${request.nextUrl.pathname} 超过 ${upstreamTimeoutFor(request.nextUrl.pathname) / 1000} 秒代理时限（AI 分析类请求耗时较长，请稍后重试）`,
          }),
          { status: 504, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[proxy] upstream 失败 ${request.method} ${targetUrl}:`, detail);
      return new NextResponse(
        JSON.stringify({ statusCode: 502, code: 'PROXY_ERROR', error: `后端请求失败：${detail}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // ★ Auth gate: non-API routes check token_web
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    // 带上 search（登录后回跳原样 push）——深链 query 不丢：?category= 筛选直达、
    // /archive?pmi= 重定向后的 ?archivePmi= 归档卷直达（此前只保 pathname，query 全丢）
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|_next|$|.*\\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$).+)',
  ],
};
