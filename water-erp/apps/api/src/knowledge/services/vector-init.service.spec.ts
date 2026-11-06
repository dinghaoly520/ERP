import { VectorInitService } from './vector-init.service';

/** M-6（2026-11-06 评审）：向量库表/索引段初始化失败不得阻断进程启动——
 *  knowledge-parse 并入 ai-bid worker 后，该段硬失败会连带 AI 分析 worker 起不来。
 *  语义改为软失败：extension/建表任一失败记日志放行，故障延迟到首次向量读写时暴露。 */
function mkSvc(behavior: { ext?: 'ok' | 'fail'; table?: 'ok' | 'fail' }) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('CREATE EXTENSION')) {
      if (behavior.ext === 'fail') throw new Error('extension denied');
      return;
    }
    if (behavior.table === 'fail') throw new Error('vector db down');
    return;
  });
  const svc = new VectorInitService(
    { getPool: () => ({ query }), describeTarget: () => 'mock-vector-db' } as any,
    { get: () => 'true' } as any,
  );
  return { svc, query };
}

describe('VectorInitService 软失败（M-6）', () => {
  it('建表/索引段失败 → onModuleInit 仍 resolve（不阻断 worker/API 启动）', async () => {
    const { svc } = mkSvc({ ext: 'ok', table: 'fail' });
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('extension 段失败 → 同样 resolve（既有行为保持）', async () => {
    const { svc } = mkSvc({ ext: 'fail' });
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('全链成功 → 建表+两索引均执行', async () => {
    const { svc, query } = mkSvc({ ext: 'ok', table: 'ok' });
    await svc.onModuleInit();
    expect(query).toHaveBeenCalledTimes(4);
  });
});
