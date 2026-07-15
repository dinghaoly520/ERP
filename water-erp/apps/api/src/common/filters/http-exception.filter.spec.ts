import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { OperationLogService } from '../../operation-log/operation-log.service';

describe('HttpExceptionFilter — operation-log 补记', () => {
  let filter: HttpExceptionFilter;
  let oplog: any;

  const makeHost = (reqOver: any = {}) => {
    const req: any = { method: 'GET', url: '/api/x', headers: {}, socket: {}, ...reqOver };
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
});
