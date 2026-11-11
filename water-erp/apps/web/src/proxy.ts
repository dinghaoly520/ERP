import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiLoopbackOrigin } from '@water-erp/config';

const AUTH_COOKIE_NAME = 'token_web';

// 2026-10-29：Turbopack dev 沙箱流式转发偶发「响应丢失」（后端已 200、浏览器永远 pending）——
// 改为手动 AbortController 超时（AbortSignal.timeout 在该沙箱不可用）+ 响应体 arrayBuffer 缓冲回传。
// 同日二次加固（用户裁定「不允许出现后端服务未启动」）：
//   a) 连接层失败（请求未抵达后端，任意方法重放安全）全方法自动重试 4 次（400ms/1s/3s/8s 退避），
//      桥接 nest watch 重编译/瞬时抖动窗口；
//   b) 响应体读取中断已抵达后端，仅幂等（GET/HEAD）重试一次；
//   c) /api/ai/* LLM 慢路径（合法耗时可达分钟级）超时单独放宽，防 15s 硬超时误杀成 502。
// 注意：大文件下载经此代理整包缓冲（dev 可接受；生产走域名/直连轨道）。
const UPSTREAM_TIMEOUT_MS = 15_000;
const UPSTREAM_TIMEOUT_SLOW_MS = 120_000;
// 2026-11-11（生产实录「AI生成失败」）：采购文件长文字段（商务要求/技术要求/特定资格
// 要求）同步生成可达 2-5 分钟——120s 慢路径档先于后端 300s LLM 预算掐断。该端点单列
// 特慢档 330s（> 后端单次 300s，罩住外层重试的首轮全墙钟）。
const UPSTREAM_TIMEOUT_LLM_LONG_MS = 330_000;
const UPSTREAM_LLM_LONG_EXACT = ['/api/ai/tender-field-generate'];
const TRANSPORT_RETRY_DELAYS_MS = [400, 1_000, 3_000, 8_000];
/** LLM 慢路径：后端内部另有重试退避，合法耗时可达分钟级。除 /api/ai/* 外还包括
 *  文件导入 AI 识别（解析 PDF/docx + LLM 全字段分析，同步慢路径）——2026-10-30 实录：
 *  import-autofill 未列入时吃 15s 硬超时，被误杀成 502「后端服务未启动」。
 *  2026-11-09（慢路径审计·用户裁定）：专家抽取 AI 家族（extract/analyze-project、
 *  analyze-files、ai-leader、notify 等）全是同步 DeepSeek 调用，整前缀列入。 */
const UPSTREAM_SLOW_PATH_PREFIXES = ['/api/ai/', '/api/expert-admin/extract/'];
// 2026-11-04：公告导入识别（LLM 同链路，耐心重试下可达 ~30s）——未列入时吃 15s 硬超时
// 2026-11-09（生产实录）：专家 CSV 批量导入逐行串行（bcrypt 哈希+查重+事务），180 行在
// 生产硬件上 >15s 被 504——后端实际跑完但前端丢失逐行结果与 importedIds（一键启用断链）。
// 种子导入同链路串行哈希，一并放宽。同日慢路径审计补：定标审批表 LLM 识别（import-autofill
// 同族）与抽取主端点（前缀漏 /extract 本身需精确补位）。
const UPSTREAM_SLOW_PATH_EXACT = [
  '/api/tender-write/import-autofill',
  '/api/tender-write/announcement-import-autofill',
  '/api/tender-write/import-winning-bid',
  '/api/expert-admin/import-csv',
  '/api/expert-admin/import-from-seed',
  '/api/expert-admin/extract',
];
// 2026-11-09（慢路径审计·用户裁定）：动态 id 路径的同步 LLM 润色（/api/project-management/:id/attachment-ai-polish）
// ——精确匹配不了带参路径，补后缀匹配层。
const UPSTREAM_SLOW_PATH_SUFFIXES = ['/attachment-ai-polish'];
// 2026-11-06（生产实录）：知识库上传 235MB 经门户 arrayBuffer 缓冲转发，body 传输逼近 15s
// 临界带宽（~15MB/s）即被击穿 → API 侧 multer Request aborted——放大到 120s 覆盖大件传输窗。
// 异步化（202）已消掉处理侧长等待，此窗口只需罩住 body 本身的搬运。
const UPSTREAM_SLOW_PATH_PREFIXES_LARGE_BODY = ['/api/knowledge/'];

function upstreamTimeoutFor(pathname: string): number {
  if (UPSTREAM_LLM_LONG_EXACT.includes(pathname)) return UPSTREAM_TIMEOUT_LLM_LONG_MS;
  return UPSTREAM_SLOW_PATH_PREFIXES.some((p) => pathname.startsWith(p))
    || UPSTREAM_SLOW_PATH_EXACT.includes(pathname)
    || UPSTREAM_SLOW_PATH_SUFFIXES.some((s) => pathname.endsWith(s))
    || UPSTREAM_SLOW_PATH_PREFIXES_LARGE_BODY.some((p) => pathname.startsWith(p))
    ? UPSTREAM_TIMEOUT_SLOW_MS
    : UPSTREAM_TIMEOUT_MS;
}

interface UpstreamResult {
  status: number;
  statusText: string;
  headers: Headers;
  body: ArrayBuffer;
}

/** 导出仅供验证脚本测试（web 门户无 jest 基建） */
export async function fetchUpstreamBuffered(
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
      // 超时（本代理计时器主动 abort）≠ 连接层失败：请求可能已抵达后端且正在处理中，
      // 非幂等 POST 整包重放 = 重复副作用（2026-11-06 实录：知识库 118MB 上传被重放 4 次、
      // 后端并发跑出 5 份解析）。超时直抛外层，走 504 UPSTREAM_TIMEOUT 分型报文。
      if (err instanceof Error && err.name === 'AbortError') throw err;
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
            error: `后端响应超时：${request.nextUrl.pathname} 超过 ${upstreamTimeoutFor(request.nextUrl.pathname) / 1000} 秒代理时限——耗时操作（批量导入、文档解析、AI 分析等）后端通常仍在执行，请稍后刷新查看结果，勿立即重试`,
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
