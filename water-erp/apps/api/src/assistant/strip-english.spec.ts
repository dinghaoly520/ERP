import { AssistantService } from './assistant.service';

/** stripEnglish 白名单锁定（2026-11-19 全面改造：ISO9001 曾被剥成 9001——白名单
 *  打补丁式枚举追不完，用单测把已知的保护口径钉死，回归即红）。构造只用到
 *  toolRegistry.register，其余依赖传空对象。 */
function makeService() {
  return new AssistantService(
    {} as never, // prisma
    {} as never, // model
    { register: jest.fn() } as never, // toolRegistry（registerTools 仅用 register）
    {} as never, // globalOverviewTool
    {} as never, // procurementTool
    {} as never, // pmiTool
    {} as never, // awardTool
    {} as never, // contractTool
    {} as never, // bidTool
    {} as never, // supplierTool
    {} as never, // expertTool
    {} as never, // announcementTool
    {} as never, // notificationTool
    {} as never, // cockpitTool
    {} as never, // rag
  );
}

describe('stripEnglish 白名单保护（2026-11-19 加固后口径）', () => {
  const strip = (s: string) => (makeService() as any).stripEnglish(s) as string;

  it.each([
    ['项目编号 SWHI-TP-2026102003 已归档', '项目编号 SWHI-TP-2026102003 已归档'],
    ['符合 GB/T 43711 与 DB51/T 要求', '符合 GB/T 43711 与 DB51/T 要求'],
    ['请插入 U盾 后重试', '请插入 U盾 后重试'],
    ['质量体系 ISO9001 认证', '质量体系 ISO9001 认证'], // 2026-11-19 实录：曾剥成 "9001"
    ['A4纸打印一份', 'A4纸打印一份'],
    ['PM2.5 浓度超标', 'PM2.5 浓度超标'],
    ['电压 380V、线缆 3mm、功率 5kW', '电压 380V、线缆 3mm、功率 5kW'],
    ['上传 pdf 或 docx 均可', '上传 pdf 或 docx 均可'],
    ['本系统为 ERP 平台，开放 API 对接 CA 认证', '本系统为 ERP 平台，开放 API 对接 CA 认证'],
  ])('保护：%s', (input, expected) => {
    expect(strip(input)).toBe(expected);
  });

  it.each([
    // 普通英文词仍剥——技术名词由提示词层避免，清洗只兜残留
    ['模型由 DeepSeek 驱动回答', '模型由 驱动回答'],
    ['hello world 你好', '你好'], // 末尾 trim 去前导空格
  ])('剥离：%s', (input, expected) => {
    expect(strip(input)).toBe(expected);
  });

  it('数字与中文标点不受影响（18.1%、212.0 万）', () => {
    expect(strip('节资率 18.1%，节约 212.0 万')).toBe('节资率 18.1%，节约 212.0 万');
  });
});
