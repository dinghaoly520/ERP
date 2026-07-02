import { TenderExtractorService } from './tender-extractor.service';
import { stableReqId } from '../utils/requirement-id';

describe('TenderExtractorService', () => {
  it('extract 返回的 requirement id 经稳定化（非 LLM 原始 q1/t1）', async () => {
    const llm = {
      chatJson: jest.fn().mockResolvedValue({
        projectName: 'p',
        projectType: 't',
        technicalRequirements: [
          { id: 't1', category: '技术', content: '工期365天', isStarred: true, weight: 10 },
        ],
        qualificationRequirements: [],
        commercialRequirements: [],
        priceEvaluationMethod: 'x',
        scoringRules: {
          technicalMax: 0,
          commercialMax: 0,
          priceMax: 0,
          technicalWeights: {},
          commercialWeights: {},
          priceMethod: '',
          notes: '',
        },
      }),
    } as any;
    const svc = new TenderExtractorService(llm);
    const out = await svc.extract('tender text', 'task-1');
    expect(out.technicalRequirements![0].id).toBe(
      stableReqId('technical', '工期365天'),
    );
    expect(out.technicalRequirements![0].id).not.toBe('t1');
  });
});
