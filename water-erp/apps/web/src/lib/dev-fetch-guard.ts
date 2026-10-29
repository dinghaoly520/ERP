/**
 * dev 专用 fetch 守护（2026-10-29）。
 *
 * Turbopack dev 沙箱下偶发「页面加载首批 /api 请求响应丢失」：后端已 200（OperationLog
 * 个位数 ms）、curl 同端点秒通、但浏览器内同请求永久 pending——丢失点在 Next dev
 * middleware 之后的内部管道（proxy.ts 层加超时也无法命中，实测 0 次触发），服务端无法
 * 自愈。挂死的首批请求会卡住整页数据加载（「加载中...」永不消失），并诱发用户侧反复
 * 手动刷新/重载风暴——这是 web dev worker 内存螺旋的主要加速器之一。
 *
 * 客户端自救：/api/* 的幂等请求（GET/HEAD）10s 超时中止并自动重试一次（重试会走新
 * 连接，实测新请求秒回）。生产构建不启用（生产走域名/直连轨道，无 dev 沙箱缺陷）。
 */
if (
  process.env.NODE_ENV === "development" &&
  typeof window !== "undefined" &&
  !(window as unknown as Record<string, unknown>).__fetchGuardInstalled
) {
  (window as unknown as Record<string, unknown>).__fetchGuardInstalled = true;
  const origFetch = window.fetch.bind(window);

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let method = "GET";
    if (init?.method) method = init.method;
    else if (typeof input !== "string" && !(input instanceof URL) && input.method)
      method = input.method;
    const isIdempotentApi =
      url.includes("/api/") && ["GET", "HEAD"].includes(method.toUpperCase());
    if (!isIdempotentApi) return origFetch(input, init);

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        return await origFetch(input, { ...init, signal: controller.signal });
      } catch (err) {
        // 超时中止后重试一次（新请求通常走新连接即恢复）；其余错误原样抛出
        if (attempt === 0 && (err as Error)?.name === "AbortError") continue;
        throw err;
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export {};
