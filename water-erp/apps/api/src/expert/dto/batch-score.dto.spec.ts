import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BatchScoreDto } from './batch-score.dto';

// 递归收集所有层级（含嵌套 children）的约束错误
function collectConstraints(errors: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (errs: any[]) => {
    for (const e of errs) {
      if (e.constraints) Object.assign(out, e.constraints);
      if (e.children?.length) walk(e.children);
    }
  };
  walk(errors);
  return out;
}

describe('BatchScoreDto 限流 (P1-10)', () => {
  it('scores 超长（>2000）→ arrayMaxSize', async () => {
    const dto = plainToInstance(BatchScoreDto, {
      supplierName: '甲',
      scores: Array.from({ length: 2001 }, () => ({ scoreItemId: 'si', supplierId: 'sup' })),
    });
    const errors = await validate(dto);
    const scoresErr = errors.find((e) => e.property === 'scores');
    expect(scoresErr?.constraints).toHaveProperty('arrayMaxSize');
  });

  it('scores 为空 → arrayNotEmpty', async () => {
    const dto = plainToInstance(BatchScoreDto, { supplierName: '甲', scores: [] });
    const errors = await validate(dto);
    const scoresErr = errors.find((e) => e.property === 'scores');
    expect(scoresErr?.constraints).toHaveProperty('arrayNotEmpty');
  });

  it('pointDecisions 超长（>500）→ arrayMaxSize（嵌套）', async () => {
    const dto = plainToInstance(BatchScoreDto, {
      supplierName: '甲',
      scores: [
        {
          scoreItemId: 'si',
          supplierId: 'sup',
          pointDecisions: Array.from({ length: 501 }, () => ({ pointId: 'p', checked: true, awardedScore: 1 })),
        },
      ],
    });
    const errors = await validate(dto);
    expect(collectConstraints(errors)).toHaveProperty('arrayMaxSize');
  });

  it('合法载荷（1 项、1 个得分点）→ 无 array 限流错误', async () => {
    const dto = plainToInstance(BatchScoreDto, {
      supplierName: '甲',
      scores: [{ scoreItemId: 'si', supplierId: 'sup', score: 10, pointDecisions: [{ pointId: 'p', checked: true, awardedScore: 1 }] }],
    });
    const errors = await validate(dto);
    const c = collectConstraints(errors);
    expect(c).not.toHaveProperty('arrayMaxSize');
    expect(c).not.toHaveProperty('arrayNotEmpty');
  });
});
