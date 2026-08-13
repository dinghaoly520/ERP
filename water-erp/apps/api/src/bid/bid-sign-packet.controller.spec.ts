import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BidSignPacketController } from './bid-sign-packet.controller';
import { BidSignPacketService } from './bid-sign-packet.service';
import { RegisterSignDto } from './dto/bid-sign-packet.dto';

describe('BidSignPacketController', () => {
  let controller: BidSignPacketController;
  const svc = {
    generate: jest.fn(),
    getStatus: jest.fn(),
    uploadExpertScan: jest.fn(),
    uploadSignaturePageScan: jest.fn(),
    register: jest.fn(),
    unregister: jest.fn(),
    generateHandover: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BidSignPacketController],
      providers: [{ provide: BidSignPacketService, useValue: svc }],
    }).compile();
    controller = module.get(BidSignPacketController);
  });

  it('generate 委托服务', async () => {
    svc.generate.mockResolvedValue({ ok: true });
    await expect(controller.generate('p1', 'u1')).resolves.toEqual({ ok: true });
    expect(svc.generate).toHaveBeenCalledWith('p1', 'u1');
  });

  it('getStatus 委托服务', async () => {
    svc.getStatus.mockResolvedValue({ ok: true });
    await expect(controller.get('p1')).resolves.toEqual({ ok: true });
  });

  it('register 委托服务（含 dto）', async () => {
    svc.register.mockResolvedValue({ ok: true });
    await expect(controller.register('p1', 'e1', { status: 'SIGNED' } as RegisterSignDto, 'u1')).resolves.toEqual({ ok: true });
    expect(svc.register).toHaveBeenCalledWith('p1', 'e1', { status: 'SIGNED' }, 'u1');
  });

  it('RegisterSignDto 非法 status 被 ValidationPipe 拦截', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const dto = { status: 'NOPE' };
    await expect(
      pipe.transform(dto, { type: 'body', metatype: RegisterSignDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scan 委托服务（multer 文件对象透传 buffer/mimetype/originalname）', async () => {
    svc.uploadExpertScan.mockResolvedValue({ ok: true });
    const file = { buffer: Buffer.from('x'), mimetype: 'image/png', originalname: 'a.png' } as any;
    await expect(controller.uploadExpertScan('p1', 'e1', file, 'u1')).resolves.toEqual({ ok: true });
    expect(svc.uploadExpertScan).toHaveBeenCalledWith('p1', 'e1', { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname }, 'u1');
  });

  it('signature-page scan 委托服务', async () => {
    svc.uploadSignaturePageScan.mockResolvedValue({ ok: true });
    const file = { buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: 'b.pdf' } as any;
    await expect(controller.uploadSignaturePageScan('p1', file, 'u1')).resolves.toEqual({ ok: true });
    expect(svc.uploadSignaturePageScan).toHaveBeenCalledWith('p1', { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname }, 'u1');
  });

  it('unregister 委托服务', async () => {
    svc.unregister.mockResolvedValue({ ok: true });
    await expect(controller.unregister('p1', 'e1', 'u1')).resolves.toEqual({ ok: true });
    expect(svc.unregister).toHaveBeenCalledWith('p1', 'e1', 'u1');
  });

  it('generateHandover 委托服务', async () => {
    svc.generateHandover.mockResolvedValue({ ok: true });
    await expect(controller.generateHandover('p1', 'u1')).resolves.toEqual({ ok: true });
    expect(svc.generateHandover).toHaveBeenCalledWith('p1', 'u1');
  });
});
