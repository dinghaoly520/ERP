import { ConfigService } from '@nestjs/config';
import { VectorDbService } from './vector-db.service';

describe('VectorDbService 连接串回退链', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  function make() {
    return new VectorDbService(new ConfigService());
  }

  it('VECTOR_DATABASE_URL 显式设置时最优先（sidecar 形态）', () => {
    process.env.VECTOR_DATABASE_URL = 'postgresql://u:p@vdb:5432/water_erp';
    process.env.DIRECT_URL = 'postgresql://u:p@pg:5432/water_erp';
    process.env.DATABASE_URL = 'postgresql://u:p@pg:6432/water_erp';
    const svc = make();
    expect(svc.connectionString).toBe('postgresql://u:p@vdb:5432/water_erp');
    expect(svc.sourceLabel).toContain('VECTOR_DATABASE_URL');
  });

  it('未设 VECTOR_DATABASE_URL 时回退 DIRECT_URL（绕开 pgbouncer——扩展协议与 transaction 池不兼容）', () => {
    delete process.env.VECTOR_DATABASE_URL;
    process.env.DIRECT_URL = 'postgresql://u:p@pg:5432/water_erp';
    process.env.DATABASE_URL = 'postgresql://u:p@pg:6432/water_erp?pgbouncer=true';
    const svc = make();
    expect(svc.connectionString).toBe('postgresql://u:p@pg:5432/water_erp');
    expect(svc.sourceLabel).toContain('DIRECT_URL');
  });

  it('DIRECT_URL 也缺失时回退 DATABASE_URL', () => {
    delete process.env.VECTOR_DATABASE_URL;
    delete process.env.DIRECT_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@pg:6432/water_erp';
    const svc = make();
    expect(svc.connectionString).toBe('postgresql://u:p@pg:6432/water_erp');
    expect(svc.sourceLabel).toContain('DATABASE_URL');
  });

  it('describeTarget 只输出 host:port/db，不泄漏密码', () => {
    process.env.DIRECT_URL = 'postgresql://secretuser:secretpw@pg.internal:5432/water_erp?ssl=true';
    const svc = make();
    const t = svc.describeTarget();
    expect(t).toBe('pg.internal:5432/water_erp');
    expect(t).not.toContain('secret');
  });
});
