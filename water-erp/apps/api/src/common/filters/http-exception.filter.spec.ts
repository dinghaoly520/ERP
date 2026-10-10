import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { OperationLogService } from '../../operation-log/operation-log.service';

describe('HttpExceptionFilter — operation-log 补记', () => {
  let filter: HttpExceptionFilter;
  let oplog: any;

  const makeHost = (reqOver: any = {}) => {
    const base: any = { method: 'GET', url: '/api/x', headers: {}, socket: {} };
    const merged = { ...base, ...reqOver };
    // Express 派生 request.path 自 url（剥 query string）；mock 需手动同步
    if (merged.path === undefined) merged.path = merged.url.split('?')[0];
    const req: any = merged;
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }), _req: req, _res: res } as any;
  };

  beforeEach(async () => {
    oplog = { create: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [HttpExceptionFilter, { provide: OperationLogService, useValue: oplog }],
    }).compile();
    filter = mod.get(HttpExceptionFilter);
  });

  it('标志未设 → 记录一条 + 发标准化响应', () => {
    const host = makeHost(); // 无 __oplogRecorded
    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);
    expect(oplog.create).toHaveBeenCalledTimes(1);
    expect(oplog.create.mock.calls[0][0].statusCode).toBe(403);
    const res = host._res;
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, timestamp: expect.any(String), path: '/api/x' }));
  });

  it('标志已设（interceptor 已记）→ 不重复记录，但响应照发', () => {
    const host = makeHost({ __oplogRecorded: true });
    filter.catch(new HttpException('boom', HttpStatus.BAD_REQUEST), host);
    expect(oplog.create).not.toHaveBeenCalled();
    expect(host._res.status).toHaveBeenCalledWith(400);
  });

  it('401 且无 user → role anonymous / userId null', () => {
    const host = makeHost(); // 无 req.user
    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);
    const entry = oplog.create.mock.calls[0][0];
    expect(entry.statusCode).toBe(401);
    expect(entry.role).toBe('anonymous');
    expect(entry.userId).toBeNull();
    expect(entry.durationMs).toBe(0);
  });

  it('非 HttpException → status 500 仍补记', () => {
    const host = makeHost();
    filter.catch(new Error('kaboom'), host);
    expect(oplog.create.mock.calls[0][0].statusCode).toBe(500);
    expect(host._res.status).toHaveBeenCalledWith(500);
  });

  it('排除路径上的异常 → 不补记（兑现 exclude 契约）', () => {
    // /api/docs 在 DEFAULT_EXCLUDE_PATHS 中
    const host = makeHost({ url: '/api/docs', path: '/api/docs' });
    filter.catch(new HttpException('boom', HttpStatus.INTERNAL_SERVER_ERROR), host);
    expect(oplog.create).not.toHaveBeenCalled();
    // 响应仍照常发出
    expect(host._res.status).toHaveBeenCalledWith(500);
  });

  // ── 对接专项 Phase 2 K4：结构化附加键透传（加法契约）──

  it('K4：业务异常携 itemIds 数组 → 响应体透传 itemIds（ALREADY_PUSHED 类）', () => {
    const host = makeHost();
    filter.catch(new ConflictException({ code: 'ALREADY_PUSHED', error: 'x', itemIds: ['announcement:a1', 'contract:c2'] } as any), host);
    const body = host._res.json.mock.calls[0][0];
    expect(body.itemIds).toEqual(['announcement:a1', 'contract:c2']);
    expect(body.code).toBe('ALREADY_PUSHED');
  });

  it('K4：携 items 数组 → 透传；不含附加键 → 响应体形状与旧契约逐键相等（零破坏）', () => {
    const host = makeHost();
    filter.catch(new BadRequestException({ code: 'OPENING_CHECKLIST_FAILED', error: 'y', items: ['a', 'b'] } as any), host);
    expect(host._res.json.mock.calls[0][0].items).toEqual(['a', 'b']);

    const host2 = makeHost();
    filter.catch(new BadRequestException({ code: 'X', error: 'z' }), host2);
    expect(Object.keys(host2._res.json.mock.calls[0][0]).sort()).toEqual(['code', 'error', 'path', 'statusCode', 'timestamp']);
  });
});

describe('HttpExceptionFilter — 报错信息中文化（2026-10-10 禁英文）', () => {
  let filter: HttpExceptionFilter;
  let oplog: any;

  const makeHost = (reqOver: any = {}) => {
    const base: any = { method: 'GET', url: '/api/x', headers: {}, socket: {} };
    const merged = { ...base, ...reqOver };
    if (merged.path === undefined) merged.path = merged.url.split('?')[0];
    const req: any = merged;
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }), _req: req, _res: res } as any;
  };

  beforeEach(async () => {
    oplog = { create: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [HttpExceptionFilter, { provide: OperationLogService, useValue: oplog }],
    }).compile();
    filter = mod.get(HttpExceptionFilter);
  });

  const bodyOf = (host: any) => host._res.json.mock.calls[0][0];

  it('框架默认英文（Forbidden resource / Unauthorized / Not Found）→ 中文映射', () => {
    const cases: Array<[any, string]> = [
      [new HttpException('Forbidden resource', HttpStatus.FORBIDDEN), '无权访问该功能，请联系管理员开通权限'],
      [new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), '未登录或登录已过期，请重新登录'],
      [new HttpException('Not Found', HttpStatus.NOT_FOUND), '请求的接口不存在'],
    ];
    for (const [exc, zh] of cases) {
      const host = makeHost();
      filter.catch(exc, host);
      expect(bodyOf(host).error).toBe(zh);
    }
  });

  it('class-validator 英文校验数组 → 中文（字段名保留代码标识）', () => {
    const host = makeHost();
    filter.catch(
      new BadRequestException([
        'property contactName must be a string',
        'password must be longer than or equal to 6 characters',
      ]),
      host,
    );
    expect(bodyOf(host).error).toBe('参数「contactName」应为文本；参数「password」长度不足（最少 6 字）');
    expect(bodyOf(host).code).toBe('VALIDATION_ERROR');
  });

  it('未映射英文消息（如 Template not found: /x）→ 按状态码中文兜底，英文不外露', () => {
    const host = makeHost();
    filter.catch(new HttpException('Template not found: /x.docx', HttpStatus.NOT_FOUND), host);
    expect(bodyOf(host).error).toBe('请求的资源不存在或已被删除');
  });

  it('英文裸 Error（500 路径）→ 通用中文，原文只进日志', () => {
    const host = makeHost();
    filter.catch(new Error('KMS_SECRET is not configured'), host);
    expect(bodyOf(host).statusCode).toBe(500);
    expect(bodyOf(host).error).toBe('服务器内部错误，请稍后重试或联系管理员');
  });

  it('中文业务消息原样透传（不误伤）', () => {
    const host = makeHost();
    filter.catch(new BadRequestException({ code: 'X', error: '名称不能为空' }), host);
    expect(bodyOf(host).error).toBe('名称不能为空');
  });

  it('中英混排（含中文即透传，技术词保留）', () => {
    const host = makeHost();
    filter.catch(new BadRequestException('DEEPSEEK_API_KEY 未配置，请在 .env 中设置'), host);
    expect(bodyOf(host).error).toBe('DEEPSEEK_API_KEY 未配置，请在 .env 中设置');
  });
});
