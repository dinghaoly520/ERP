import { UserSettingsService } from './user-settings.service';

describe('UserSettingsService', () => {
  it('updateSettings 透传 defaultReviewKbId', async () => {
    const update = jest.fn().mockResolvedValue({ id: 's1', defaultReviewKbId: 'kb-1' });
    const prisma: any = {
      userSettings: {
        upsert: jest.fn().mockResolvedValue({ id: 's1' }), // getOrCreateSettings
        update,
      },
    };
    const svc = new UserSettingsService(prisma);
    await svc.updateSettings('u1', { defaultReviewKbId: 'kb-1' } as any);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ defaultReviewKbId: 'kb-1' }),
      }),
    );
  });
});
