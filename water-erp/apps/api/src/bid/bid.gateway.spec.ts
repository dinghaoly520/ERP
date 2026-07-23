import { BID_EVENT } from '@water-erp/shared';
import { canJoinHostRoom, SUPPLIER_BLOCKED_EVENTS } from './bid.gateway';

describe('BidGateway 门控纯函数', () => {
  it('host 房仅限 admin/bid_host/leader/staff', () => {
    expect(canJoinHostRoom('admin')).toBe(true);
    expect(canJoinHostRoom('bid_host')).toBe(true);
    expect(canJoinHostRoom('leader')).toBe(true);
    expect(canJoinHostRoom('staff')).toBe(true);
    expect(canJoinHostRoom('supplier')).toBe(false);
    expect(canJoinHostRoom('bid_expert')).toBe(false);
    expect(canJoinHostRoom(undefined)).toBe(false);
  });

  it('供应商屏蔽事件集：监督日志/异常/专家个体在场', () => {
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.SUPERVISION_LOG)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.ANOMALY_DETECTED)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.EXPERT_PRESENCE)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.STAGE_CHANGE)).toBe(false);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.DECRYPT_STATUS)).toBe(false);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.HALL_MESSAGE_NEW)).toBe(false);
  });
});
