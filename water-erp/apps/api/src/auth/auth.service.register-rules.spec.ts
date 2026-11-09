import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

/**
 * 管理端注册账号/口令规则（2026-11-09 注册页口径统一）：
 * - 用户名：仅字母与数字、且须同时包含两者（USERNAME_PATTERN）
 * - 口令：≥8 位且同时包含字母与数字（PASSWORD_PATTERN，CTS-EBS01 4.8），
 *   前端提示曾写「至少 6 位」与后端 8 位判定漂移——已统一为 8 位
 * - 口令不得与用户名相同（service 层跨字段闸）
 */
const dtoPayload = {
  username: 'cgzx01a',
  password: 'passw0rd123',
  displayName: '张三',
  company: '四川水发勘测设计研究有限公司',
  department: '计划部',
  phone: '13800138000',
  verificationCode: '123456',
  requestedRole: 'management' as const,
};

describe('RegisterDto 用户名规则（字母+数字组合）', () => {
  it.each([
    ['cgzx01a', true], // 字母+数字 → 过
    ['cgzx', false], // 纯字母 → 拒
    ['123456', false], // 纯数字 → 拒
    ['cgzx-01', false], // 连字符（存量 Swhi-CGZX-* 风格）→ 拒：仅限新注册
    ['cgzx_01', false], // 下划线 → 拒
    ['cgzx 01', false], // 空格 → 拒
  ])('username %p → %p', async (username, shouldPass) => {
    const dto = plainToInstance(RegisterDto, { ...dtoPayload, username });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'username')).toBe(!shouldPass);
  });
});

describe('RegisterDto 口令规则（≥8 位且含字母与数字）', () => {
  it.each([
    ['passw0rd123', true], // 8+ 位字母+数字 → 过
    ['passw0r', false], // 7 位（旧前端「至少 6 位」口径的漏网区间）→ 拒
    ['password', false], // 纯字母 → 拒
    ['12345678', false], // 纯数字 → 拒
  ])('password %p → %p', async (password, shouldPass) => {
    const dto = plainToInstance(RegisterDto, { ...dtoPayload, password });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(!shouldPass);
  });
});

describe('AuthService.register 口令与用户名相同 → 拦截', () => {
  it('password === username → 400 PASSWORD_EQUALS_USERNAME（先于查重/验证码消费）', async () => {
    const svc = new AuthService({} as any, {} as any, {} as any);
    await expect(
      svc.register({ ...dtoPayload, username: 'abc12345', password: 'abc12345' } as RegisterDto),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: { code: 'PASSWORD_EQUALS_USERNAME' },
    });
  });
});
