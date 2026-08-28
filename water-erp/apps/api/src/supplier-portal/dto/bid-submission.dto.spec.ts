import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { SaveBidDraftDto, SubmitBidDto } from './bid-submission.dto';

describe('bid-submission.dto（A-94：whitelist 下字段透传 + 格式校验）', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const transform = (value: any, metaType: any) =>
    pipe.transform(value, { type: 'body', metatype: metaType } as any);

  it('合法草稿：全部字段透传（splitFiles/clientDeks 不得被 whitelist 剥落）', async () => {
    const body = {
      bidPrice: '1260.5', deliveryPeriod: '90 日历天', qualityCommitment: '合格',
      technicalFile: '技术标说明', businessFile: '', coverLetter: '投标函',
      technicalFileAssetId: 'ck8abc123', bidBondAssetId: 'ck8bond456',
      fullBidFileAssetId: 'ck8full789', coverLetterFileAssetId: 'ck8cover012',
      splitFiles: { tech: { assetId: 'a1' }, biz: { assetId: 'a2' }, other: { assetId: 'a3' } },
      clientDeks: { 'ck8abc123': 'aa:bb:cc' },
    };
    const dto = await transform(body, SaveBidDraftDto) as SaveBidDraftDto;
    expect(dto.bidPrice).toBe('1260.5');
    expect(dto.deliveryPeriod).toBe('90 日历天');
    expect(dto.splitFiles).toEqual({ tech: { assetId: 'a1' }, biz: { assetId: 'a2' }, other: { assetId: 'a3' } });
    expect(dto.clientDeks).toEqual({ 'ck8abc123': 'aa:bb:cc' });
    expect(dto.businessFile).toBeUndefined(); // 空串 → undefined（@Transform）
  });

  it.each(['abc', '12,600', '-5', '1.23456', '12.6万元'])('非法报价 %s → 400', async (bad) => {
    await expect(transform({ bidPrice: bad }, SaveBidDraftDto)).rejects.toThrow(BadRequestException);
  });

  it('报价空串/缺省 → 放行（视为未填）', async () => {
    const dto = await transform({ bidPrice: '' }, SaveBidDraftDto) as SaveBidDraftDto;
    expect(dto.bidPrice).toBeUndefined();
  });

  it('工期超长 → 400；未知属性被剥落', async () => {
    await expect(transform({ deliveryPeriod: 'x'.repeat(51) }, SaveBidDraftDto)).rejects.toThrow(BadRequestException);
    const dto = await transform({ deliveryPeriod: '90天', hackerField: 'x' }, SaveBidDraftDto) as SaveBidDraftDto;
    expect((dto as any).hackerField).toBeUndefined();
  });

  it('SubmitBidDto：envelope/signature/fileHash/hostDecryptAuthorized 透传', async () => {
    const dto = await transform({
      envelope: { version: 'dual-v2', files: {} }, signature: 'MEUCIQ==signature',
      fileHash: 'a'.repeat(64), hostDecryptAuthorized: true,
    }, SubmitBidDto) as SubmitBidDto;
    expect(dto.envelope).toEqual({ version: 'dual-v2', files: {} });
    expect(dto.signature).toBe('MEUCIQ==signature');
    // 旧轨服务层契约字段（fileHash+signature 联合触发 SM2 验签；hostDecryptAuthorized 递交授权闸门）
    // 缺装饰器会被 whitelist 剥落——前者致验签静默跳过、后者致授权闸门协议层不可满足
    expect(dto.fileHash).toBe('a'.repeat(64));
    expect(dto.hostDecryptAuthorized).toBe(true);
  });
});
