import { UploadController } from './upload.controller';
import { registrationUploadNamespace } from './registration-upload';

describe('registration upload', () => {
  it('requires a valid SMS code and stores the asset in a phone-bound namespace', async () => {
    const uploadService = { upload: jest.fn().mockResolvedValue({ id: 'asset-1' }) };
    const verification = { assertRegistrationCodeForUpload: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new (UploadController as any)(uploadService, verification);
    const file = { originalname: '营业执照.pdf', mimetype: 'application/pdf', size: 100, buffer: Buffer.from('%PDF-1.7\nlicense') };

    await expect(controller.uploadRegistration(file, {
      phone: '13800138000', code: '123456', category: 'qualification',
    })).resolves.toEqual({ id: 'asset-1' });

    expect(verification.assertRegistrationCodeForUpload).toHaveBeenCalledWith('13800138000', '123456');
    expect(uploadService.upload).toHaveBeenCalledWith(
      file, 'qualification', undefined, false, undefined, registrationUploadNamespace('13800138000'),
    );
  });

  it('rejects non-registration categories before writing a file', async () => {
    const uploadService = { upload: jest.fn() };
    const verification = { assertRegistrationCodeForUpload: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new (UploadController as any)(uploadService, verification);

    await expect(controller.uploadRegistration({} as any, {
      phone: '13800138000', code: '123456', category: 'bid_document',
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_UPLOAD_CATEGORY_INVALID' } });
    expect(uploadService.upload).not.toHaveBeenCalled();
  });

  it.each([
    ['qualification', '营业执照.zip', 'application/zip', Buffer.from('PK\u0003\u0004fake'), 100],
    ['qualification', '营业执照.pdf', 'application/pdf', Buffer.from('not-a-pdf'), 100],
    ['qualification', '说明.txt', 'text/plain', Buffer.from('plain'), 100],
    ['general', 'logo.pdf', 'application/pdf', Buffer.from('%PDF-1.7\nlogo'), 100],
    ['general', 'logo.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 5 * 1024 * 1024 + 1],
  ])('rejects a registration file outside its purpose policy %#', async (category, originalname, mimetype, buffer, size) => {
    const uploadService = { upload: jest.fn() };
    const verification = { assertRegistrationCodeForUpload: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new (UploadController as any)(uploadService, verification);

    await expect(controller.uploadRegistration({ originalname, mimetype, buffer, size } as any, {
      phone: '13800138000', code: '123456', category,
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_UPLOAD_FILE_INVALID' } });
    expect(uploadService.upload).not.toHaveBeenCalled();
  });
});
