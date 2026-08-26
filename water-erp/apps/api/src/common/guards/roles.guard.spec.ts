import { RolesGuard } from './roles.guard';

// 注：jest 30 无 toThrowError —— 断言用等价的 toThrow()；
// ctx mock 为部分实现，以 as any 满足 ExecutionContext 形参类型。
describe('RolesGuard — 默认拒绝语义', () => {
  let guard: RolesGuard;
  let reflector: any;
  const ctx = (user?: { sub: string; role: string }): any => ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => 'h',
    getClass: () => class {},
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as any);
  });
  const meta = ({ pub, any, roles }: { pub?: boolean; any?: boolean; roles?: string[] }) =>
    reflector.getAllAndOverride.mockImplementation((_k: string) =>
      _k === 'isPublic' ? pub : _k === 'any_role' ? any : _k === 'roles' ? roles : undefined);

  it('@AnyRole + 已登录 user → 放行', () => {
    meta({ any: true });
    expect(guard.canActivate(ctx({ sub: 'u1', role: 'supplier' } as any))).toBe(true);
  });
  it('@AnyRole + 无 user → 403 UNAUTHORIZED', () => {
    meta({ any: true });
    expect(() => guard.canActivate(ctx(undefined as any))).toThrow();
  });
  it('@Roles 匹配 → 放行（回归）', () => {
    meta({ roles: ['staff'] });
    expect(guard.canActivate(ctx({ sub: 'u1', role: 'staff' } as any))).toBe(true);
  });
  it('@Roles 不匹配 → 403 FORBIDDEN（回归）', () => {
    meta({ roles: ['staff'] });
    expect(() => guard.canActivate(ctx({ sub: 'u1', role: 'supplier' } as any))).toThrow();
  });
});
