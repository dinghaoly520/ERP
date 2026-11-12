import { ForbiddenException } from '@nestjs/common';
import { PairingScopeGuard } from './pairing-scope.guard';
import { PAIRING_ALLOWED } from './tablet-pairing.scope';
import type { PairingScope } from './tablet-pairing.scope';

/**
 * TAB-SYNC-01 Task 3：PairingScopeGuard 白名单默认拒绝 + pid 绑定。
 * Task 4（AuthGuard 挂 req.pairingScope）尚未落地——spec 手挂字段直测守卫裁决。
 */

/** 已配对会话：项目 p1 / 专家 e1 / 配对 jti-1 */
const SCOPE: PairingScope = { projectId: 'p1', expertId: 'e1', pairingId: 'jti-1' };

interface ReqStub {
  method: string;
  /** Express req.path：含全局前缀 /api、不含 query string（与 port-route.guard / operation-log 同口径） */
  path: string;
  query?: Record<string, unknown>;
  pairingScope?: PairingScope;
}

function ctx(req: ReqStub) {
  const request: Record<string, unknown> = {
    method: req.method,
    path: req.path,
    query: req.query ?? {},
  };
  if (req.pairingScope) request.pairingScope = req.pairingScope;
  return { switchToHttp: () => ({ getRequest: () => request }) } as any;
}

const guard = new PairingScopeGuard();

/** Nest 异常对象原样透传 { error, code }——按类 + getResponse 断言（本库惯例） */
function expectForbidden(req: ReqStub, code: string, error: string) {
  let err: unknown;
  try {
    guard.canActivate(ctx(req));
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ForbiddenException);
  expect((err as ForbiddenException).getResponse()).toMatchObject({ code, error });
}

