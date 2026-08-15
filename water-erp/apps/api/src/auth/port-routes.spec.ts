import { checkPortRouteAccess } from './port-routes';

describe('checkPortRouteAccess', () => {
  describe('公共路径', () => {
    it.each(['/api/auth/me', '/api/auth/login', '/api/notification', '/api/upload'])(
      '放行 %s（任意门户）',
      path => {
        expect(checkPortRouteAccess('GET', path, 'web')).toBeNull();
        expect(checkPortRouteAccess('GET', path, 'bid')).toBeNull();
      },
    );
  });

  describe('无门户', () => {
    it('放行（向后兼容：直接调 API / Swagger）', () => {
      expect(checkPortRouteAccess('GET', '/api/bid/projects', undefined)).toBeNull();
    });
  });

  describe('web（:3005）调用 bid 独占路径', () => {
    it('拒绝 start-evaluation / scores / decrypt / complete-opening', () => {
      for (const path of [
        '/api/bid/projects/p1/start-evaluation',
        '/api/bid/projects/p1/scores',
        '/api/bid/projects/p1/decrypt/s1',
        '/api/bid/projects/p1/complete-opening',
      ]) {
        expect(checkPortRouteAccess('POST', path, 'web')).toBe('该操作仅在开评标管理端(:3007)可用');
      }
    });

    it('拒绝签字包写操作（generate/register/scan/handover）', () => {
      for (const path of [
        '/api/bid/projects/p1/sign-packet/generate',
        '/api/bid/projects/p1/sign-packet/experts/e1/register',
        '/api/bid/projects/p1/sign-packet/experts/e1/scan',
        '/api/bid/projects/p1/sign-packet/signature-page/scan',
        '/api/bid/projects/p1/sign-packet/handover',
      ]) {
        expect(checkPortRouteAccess('POST', path, 'web')).toBe('该操作仅在开评标管理端(:3007)可用');
      }
    });

    it('放行签字包基础 GET（:3005 归档块签字闸门展示，回归 R2）', () => {
      expect(checkPortRouteAccess('GET', '/api/bid/projects/p1/sign-packet', 'web')).toBeNull();
    });

    it('放行共享 bid 路径与 :3005 评标前/后操作', () => {
      for (const path of [
        '/api/bid/projects',
        '/api/bid/projects/p1',
        '/api/bid/projects/p1/open',
        '/api/bid/projects/p1/abort',
        '/api/bid/projects/p1/archive-all',
        '/api/bid/projects/p1/score-items',
        '/api/bid/projects/p1/supplier-nudge',
      ]) {
        expect(checkPortRouteAccess('GET', path, 'web')).toBeNull();
      }
    });

    it('放行 :3005 自身独占模块', () => {
      expect(checkPortRouteAccess('GET', '/api/supplier/list', 'web')).toBeNull();
      expect(checkPortRouteAccess('GET', '/api/expert-admin/experts', 'web')).toBeNull();
    });
  });

  describe('bid（:3007）调用 web 独占路径', () => {
    it('拒绝管理类模块', () => {
      for (const path of ['/api/supplier/list', '/api/announcement', '/api/project-management']) {
        expect(checkPortRouteAccess('GET', path, 'bid')).toBe('该接口仅在采购管理端(:3005)可用');
      }
    });

    it('放行专家批注/墨迹查看（评标管理 tab，回归 R3）', () => {
      expect(
        checkPortRouteAccess('GET', '/api/expert-admin/projects/p1/memos', 'bid'),
      ).toBeNull();
      expect(
        checkPortRouteAccess('GET', '/api/expert-admin/projects/p1/memos/m1/ink', 'bid'),
      ).toBeNull();
    });

    it('仍拒绝 expert-admin 其余端点（专家库/抽取等）', () => {
      expect(checkPortRouteAccess('GET', '/api/expert-admin/experts', 'bid')).toBe(
        '该接口仅在采购管理端(:3005)可用',
      );
    });

    it('放行自身独占路径与共享 bid 路径', () => {
      for (const path of [
        '/api/bid/projects',
        '/api/bid/projects/p1',
        '/api/bid/projects/p1/start-evaluation',
        '/api/bid/projects/p1/sign-packet/generate',
      ]) {
        expect(checkPortRouteAccess('POST', path, 'bid')).toBeNull();
      }
    });
  });

  describe('其他门户不受端口互斥影响', () => {
    it('expert / supplier / mall / public 调 bid 与 web 独占路径均放行', () => {
      for (const portal of ['expert', 'supplier', 'mall', 'public']) {
        expect(checkPortRouteAccess('GET', '/api/expert-admin/experts', portal)).toBeNull();
        expect(checkPortRouteAccess('GET', '/api/bid/projects/p1/scores', portal)).toBeNull();
      }
    });
  });
});
