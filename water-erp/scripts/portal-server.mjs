#!/usr/bin/env node
/**
 * 门户自定义服务器（2026-11-04 · 生产 WS 中继 · 路线③）：
 *
 * 背景：生产拓扑「外网机 HTTPS 解密（不可操作，整域转发）→ 内网前端机门户容器 → 后端 API
 * （前后端间仅开 API 端口）」。浏览器 WS（wire path 恒为 /socket.io/）随整域转发落到门户
 * 容器，而 next start 接不住 WS 升级——本服务器替代 next start：
 *   - 常规请求（页面 / REST）→ Next 原生 handler，行为与 next start 一致
 *   - /socket.io/* HTTP 请求 → 代理到 API_ORIGIN（socket.io polling 兜底通道）
 *   - /socket.io/* WS 升级   → 原始 TCP 双向管道到 API_ORIGIN（零依赖，无需 socket.io 库）
 *
 * 用法：node scripts/portal-server.mjs --dir apps/web --port 3005 [--host 0.0.0.0]
 * 上游：API_ORIGIN 环境变量（与 proxy.ts 同源；docker-compose.frontend.yml 已注入，
 *       缺省回环 127.0.0.1:4001）
 *
 * 铁律：除 host 外所有头原样透传——API 靠 Origin 子域判门户（token_web/supplier/bid）、
 * 靠 cookie 鉴权、靠 Upgrade/Sec-WebSocket-* 完成握手，改写任何一个即断链。
 * 备注：dev 模式（NODE_ENV!=production）下 Next HMR 的 /_next/webpack-hmr WS 不经本
 * 服务器中转（会被 destroy）——仅影响开发热更，生产无此路径。
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { resolve as pathResolve } from 'node:path';
import { createRequire } from 'node:module';
import { parse as urlParse } from 'node:url';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dir = getArg('--dir', 'apps/web');
const port = Number(getArg('--port', '3000'));
const hostname = getArg('--host', '0.0.0.0');
const dev = process.env.NODE_ENV !== 'production';

const WS_PATH = '/socket.io/';
const upstream = (process.env.API_ORIGIN || 'http://127.0.0.1:4001').replace(/\/+$/, '');
const up = urlParse(upstream);
const upPort = Number(up.port || 80);
const upHostPort = `${up.hostname}${up.port ? `:${up.port}` : ''}`;

// next 必须从各门户自己的 node_modules 解析（pnpm workspace：根 node_modules 无 next）
const appRequire = createRequire(pathResolve(dir, 'package.json'));
const nextFactory = appRequire('next');

const app = nextFactory({ dev, dir });
const handle = app.getRequestHandler();
await app.prepare();

/** /socket.io/* 普通 HTTP 请求（engine.io polling）→ 上游代理 */
function proxyHttp(req, res) {
  const headers = { ...req.headers, host: upHostPort };
  const pr = httpRequest(
    { hostname: up.hostname, port: upPort, path: req.url, method: req.method, headers },
    (prRes) => {
      res.writeHead(prRes.statusCode || 502, prRes.headers);
      prRes.pipe(res);
    },
  );
  pr.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`portal-server: upstream ${upstream} unreachable (${e.code || e.message})`);
  });
  req.pipe(pr);
}

/** /socket.io/* WS 升级 → 原始 TCP 双向管道（重建请求头 + 透传，含 head 首包） */
function relayUpgrade(req, socket, head) {
  const upSock = netConnect(upPort, up.hostname, () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'host') continue;
      raw += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
    }
    raw += `host: ${upHostPort}\r\n\r\n`;
    upSock.write(raw);
    if (head && head.length) upSock.write(head);
    socket.pipe(upSock);
    upSock.pipe(socket);
  });
  upSock.on('error', () => socket.destroy());
  socket.on('error', () => upSock.destroy());
  upSock.on('close', () => socket.destroy());
  socket.on('close', () => upSock.destroy());
}

const server = createServer((req, res) => {
  if (req.url && req.url.startsWith(WS_PATH)) return proxyHttp(req, res);
  return handle(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url || !req.url.startsWith(WS_PATH)) return socket.destroy();
  relayUpgrade(req, socket, head);
});

server.keepAliveTimeout = 75_000;
server.listen(port, hostname, () => {
  console.log(`[portal-server] ${dir} @ http://${hostname}:${port} (dev=${dev})`);
  console.log(`[portal-server] ${WS_PATH}* → ${upstream}（HTTP 代理 + WS TCP 管道）`);
});
