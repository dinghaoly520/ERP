import * as net from 'net';
import { ensurePortFree } from './port-preflight';

/** dev 叠树防护（2026-10-16）：listen 前探针——占用即快速失败，杜绝 EADDRINUSE 下 bootstrap 挂起半死 */
describe('ensurePortFree — listen 预检', () => {
  it('端口空闲 → resolve（探针即开即收）', async () => {
    await expect(ensurePortFree(41234)).resolves.toBeUndefined();
  });

  it('端口被占 → reject PORT_IN_USE（第二实例秒退的依据）', async () => {
    const holder = net.createServer().listen(41235);
    await new Promise<void>((r) => holder.once('listening', () => r()));
    await expect(ensurePortFree(41235)).rejects.toThrow('PORT_IN_USE:41235');
    await new Promise<void>((r) => holder.close(() => r()));
  });

  it('占位者退出后 → 端口复检通过（不残留状态）', async () => {
    const holder = net.createServer().listen(41235);
    await new Promise<void>((r) => holder.once('listening', () => r()));
    await new Promise<void>((r) => holder.close(() => r()));
    await expect(ensurePortFree(41235)).resolves.toBeUndefined();
  });
});
