/* AdminKeyService —— 管理方加密证书 keystore（生成/轮转/bootstrap/600 权限）
   tmpdir 做 keystore、mock prisma（adminEncryptionCert + $transaction 直通），不碰真实 DB。 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AdminKeyService } from './admin-keystore.service';

const sm2 = require('sm-crypto').sm2;

describe('AdminKeyService', () => {
  let dir: string;
  let svc: AdminKeyService;
  let prisma: any;
  let seq = 0;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystore-'));
    process.env.ADMIN_KEYSTORE_DIR = dir;
    seq = 0;
    prisma = {
      adminEncryptionCert: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      // 交互式事务 mock：tx 即 prisma 本身（updateMany/create 均落到同一组 jest.fn）
      $transaction: (fn: any) => fn(prisma),
    };
    // Prisma 端 @default(cuid()) 在 mock 侧补齐
    prisma.adminEncryptionCert.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: `cert-${++seq}`, ...data, createdAt: new Date() }),
    );
    svc = new AdminKeyService(prisma as any);
  });
  afterEach(() => {
    delete process.env.ADMIN_KEYSTORE_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('generate：私钥落盘 600 权限、公钥入库置 active、旧证全部 inactive', async () => {
    const cert = await svc.generate();
    expect(cert.publicKey).toMatch(/^04[0-9a-fA-F]{128}$/);
    expect(cert.certDn).toBe('CN=蜀水云采-管理方加密证书');
    expect(cert.active).toBe(true);

    const file = path.join(dir, cert.id);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const priv = fs.readFileSync(file, 'utf8');
    expect(
      sm2.doVerifySignature('m', sm2.doSignature('m', priv, { hash: true }), cert.publicKey, { hash: true }),
    ).toBe(true);

    // 轮转：事务内先 updateMany 旧 active→false，再 create 新行
    expect(prisma.adminEncryptionCert.updateMany).toHaveBeenCalledWith({
      where: { active: true },
      data: { active: false },
    });
    expect(prisma.adminEncryptionCert.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.adminEncryptionCert.create.mock.invocationCallOrder[0],
    );
  });

  it('generate：writeFileSync 抛错（ENOSPC）→ 新行 active:false 回滚 + generate rejects（防公钥入库无私钥且 ensureBootstrap 不自愈）', async () => {
    const spy = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    await expect(svc.generate()).rejects.toThrow('ENOSPC');
    // 事务内的旧 active→false 之外，还应有一次针对新行 id 的 active:false 回滚
    expect(prisma.adminEncryptionCert.updateMany).toHaveBeenCalledWith({
      where: { id: 'cert-1' },
      data: { active: false },
    });
    spy.mockRestore();
  });

  it('ensureBootstrap：无 active 自动生成；已有则不生成', async () => {
    prisma.adminEncryptionCert.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'x' });
    await svc.ensureBootstrap();
    expect(prisma.adminEncryptionCert.create).toHaveBeenCalledTimes(1);
    await svc.ensureBootstrap();
    expect(prisma.adminEncryptionCert.create).toHaveBeenCalledTimes(1);
  });

  it('readPrivateKey：adminCertId 定位对应文件（轮转后旧证仍可读）', async () => {
    const c1 = await svc.generate();
    const c2 = await svc.generate();
    expect(await svc.readPrivateKey(c1.id)).toBeTruthy();
    expect(await svc.readPrivateKey(c2.id)).not.toBe(await svc.readPrivateKey(c1.id));
  });

  it('readPrivateKey：未知 id 抛错', async () => {
    await expect(svc.readPrivateKey('nope')).rejects.toThrow(/不存在/);
  });
});
