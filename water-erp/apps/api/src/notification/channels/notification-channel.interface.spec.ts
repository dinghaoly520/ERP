import { shouldDispatch } from './notification-channel.interface';

describe('shouldDispatch', () => {
  it('用户无 email 时 Email 渠道不分发', () => {
    expect(shouldDispatch('email', { email: null })).toBe(false);
  });
  it('用户有 email 时 Email 渠道分发', () => {
    expect(shouldDispatch('email', { email: 'a@b.com' })).toBe(true);
  });
  it('inApp 始终分发', () => {
    expect(shouldDispatch('inApp', {})).toBe(true);
  });
  it('sms 无 phone 不分发', () => {
    expect(shouldDispatch('sms', { phone: null })).toBe(false);
    expect(shouldDispatch('sms', { phone: '13800' })).toBe(true);
  });
});
