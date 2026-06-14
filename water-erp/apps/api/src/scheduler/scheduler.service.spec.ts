import { buildExpiryNotification } from './scheduler.service';

describe('buildExpiryNotification', () => {
  it('生成到期提醒站内信', () => {
    const n = buildExpiryNotification({ qualificationName: '安全生产许可证', validTo: new Date('2026-07-10'), daysLeft: 26 });
    expect(n.type).toBe('QUALIFICATION_EXPIRING');
    expect(n.title).toContain('资质即将到期');
    expect(n.content).toContain('安全生产许可证');
    expect(n.content).toContain('26');
    expect(n.link).toBe('/supplier/qualifications');
  });
});