describe('PairingScopeGuard', () => {
  describe('无 pairingScope → 一律放行（Task 4 落地前全员 no-op）', () => {
    it.each([
      { method: 'POST', path: '/api/expert/projects/p9/scores' },
      { method: 'POST', path: '/api/upload' },
      { method: 'GET', path: '/api/notifications' },
    ])('$method $path（本应默认拒绝的端点也放行）', (req) => {
      expect(guard.canActivate(ctx(req))).toBe(true);
    });
  });

  describe('白名单放行（scoped）', () => {
    it.each([
      // 草稿写（核心写面）
      { method: 'POST', path: '/api/expert/projects/p1/score-draft' },
      // 备忘全 CRUD + 墨迹（平板手写备忘）
      { method: 'POST', path: '/api/expert/projects/p1/memos' },
      { method: 'PATCH', path: '/api/expert/projects/p1/memos/m1' },
      { method: 'DELETE', path: '/api/expert/projects/p1/memos/m1' },
      { method: 'GET', path: '/api/expert/projects/p1/memos' }, // 列表走 GET 只读全集面
      { method: 'GET', path: '/api/expert/projects/p1/memos/m1/ink' },
      // 配对留档照
      { method: 'GET', path: '/api/expert/projects/p1/pairing-photo-status' },
      { method: 'POST', path: '/api/expert/projects/p1/pairing-photo' },
      // 焦点轮询（平板侧 GET；POST 是桌面发送面，不在白名单）
      { method: 'GET', path: '/api/expert/projects/p1/focus-hint' },
      // 评标室口令自验（二轮修正移入白名单）
      { method: 'POST', path: '/api/expert/projects/p1/room-code/verify' },
      // 澄清文件下载（读形写法）
      { method: 'POST', path: '/api/expert/projects/p1/clarification-docs/d1/download' },
      // 会话维持
      { method: 'POST', path: '/api/auth/logout' },
      { method: 'GET', path: '/api/auth/heartbeat' },
      { method: 'GET', path: '/api/auth/me' },
      // 只读全集：GET /expert/projects*（裸列表无 pid——pid 绑定豁免）
      { method: 'GET', path: '/api/expert/projects' },
      { method: 'GET', path: '/api/expert/projects/p1' },
      { method: 'GET', path: '/api/expert/projects/p1/documents/s1' },
      { method: 'GET', path: '/api/expert/projects/p1/tender-document' },
      { method: 'GET', path: '/api/expert/projects/p1/tender-document/download' },
      { method: 'GET', path: '/api/expert/projects/p1/negotiation-files/f1/download' },
      { method: 'GET', path: '/api/expert/projects/p1/clarification-docs' },
      { method: 'GET', path: '/api/expert/projects/p1/quote-history' },
      { method: 'GET', path: '/api/expert/projects/p1/my-scores' },
      { method: 'GET', path: '/api/expert/projects/p1/score-history' },
      { method: 'GET', path: '/api/expert/projects/p1/disputes' },
      { method: 'GET', path: '/api/expert/projects/p1/motions' },
      { method: 'GET', path: '/api/expert/projects/p1/assist/s1' },
      { method: 'GET', path: '/api/expert/projects/p1/assist/s1/reviews' },
      // 跨项目只读端点（无 projectId——pid 绑定豁免）
      { method: 'GET', path: '/api/expert/profile' },
      { method: 'GET', path: '/api/expert/profile/contact-check' },
      { method: 'GET', path: '/api/expert/statistics' },
      { method: 'GET', path: '/api/expert/tasks' },
    ])('$method $path', (req) => {
      expect(guard.canActivate(ctx({ ...req, pairingScope: SCOPE }))).toBe(true);
    });

    it('POST /upload 仅 expert_signin_photo 类目放行（比对 req.query.category）', () => {
      expect(
        guard.canActivate(
          ctx({
            method: 'POST',
            path: '/api/upload',
            query: { category: 'expert_signin_photo' },
            pairingScope: SCOPE,
          }),
        ),
      ).toBe(true);
    });

    it('路径匹配前去 /api 前缀——无前缀路径同口径放行（防御性）', () => {
      expect(
        guard.canActivate(
          ctx({ method: 'POST', path: '/expert/projects/p1/score-draft', pairingScope: SCOPE }),
        ),
      ).toBe(true);
    });
  });

  describe('默认拒绝：白名单未命中 → 403 PAIRING_SCOPE_FORBIDDEN', () => {
    it.each([
      // spec §6 显式拒绝点名（防回归）
      { method: 'POST', path: '/api/expert/projects/p1/scores' }, // submitScores
      { method: 'POST', path: '/api/expert/projects/p1/suppliers/s1/score-review/verify' },
      { method: 'POST', path: '/api/expert/projects/p1/report/confirm' },
      { method: 'POST', path: '/api/expert/projects/p1/esign' },
      { method: 'POST', path: '/api/expert/projects/p1/motions' }, // 动议发起
      { method: 'POST', path: '/api/expert/projects/p1/disputes' }, // 异议工单
      { method: 'POST', path: '/api/expert/projects/p1/sign-in' },
      { method: 'POST', path: '/api/expert/projects/p1/avoidance' },
      { method: 'PATCH', path: '/api/expert/projects/p1/agreements' },
      { method: 'POST', path: '/api/expert/projects/p1/ai-consent' },
      // 非 expert 模块端点
      { method: 'GET', path: '/api/notifications' },
      { method: 'GET', path: '/api/bid/projects' },
      // 白名单端点但方法/形态不在面内
      { method: 'PATCH', path: '/api/auth/me' },
      { method: 'PATCH', path: '/api/expert/profile' }, // profile 只读
      { method: 'POST', path: '/api/expert/projects/p1/focus-hint' }, // POST=桌面发送面
      { method: 'GET', path: '/api/auth/departments' },
    ])('$method $path', (req) => {
      expectForbidden(
        { ...req, pairingScope: SCOPE },
        'PAIRING_SCOPE_FORBIDDEN',
        '平板配对身份无权执行此操作，请在桌面端操作',
      );
    });
  });

  describe('upload 类目限定：类目不匹配 → 403 PAIRING_SCOPE_FORBIDDEN', () => {
    it.each([
      { query: { category: 'qualification' }, label: '他类目' },
      { query: {}, label: '无 category' },
      { query: { category: ['expert_signin_photo', 'x'] }, label: '数组形态' },
    ])('$label', ({ query }) => {
      expectForbidden(
        { method: 'POST', path: '/api/upload', query, pairingScope: SCOPE },
        'PAIRING_SCOPE_FORBIDDEN',
        '平板配对身份无权执行此操作，请在桌面端操作',
      );
    });
  });

  describe('pid 绑定：/expert/projects/:projectId 路径 ≠ 配对项目 → 403 PAIRING_PROJECT_MISMATCH', () => {
    it.each([
      { method: 'GET', path: '/api/expert/projects/p2' }, // 详情（GET 只读全集内）
      { method: 'GET', path: '/api/expert/projects/p2/documents/s1' },
      { method: 'POST', path: '/api/expert/projects/p2/score-draft' }, // 白名单写面但错项目
      { method: 'POST', path: '/api/expert/projects/p2/scores' }, // 双重违规——pid 更精确诊断先行
    ])('$method $path', (req) => {
      expectForbidden(
        { ...req, pairingScope: SCOPE },
        'PAIRING_PROJECT_MISMATCH',
        '平板仅可访问已配对项目',
      );
    });
  });

  describe('PAIRING_ALLOWED 数据契约', () => {
    it('upload 条目唯一且类目锁定 expert_signin_photo（Task 4/前端消费面）', () => {
      const uploads = PAIRING_ALLOWED.filter((e) => e.uploadCategory !== undefined);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]).toMatchObject({
        method: 'POST',
        uploadCategory: 'expert_signin_photo',
      });
      expect(uploads[0].path.test('/upload')).toBe(true);
      expect(uploads[0].path.test('/upload/other')).toBe(false);
    });
  });
});
