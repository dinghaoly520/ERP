import { validate } from 'class-validator';
import { UpdateExpertProfileDto } from './update-profile.dto';

/**
 * P2-2（2026-09-21 全流程审查）：个人资料空 displayName 此前被 service 的
 * `if (dto.displayName)` 假值跳过而静默丢弃（假成功），DTO 层必须显式拒绝。
 */
describe('UpdateExpertProfileDto 校验', () => {
  it('空 displayName → 400「姓名不能为空」', async () => {
    const dto = new UpdateExpertProfileDto();
    dto.displayName = '';
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'displayName')).toBe(true);
  });

  it('非法邮箱 → 校验失败', async () => {
    const dto = new UpdateExpertProfileDto();
    dto.email = 'bad';
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'email')).toBe(true);
  });

  it('合法载荷（姓名+邮箱）→ 0 errors；displayName 仅未传时跳过（可选语义保留）', async () => {
    const dto = new UpdateExpertProfileDto();
    dto.displayName = '张三';
    dto.email = 'a@b.cn';
    expect(await validate(dto)).toHaveLength(0);

    const onlyEmail = new UpdateExpertProfileDto();
    onlyEmail.email = 'a@b.cn';
    expect(await validate(onlyEmail)).toHaveLength(0);
  });
});
