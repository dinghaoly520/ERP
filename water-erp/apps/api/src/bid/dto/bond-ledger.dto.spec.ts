import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpsertBondLedgerDto } from './bond-ledger.dto';

/** 终审收口：台账金额 @IsPositive + @Max(999999999999.99)——法定收据台账 0/负数无意义，超界溢出 Decimal(14,2) 变 Prisma 500 */
describe('UpsertBondLedgerDto 金额约束', () => {
  const base = {
    supplierName: '四川水发建设有限公司',
    arrivedAt: '2026-09-01T02:00:00.000Z',
    account: '蜀水采专户(6228)',
    payMethod: '转账',
  };

  it('金额 0 / -5 / 1e12 / 1e13 → 拒绝（isPositive / max）；999999999999.99 精确界 → 通过', async () => {
    const rejected: Array<[number, string]> = [
      [0, 'isPositive'],
      [-5, 'isPositive'],
      [1e12, 'max'], // 1e12=1000000000000 超精确界 999999999999.99（Decimal(14,2) 容量界，也拒）
      [1e13, 'max'],
    ];
    for (const [amount, constraint] of rejected) {
      const errors = await validate(plainToInstance(UpsertBondLedgerDto, { ...base, amount }));
      const amountErr = errors.find((e) => e.property === 'amount');
      expect(amountErr?.constraints).toHaveProperty(constraint);
    }

    const ok = await validate(plainToInstance(UpsertBondLedgerDto, { ...base, amount: 999999999999.99 }));
    expect(ok.find((e) => e.property === 'amount')).toBeUndefined();
  });
});
