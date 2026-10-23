import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreateContactDto } from './create-contact.dto';
import { UpdateContactDto } from './update-contact.dto';

/**
 * 联系人 DTO 白名单回归（2026-10-22 bug）：全局 ValidationPipe whitelist:true 会剥掉
 * DTO 未声明的字段——UpdateContactDto 漏声明 position/gender/idCard 时，service 的
 * B4-2 写入面永远收到 undefined，「编辑联系人保存成功但字段全丢」。此测试直接锁
 * 「管道处理后字段存活」，模拟真实请求链（mock service 层测不到这类剥离）。
 */
describe('联系人 DTO × ValidationPipe whitelist', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const meta = { type: 'body' as const, metatype: UpdateContactDto, data: '' };
  const payload = {
    name: '王仁平',
    phone: '13700000233',
    email: 'contact233@example.com',
    position: '项目经理',
    gender: '男',
    idCard: '510108199001011234',
    isPrimary: true,
  };

  it('UpdateContactDto：position/gender/idCard 经管道后存活（编辑联系人修复）', async () => {
    const v = (await pipe.transform(payload, { ...meta, metatype: UpdateContactDto })) as UpdateContactDto;
    expect(v.position).toBe('项目经理');
    expect(v.gender).toBe('男');
    expect(v.idCard).toBe('510108199001011234');
  });

  it('CreateContactDto：六字段经管道后存活（回归锁，防同类漏声明）', async () => {
    const v = (await pipe.transform(payload, { ...meta, metatype: CreateContactDto })) as CreateContactDto;
    expect(v.position).toBe('项目经理');
    expect(v.gender).toBe('男');
    expect(v.idCard).toBe('510108199001011234');
  });

  it('UpdateContactDto：gender 非法值仍被拒（补声明不放松校验）', async () => {
    await expect(
      pipe.transform({ ...payload, gender: '未知' }, { ...meta, metatype: UpdateContactDto }),
    ).rejects.toBeTruthy();
  });

  it('UpdateContactDto：idCard 非法格式仍被拒', async () => {
    await expect(
      pipe.transform({ ...payload, idCard: '123' }, { ...meta, metatype: UpdateContactDto }),
    ).rejects.toBeTruthy();
  });
});
