import * as net from 'net';

/**
 * dev 叠树防护（2026-10-16）：listen 前端口探针。
 *
 * 背景：main.ts 裸 `await app.listen(port)` 在 EADDRINUSE 下 bootstrap 会挂起而非干净退出
 * （实测形态：node dist/main Sl+ 状态吊 18 分钟，不绑端口也不退出）——残树半死的病灶本体。
 * 预检让第二实例秒退且在 concurrently 面板可见，配合升级版 dev:kill 全链清理，
 * 叠树（两棵 watch 同写 dist/ 抢端口）从两个失效形态上都被堵死。
 *
 * 探针与 app.listen 同为默认 socket 选项（libuv SO_REUSEADDR），TIME_WAIT 可复用、
 * 已有 LISTEN 持有者必 EADDRINUSE——语义与真实 listen 一致。
 */
export async function ensurePortFree(port: number | string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    const fail = () => {
      probe.close();
      reject(new Error(`PORT_IN_USE:${port}`));
    };
    probe.once('error', fail);
    probe.once('listening', () => probe.close(() => resolve()));
    probe.listen(port);
  });
}
