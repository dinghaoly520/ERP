import type { Express } from 'express';
import { BadRequestException } from '@nestjs/common';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ProjectManagementService } from './project-management.service';

const SAMPLE_DEMAND_TEXT = `采购需求申请表
采购分类解释
【生产技术类采购】：公司生产技术性服务采购、技术咨询评审服务采购、勘察设
计资料采购，由生技部及市场部审核。
【EPC项目采购】：工程总承包相关的项目生产采购。例如工程施工采购、工程设
备物资采购、技术服务采购等。由生技部及市场部审核。
【EPC管理采购】：EPC综合管理类采购，用于自身管理等用途。例如办公家具、
设备、场地租赁、食堂等。
【公用集中采购】：办公家具、设备等公用实物（不含电脑、服务器及其他电子设
备）。
【科技研发类采购】：为完成科技研发项目而发生的服务采购（适用于科研委外及
重大项目关键技术攻关），由科创部审核。
【信息化采购】：因公司自身需要采购的所有软件（含信息化系统）及所有电子设
备（含计算机硬件、影像设备及其他电子设备），由科创部审核。若有需交付业主
的软件及电子设备采购，应选择“EPC项目采购”。
【其他】：其他不属以上范围内的协议、承诺函等其他事项。
需求申请人
需求部门
申请采购事项名称
2026年教育培训服务项目续约
所属项目/合同及编号
申请立项事由/情况说明
对供方的主要要求
采购预算价格(元)
484000.00
采购类别
附件
备注
序号
采购物品规格/型号/配置预估单价（元）数量小计（元）
1
2026年教育培训服务
项目
484000.001484000.00
合计484000.00
魏雪
人力资源部
2026年教育培训服务项目续约
基于甲方的人才培养需求，甲方根据实际需要，按具体的培训课程委托乙方提供培
训服务。双方根据每个培训项目的情况，确定培训课程、培训时间、报酬等内容，
依据报价单、发票、签到表等资料据实结算，双方按照协议约定履行权利义务。
其他
商儒2026年续约申请.pdf
355K
2025年合作协议（章）.pdf
1.7M
|

杨志宏
办公室接收人 : 陈迎迎 帅佳 李文珏 权钰婷
2026-03-04 14:29:41 [需求部门分管领导 / 抄送]
志宏
流转意见
杨志宏
办公室
来自Android客户端
接收人 : 魏雪
2026-03-04 14:29:41 [需求部门分管领导 / 批准]
志宏
陈静
财务资产部
来自鸿蒙客户端
接收人 : 杨志宏
2026-03-04 11:52:15 [财资部意见 / 批准]
陈静
朱黎熹
财务资产部
预算二轮上报范围内。
接收人 : 陈静
2026-03-04 09:12:05 [财资预算管理员 / 批准]
黎熹
陈源远
采购中心
来自鸿蒙客户端
接收人 : 朱黎熹
2026-03-03 20:14:00 [审核部门 / 批准]
源远
苏春
人力资源部
来自Android客户端
接收人 : 陈源远
2026-03-03 16:01:53 [需求部门 / 批准]
苏春
魏雪
人力资源部接收人 : 苏春
2026-03-03 15:25:53 [申请人 / 提交]
魏雪`;

const SAMPLE_DEMAND_TEXT_ZHANG = `采购需求申请表
采购分类解释
【生产技术类采购】：公司生产技术性服务采购、技术咨询评审服务采购、勘察设
计资料采购，由生技部及市场部审核。
【EPC项目采购】：工程总承包相关的项目生产采购。例如工程施工采购、工程设
备物资采购、技术服务采购等。由生技部及市场部审核。
【EPC管理采购】：EPC综合管理类采购，用于自身管理等用途。例如办公家具、
设备、场地租赁、食堂等，由办公室审核。
【公用集中采购】：办公用品、办公家具、设备等公用实物（不含电脑、服务器及
其他电子设备），由办公室审核。
【科技研发类采购】：为完成科技研发项目而发生的服务采购（适用于科研委外及
重大项目关键技术攻关），由科创部审核。
【信息化采购】：因公司自身需要采购的所有软件（含信息化系统）及所有电子设
备（含计算机硬件、影像设备及其他电子设备），由科创部审核。若有需交付业主
的软件及电子设备采购，应选择“EPC项目采购”。
【其他】：其他不属以上范围内的协议、承诺函等其他事项，由办公室审核。
是否属于年度预算
需求申请人
需求部门
申请采购事项名称
便携式全液压岩心钻机（800型）采购
所属项目/合同及编号
申请立项事由/情况说明
对供方的主要要求
采购预算价格(元)
873000.00
采购类别
附件
备注
厂家询价见附件二、附件三、附件四（包含钻机，钻杆、钻具等配套询价）
序号
采购物品规格/型号/配置预估单价（元）数量小计（元）
1
便携式全液压岩心钻
机
800型，NTW
（75mm）钻进深度
≥800m
873000.001873000.00
合计873000.00
是
张维刚
工程勘察院/钻探室
钻探装备能力提升，用于深孔、超深孔钻探。
钻机采购要求见附件一。
其他`;

const SAMPLE_DEMAND_TEXT_YU = `采购需求申请表
采购分类解释
【生产技术类采购】：公司生产技术性服务采购、技术咨询评审服务采购、勘察设
计资料采购，由生技部及市场部审核。
【EPC项目采购】：工程总承包相关的项目生产采购。例如工程施工采购、工程设
备物资采购、技术服务采购等。由生技部及市场部审核。
【EPC管理采购】：EPC综合管理类采购，用于自身管理等用途。例如办公家具、
设备、场地租赁、食堂等，由办公室审核。
【公用集中采购】：办公用品、办公家具、设备等公用实物（不含电脑、服务器及
其他电子设备），由办公室审核。
【科技研发类采购】：为完成科技研发项目而发生的服务采购（适用于科研委外及
重大项目关键技术攻关），由科创部审核。
【信息化采购】：因公司自身需要采购的所有软件（含信息化系统）及所有电子设
备（含计算机硬件、影像设备及其他电子设备），由科创部审核。若有需交付业主
的软件及电子设备采购，应选择“EPC项目采购”。
【其他】：其他不属以上范围内的协议、承诺函等其他事项，由办公室审核。
是否属于年度预算
需求申请人
需求部门
申请采购事项名称
引大济岷工程千隧ZK8钻孔施工技术服务
所属项目/合同及编号
引大济岷/川水市场（2025）103号
申请立项事由/情况说明
对供方的主要要求
采购预算价格(元)
506200.00
采购类别
附件
备注
序号
采购物品规格/型号/配置预估单价（元）数量小计（元）
1
引大济岷工程千隧
ZK8钻孔施工技术服
务
引大济岷工程千隧
ZK8钻孔施工技术服
务
506200.001506200.00
合计506200.00
是
宇天奇
工程勘察院/地质室
查明千池山隧洞岩性及构造特征，分别在千池山隧洞中部布置千隧ZK8钻孔，计划
孔深为380m。工程勘察院无能力完成超深钻孔，因此特申请技术服务采购。
1、独立法人，具备工程钻探劳务资质或在中国矿业联合会地质勘查信用信息公示
系统红名单内。
2、近5年具有一项以上（含一项）500米（含500米）孔深钻探业绩。
生产技术类采购`;

const SAMPLE_DEMAND_TEXT_HUANG = `采购需求申请表
采购分类解释
【生产技术类采购】：公司生产技术性服务采购、技术咨询评审服务采购、勘察设
计资料采购，由生技部及市场部审核。
【EPC项目采购】：工程总承包相关的项目生产采购。例如工程施工采购、工程设
备物资采购、技术服务采购等。由生技部及市场部审核。
【EPC管理采购】：EPC综合管理类采购，用于自身管理等用途。例如办公家具、
设备、场地租赁、食堂等，由办公室审核。
【公用集中采购】：办公用品、办公家具、设备等公用实物（不含电脑、服务器及
其他电子设备），由办公室审核。
【科技研发类采购】：为完成科技研发项目而发生的服务采购（适用于科研委外及
重大项目关键技术攻关），由科创部审核。
【信息化采购】：因公司自身需要采购的所有软件（含信息化系统）及所有电子设
备（含计算机硬件、影像设备及其他电子设备），由科创部审核。若有需交付业主
的软件及电子设备采购，应选择“EPC项目采购”。
【其他】：其他不属以上范围内的协议、承诺函等其他事项，由办公室审核。
是否属于年度预算
需求申请人
需求部门
申请采购事项名称
引大济岷工程青龙岗分水枢纽水工模型试验研究
所属项目/合同及编号
引大济岷工程/川水市场[2025]103号
申请立项事由/情况说明
对供方的主要要求
采购预算价格(元)
533000.00
采购类别
附件
备注
是
黄强
工程设计院/水工室
青龙岗分水枢纽位于䢺江河右岸，长167.57m，承担向北干线分水、向三坝水库充
水、电站前池溢流及事故检修时泄水等工程任务，上游接莲花山隧洞，下游为北干
线䢺江河倒虹吸，枢纽由配水池、钱桥动能回收电站和䢺江河泄水渠三部分组成。
分水枢纽顺水流向依次为电站进水闸室、溢流侧堰和䢺江河泄水渠，前池底板高程
806.72m，运行水位811.70m。
青龙岗分水枢纽为线路重要节点建筑物，关注度高。水规总院审查意见提出优化溢
流设施布置。
同时，青龙岗分水枢纽筑物级别为1级，设计、校核洪水标准分别为100年一遇、
300年一遇。枢纽布置功能较多，具有配水、溢流、泄水、电站前池等众多功能，
水力过程较为复杂，需要开展模型试验研究。
《水利水电工程初步设计报告编制规程（SL/T 619-2021）》6.7.6提出，对重要工
程的泄水建筑物，其体型、主要尺寸及水力计算结果应经水工模型试验或泥沙试验
验证。
《调水工程设计导则（SLT430-2024）》9.1.5提出，对调水工程中水力学条件复
杂、结构体型应用经验较少的重要建筑物，应开展模型试验研究，主要包括河工模
型试验、水工（水力学）模型试验、水工结构模型试验。
考虑我公司无模型试验研究能力，需与高校或科研机构合作完成青龙岗分水枢纽研
究内容，支撑相关设计。
（1）提交能够满足初步设计审查精度的《青龙岗分水枢纽水工模型试验研究报
告》，以下简称《报告》，份数满足甲方需求；
（2）提交不少于1篇中文核心期刊，第一作者为采购人人员，著作权人为采购人。
生产技术类采购`;

const SAMPLE_DEMAND_TEXT_LI = `采购需求申请表
采购分类解释
【生产技术类采购】：公司生产技术性服务采购、技术咨询评审服务采购、勘察设
计资料采购，由生技部及市场部审核。
【EPC项目采购】：工程总承包相关的项目生产采购。例如工程施工采购、工程设
备物资采购、技术服务采购等。由生技部及市场部审核。
【EPC管理采购】：EPC综合管理类采购，用于自身管理等用途。例如办公家具、
设备、场地租赁、食堂等，由办公室审核。
【公用集中采购】：办公用品、办公家具、设备等公用实物（不含电脑、服务器及
其他电子设备），由办公室审核。
【科技研发类采购】：为完成科技研发项目而发生的服务采购（适用于科研委外及
重大项目关键技术攻关），由科创部审核。
【信息化采购】：因公司自身需要采购的所有软件（含信息化系统）及所有电子设
备（含计算机硬件、影像设备及其他电子设备），由科创部审核。若有需交付业主
的软件及电子设备采购，应选择“EPC项目采购”。
【其他】：其他不属以上范围内的协议、承诺函等其他事项，由办公室审核。
需求申请人
需求部门
申请采购事项名称
引大济岷工程 初步设计阶段 通信光缆工程设计服务
所属项目/合同及编号
四川省引大济岷工程勘察设计（川水市场〔2025〕103号）
申请立项事由/情况说明
对供方的主要要求
采购预算价格(元)
346966.16
采购类别
附件
备注
序号
采购物品规格/型号/配置预估单价（元）数量小计（元）
1
引大济岷工程 初步设
计阶段 通信光缆工程
设计服务
346966.161346966.16
合计346966.16
李由
数字信息化院/设计研发室
通过外委有资质的专业通信设计方，确定引大济岷工程整体通信光缆工程路由通
道，确定隧洞直埋光缆与土建同步施工的技术方案，确定如何利用运营商已有资源
实现引大通信骨干通道至三个管理部、工程运维中心及三坝水库绕库通信组织设计
方案。
工程设计资质要求：电子通信广电行业（有线通信、无线通信）专业甲级
工程勘察资质要求：工程勘察专业类（工程测量）甲级
业绩要求：近5年内具有1个水利工程通信系统设计服务项目
生产技术类采购`;
const SAMPLE_DEMAND_TEXT_CHEN = `采购需求申请表
采购分类解释
【生产技术类采购】：公司生产技术性服务采购、技术咨询评审服务采购、勘察设计资料采购，由生技部及市场部审核。
【EPC项目采购】：工程总承包相关的项目生产采购，例如工程施工采购、工程设备物资采购、技术服务采购等，由生技部及市场部审核。
【EPC管理采购】：EPC综合管理类采购，用于自身管理等用途，例如办公家具、设备、场地租赁、食堂等，由办公室审核。
【公用集中采购】：办公用品、办公家具、设备等公用实物（不含电脑、服务器及其他电子设备），由办公室审核。
【科技研发类采购】：为完成科技研发项目而发生的服务采购（适用于科研委外及重大项目关键技术攻关），由科创部审核。
【信息化采购】：因公司自身需要采购的所有软件（含信息化系统）及所有电子设备（含计算机硬件、影像设备及其他电子设备），由科创部审核。若有需交付业主的软件及电子设备采购，应选择“EPC项目采购”。
【其他】：其他不属以上范围内的协议、承诺函等其他事项，由办公室审核。
是否属于年度预算
是
需求申请人
陈迎迎
需求部门
人力资源部
申请采购事项名称
人事档案数字化服务
所属项目/合同及编号
申请立项事由/情况说明
《四川省水利厅人事处关于加强干部人事档案管理推进数字化建设的通知》(川水人事〔2025〕104号)
对供方的主要要求
具备国家规定的从业资质和保密资质，熟悉《干部人事档案数字化技术规范（GB/T 33870-2017）》，近2年人事档案数字化相关业绩
采购预算价格(元)
142600.00
采购类别
其他
附件
四川水发勘测设计研究有限公司关于开展干部人事档案数字化技术服务项目市场调研的询价函.pdf
询价-北京信息录杰科技有限公司.pdf
询价-四川维雁档案服务有限责任公司.pdf
询价-四川鼎测信息工程有限公司.pdf
备注
因3月1日后采购中心优化管理流程，为提高采购效率，重新提交采购需求申请
序号
采购物品
规格/型号/配置
预估单价（元）
数量
小计（元）
1
人事档案数字化服务
142600.00
1
142600.00
合计
142600.00
杨志宏
办公室
接收人：权钰婷
2026-03-24 09:53:02 [需求部门分管领导 / 抄送]
杨志宏
办公室
接收人：陈迎迎
2026-03-24 09:53:02 [需求部门分管领导 / 批准]
陈静
财务资产部
接收人：杨志宏
2026-03-24 09:49:06 [财资部意见 / 批准]
朱黎熹
财务资产部
2026年预算二轮上报范围内。
接收人：陈静
2026-03-23 16:51:29 [财资预算管理员 / 批准]
汪涛
办公室
接收人：朱黎熹
2026-03-23 16:44:18 [审核部门 / 批准]
苏春
人力资源部
接收人：汪涛 张璐佳 谢军
2026-03-23 16:39:25 [需求部门 / 批准]
陈迎迎
人力资源部
采购立项申请表-陈迎迎-2026-01-27
采购立项申请表-陈迎迎-2026-01-27
接收人：苏春
2026-03-23 16:34:23 [申请人 / 提交]`;


jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

describe('ProjectManagementService', () => {
  const makeService = () => {
    const aiService = {
      analyzeProjectDetail: jest.fn(),
      chat: jest.fn(),
      auditStageCompliance: jest.fn(),
    };
    const documentParser = {
      parse: jest.fn().mockResolvedValue(''),
      parseWithOcr: jest.fn().mockResolvedValue(''),
    };

    const readFileMock = readFile as jest.MockedFunction<typeof readFile>;
    const writeFileMock = writeFile as jest.MockedFunction<typeof writeFile>;
    const mkdirMock = mkdir as jest.MockedFunction<typeof mkdir>;
    readFileMock.mockReset();
    writeFileMock.mockReset();
    mkdirMock.mockReset();

    const prisma: Record<string, any> = {
      department: {
        upsert: jest.fn(),
      },
      projectManagementItem: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      projectManagementStage: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'stage-initiation' }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      attachment: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      project: {
        create: jest.fn(),
      },
      procurementRound: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(prisma as any),
      ),
    };

    const storage = {
      read: jest.fn(),
      write: jest.fn(),
      delete: jest.fn(),
    };

    const service = new ProjectManagementService(
      prisma as never,
      aiService as never,
      documentParser as never,
      storage as never,
    );
    return {
      service,
      prisma,
      aiService,
      documentParser,
      readFileMock,
      writeFileMock,
      mkdirMock,
    };
  };

  it('creates a project-management item from confirmed initiation fields and seeds all six stages', async () => {
    const { service, prisma } = makeService();

    prisma.department.upsert.mockResolvedValue({
      id: 'dept-01',
      name: '采购中心',
    });
    prisma.projectManagementItem.create.mockResolvedValue({
      id: 'pm-01',
      title: '办公家具采购',
      currentStage: 'INITIATION',
      status: 'ACTIVE',
    });
    prisma.projectManagementStage.createMany.mockResolvedValue({ count: 7 });
    prisma.attachment.create.mockResolvedValue({ id: 'att-01' });

    await expect(
      service.createFromInitiation({
        requesterName: '张三',
        requesterDepartment: '采购中心',
        procurementTitle: '办公家具采购',
        procurementMethod: '公开招标',
        procurementCategory: '货物',
        procurementOrganizationForm: '自行组织',
        budgetAmount: 380000,
        isAnnualBudget: true,
        hasProcurementDemand: false,
        projectReason: '年度办公环境升级',
        supplierRequirements: '具备同类项目供货经验',
        initiationAttachment: {
          fileName: '采购立项申请表.pdf',
          objectKey: 'uploads/initiation.pdf',
          mimeType: 'application/pdf',
          fileSize: 12345,
          uploadedById: 'user-01',
        },
      }),
    ).resolves.toMatchObject({
      id: 'pm-01',
      currentStage: 'INITIATION',
      status: 'ACTIVE',
    });

    // 公开招标 + only initiationAttachment (hasDemand=false, hasInitiation=true):
    // source filters out PROCUREMENT_DEMAND and PUBLIC_ANNOUNCEMENT (9 − 2 = 7),
    // INITIATION is COMPLETED, TENDER_DOCUMENT is the first IN_PROGRESS stage.
    const expectedStages = [
      { key: 'INITIATION', label: '采购立项', status: 'COMPLETED' },
      { key: 'TENDER_DOCUMENT', label: '采购文件', status: 'IN_PROGRESS' },
      { key: 'SUPPLIER_INVITATION', label: '供应商邀请', status: 'NOT_STARTED' },
      { key: 'EXPERT_SELECTION', label: '专家抽取', status: 'NOT_STARTED' },
      { key: 'BID_EVALUATION', label: '开标评标', status: 'NOT_STARTED' },
      { key: 'AWARD_DECISION', label: '定标', status: 'NOT_STARTED' },
      { key: 'CONTRACT', label: '合同', status: 'NOT_STARTED' },
    ];
    expect(prisma.projectManagementStage.createMany).toHaveBeenCalledWith({
      data: expectedStages.map((stage, index) => ({
        projectManagementItemId: 'pm-01',
        stageKey: stage.key,
        stageName: stage.label,
        stageOrder: index + 1,
        status: stage.status,
      })),
    });
  });

  it('extracts demand fields from the Chen Yingying demand form without pulling approval-flow text into labeled fields', async () => {
    const { service } = makeService();

    await expect(
      service.extractDemandFieldsFromText(SAMPLE_DEMAND_TEXT_CHEN),
    ).resolves.toMatchObject({
      requesterName: '陈迎迎',
      requesterDepartment: '人力资源部',
      procurementTitle: '人事档案数字化服务',
      budgetAmount: 142600,
      procurementCategory: '其他',
      projectReason:
        '《四川省水利厅人事处关于加强干部人事档案管理推进数字化建设的通知》(川水人事〔2025〕104号)',
      supplierRequirements:
        '具备国家规定的从业资质和保密资质，熟悉《干部人事档案数字化技术规范（GB/T 33870-2017）》，近2年人事档案数字化相关业绩',
      所属项目: '',
      合同及编号: '',
    });
  });

  it('extracts demand fields from the sample demand PDF text without misclassifying supplier requirements as project reason', async () => {
    const { service } = makeService();

    await expect(
      service.extractDemandFieldsFromText(SAMPLE_DEMAND_TEXT),
    ).resolves.toMatchObject({
      requesterName: '魏雪',
      requesterDepartment: '人力资源部',
      procurementTitle: '2026年教育培训服务项目续约',
      budgetAmount: 484000,
      procurementCategory: '其他',
      projectReason: '2026年教育培训服务项目续约',
      supplierRequirements:
        '基于甲方的人才培养需求，甲方根据实际需要，按具体的培训课程委托乙方提供培训服务。双方根据每个培训项目的情况，确定培训课程、培训时间、报酬等内容，依据报价单、发票、签到表等资料据实结算，双方按照协议约定履行权利义务。',
    });
  });

  it('extracts demand fields when annual-budget marker is present and remarks appear before the item table', async () => {
    const { service } = makeService();

    await expect(
      service.extractDemandFieldsFromText(SAMPLE_DEMAND_TEXT_ZHANG),
    ).resolves.toMatchObject({
      requesterName: '张维刚',
      requesterDepartment: '工程勘察院/钻探室',
      procurementTitle: '便携式全液压岩心钻机（800型）采购',
      budgetAmount: 873000,
      procurementCategory: '其他',
      projectReason: '钻探装备能力提升，用于深孔、超深孔钻探。',
      supplierRequirements: '钻机采购要求见附件一。',
    });
  });

  it('extracts demand fields when project info is present and requirements span numbered lines', async () => {
    const { service } = makeService();

    await expect(
      service.extractDemandFieldsFromText(SAMPLE_DEMAND_TEXT_YU),
    ).resolves.toMatchObject({
      requesterName: '宇天奇',
      requesterDepartment: '工程勘察院/地质室',
      procurementTitle: '引大济岷工程千隧ZK8钻孔施工技术服务',
      budgetAmount: 506200,
      procurementCategory: '生产技术类采购',
      projectReason:
        '查明千池山隧洞岩性及构造特征，分别在千池山隧洞中部布置千隧ZK8钻孔，计划孔深为380m。工程勘察院无能力完成超深钻孔，因此特申请技术服务采购。',
       所属项目: '引大济岷',
      合同及编号: '川水市场（2025）103号',
    });
  });

  it('extracts demand fields when the item table is pushed after attachments and approval text', async () => {
    const { service } = makeService();

    await expect(
      service.extractDemandFieldsFromText(SAMPLE_DEMAND_TEXT_HUANG),
    ).resolves.toMatchObject({
      requesterName: '黄强',
      requesterDepartment: '工程设计院/水工室',
      procurementTitle: '引大济岷工程青龙岗分水枢纽水工模型试验研究',
      budgetAmount: 533000,
      procurementCategory: '生产技术类采购',
      projectReason:
        '青龙岗分水枢纽位于䢺江河右岸，长167.57m，承担向北干线分水、向三坝水库充水、电站前池溢流及事故检修时泄水等工程任务，上游接莲花山隧洞，下游为北干线䢺江河倒虹吸，枢纽由配水池、钱桥动能回收电站和䢺江河泄水渠三部分组成。 分水枢纽顺水流向依次为电站进水闸室、溢流侧堰和䢺江河泄水渠，前池底板高程806.72m，运行水位811.70m。 青龙岗分水枢纽为线路重要节点建筑物，关注度高。水规总院审查意见提出优化溢流设施布置。 同时，青龙岗分水枢纽筑物级别为1级，设计、校核洪水标准分别为100年一遇、300年一遇。枢纽布置功能较多，具有配水、溢流、泄水、电站前池等众多功能，水力过程较为复杂，需要开展模型试验研究。 《水利水电工程初步设计报告编制规程（SL/T 619-2021）》6.7.6提出，对重要工程的泄水建筑物，其体型、主要尺寸及水力计算结果应经水工模型试验或泥沙试验验证。 《调水工程设计导则（SLT430-2024）》9.1.5提出，对调水工程中水力学条件复杂、结构体型应用经验较少的重要建筑物，应开展模型试验研究，主要包括河工模型试验、水工（水力学）模型试验、水工结构模型试验。 考虑我公司无模型试验研究能力，需与高校或科研机构合作完成青龙岗分水枢纽研究内容，支撑相关设计。',
      supplierRequirements:
        '（1）提交能够满足初步设计审查精度的《青龙岗分水枢纽水工模型试验研究报告》，以下简称《报告》，份数满足甲方需求； （2）提交不少于1篇中文核心期刊，第一作者为采购人人员，著作权人为采购人。',
       所属项目: '引大济岷工程',
      合同及编号: '川水市场[2025]103号',
    });
  });

  it('extracts demand fields when there is no annual-budget marker but project info is on the next line', async () => {
    const { service } = makeService();

    await expect(
      service.extractDemandFieldsFromText(SAMPLE_DEMAND_TEXT_LI),
    ).resolves.toMatchObject({
      requesterName: '李由',
      requesterDepartment: '数字信息化院/设计研发室',
      procurementTitle: '引大济岷工程 初步设计阶段 通信光缆工程设计服务',
      budgetAmount: 346966.16,
      procurementCategory: '生产技术类采购',
       所属项目: '四川省引大济岷工程勘察设计（川水市场〔2025〕103号）',
      合同及编号: '',
    });
  });

  it('returns cached project detail analysis on open and only refreshes file analysis for the requested stage', async () => {
    const { service, prisma, aiService, readFileMock } = makeService();

    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01',
      title: '人工智能数据分析处理工作站',
      requesterName: '测绘分院',
      requesterDepartment: '测绘分院/测绘分院 综合室',
      procurementMethod: '谈判采购',
      procurementCategory: '科技研发类采购',
      procurementOrganizationForm: '自行招标',
      budgetAmount: 250000,
      isAnnualBudget: true,
      projectReason: '需要采购用于科研工作的计算平台。',
      supplierRequirements: '具备相关经验。',
      currentStage: 'TENDER_DOCUMENT',
      status: 'ACTIVE',
      analysisSummary:
        '项目当前推进至招标文件阶段，基础立项和招标材料已覆盖主要采购目标，整体处于中段推进状态。',
      analysisUpdatedAt: new Date('2026-05-12T09:00:00.000Z'),
      stages: [
        {
          id: 'stage-initiation',
          stageKey: 'INITIATION',
          stageName: '项目立项',
          stageOrder: 1,
          status: 'COMPLETED',
          attachments: [
            {
              id: 'att-00',
              fileName: '采购立项申请表.pdf',
              objectKey: 'project-management/file-00.pdf',
              mimeType: 'application/pdf',
              fileSize: 1024,
              createdAt: new Date('2026-05-10T10:00:00.000Z'),
            },
          ],
        },
        {
          id: 'stage-tender',
          stageKey: 'TENDER_DOCUMENT',
          stageName: '招标文件',
          stageOrder: 2,
          status: 'IN_PROGRESS',
          attachments: [
            {
              id: 'att-01',
              fileName: '招标文件草案.pdf',
              objectKey: 'project-management/file-01.pdf',
              mimeType: 'application/pdf',
              fileSize: 2048,
              createdAt: new Date('2026-05-11T10:00:00.000Z'),
            },
          ],
        },
      ],
    });

    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        summary:
          '项目当前推进至招标文件阶段，基础立项和招标材料已覆盖主要采购目标，整体处于中段推进状态。',
      }),
    );

    aiService.analyzeProjectDetail.mockResolvedValue({
      summary: {
        stageMatch: '项目当前推进至招标文件阶段。',
        contentSummary:
          '项目围绕科研平台采购展开，当前进展与招标材料衔接良好。',
      },
      fileAnalyses: [
        {
          objectKey: 'project-management/file-01.pdf',
          fileName: '招标文件草案.pdf',
          stageMatch: '与招标文件步骤匹配。',
          contentSummary: '文件包含招标范围、技术条件和评审办法。',
        },
      ],
    });

    await expect(
      service.analyzeProject('pm-01', 'TENDER_DOCUMENT'),
    ).resolves.toEqual({
      summary: {
        stageMatch: '项目简报',
        contentSummary:
          '项目当前推进至招标文件阶段，基础立项和招标材料已覆盖主要采购目标，整体处于中段推进状态。',
      },
      fileAnalyses: [
        {
          objectKey: 'project-management/file-01.pdf',
          fileName: '招标文件草案.pdf',
          stageMatch: '与招标文件步骤匹配。',
          contentSummary: '文件包含招标范围、技术条件和评审办法。',
        },
      ],
    });

    expect(aiService.analyzeProjectDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          id: 'pm-01',
          currentStage: 'TENDER_DOCUMENT',
        }),
        currentStage: expect.objectContaining({
          stageKey: 'TENDER_DOCUMENT',
        }),
        files: [
          expect.objectContaining({
            fileName: '招标文件草案.pdf',
          }),
        ],
      }),
    );
  });

  it('reuses cached stage file analysis when the stage and its files have not changed', async () => {
    const { service, prisma, aiService, readFileMock } = makeService();

    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01',
      title: '人工智能数据分析处理工作站',
      requesterName: '测绘分院',
      requesterDepartment: '测绘分院/测绘分院 综合室',
      procurementMethod: '谈判采购',
      procurementCategory: '科技研发类采购',
      procurementOrganizationForm: '自行招标',
      budgetAmount: 250000,
      isAnnualBudget: true,
      projectReason: '需要采购用于科研工作的计算平台。',
      supplierRequirements: '具备相关经验。',
      currentStage: 'EXPERT_SELECTION',
      status: 'ACTIVE',
      analysisSummary:
        '项目当前推进至专家抽取阶段，项目前期资料已形成，当前重点是完成专家抽取支撑材料的补齐与确认。',
      analysisUpdatedAt: new Date('2026-05-13T09:00:00.000Z'),
      stages: [
        {
          id: 'stage-expert',
          stageKey: 'EXPERT_SELECTION',
          stageName: '专家抽取',
          stageOrder: 3,
          status: 'IN_PROGRESS',
          attachments: [
            {
              id: 'att-02',
              fileName: 'YXQ.png',
              objectKey: 'project-management/file-02.png',
              mimeType: 'image/png',
              fileSize: 8144,
              createdAt: new Date('2026-05-13T09:30:00.000Z'),
            },
          ],
        },
      ],
    });

    // First readFile call: project summary cache
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        summary:
          '项目当前推进至专家抽取阶段，项目前期资料已形成，当前重点是完成专家抽取支撑材料的补齐与确认。',
      }),
    );

    // Second readFile call: stage analysis cache
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        fingerprint:
          'EXPERT_SELECTION:project-management/file-02.png@8144@2026-05-13T09:30:00.000Z',
        files: [
          {
            objectKey: 'project-management/file-02.png',
            fileName: 'YXQ.png',
            stageMatch: '与专家抽取步骤匹配。',
            contentSummary: '文件主要记录专家抽取相关内容。',
          },
        ],
      }),
    );

    await expect(
      service.analyzeProject('pm-01', 'EXPERT_SELECTION'),
    ).resolves.toEqual({
      summary: {
        stageMatch: '项目简报',
        contentSummary:
          '项目当前推进至专家抽取阶段，项目前期资料已形成，当前重点是完成专家抽取支撑材料的补齐与确认。',
      },
      fileAnalyses: [
        {
          objectKey: 'project-management/file-02.png',
          fileName: 'YXQ.png',
          stageMatch: '与专家抽取步骤匹配。',
          contentSummary: '文件主要记录专家抽取相关内容。',
        },
      ],
    });

    expect(aiService.analyzeProjectDetail).not.toHaveBeenCalled();
  });

  describe('analyzeStep', () => {
    it('throws BadRequest for unsupported stageKey', async () => {
      const { service } = makeService();
      await expect(service.analyzeStep('pm-01', 'TENDER_DOCUMENT')).rejects.toThrow(BadRequestException);
    });

    it('returns empty when roster is null', async () => {
      const { service, prisma } = makeService();
      prisma.projectManagementItem.findUnique.mockResolvedValue({
        id: 'pm-01',
        title: '测试项目',
        procurementMethod: '公开招标',
        procurementCategory: '工程',
        projectReason: '',
        supplierRequirements: '',
        currentStage: 'EXPERT_SELECTION',
        invitedSuppliers: null,
        expertInfo: null,
        projectOverview: null,
      });
      const result = await service.analyzeStep('pm-01', 'EXPERT_SELECTION');
      expect(result).toEqual({ content: '', empty: true });
    });

    it('calls AI and caches for EXPERT_SELECTION with expertInfo', async () => {
      const { service, prisma, aiService, readFileMock } = makeService();
      (aiService as any).chat = jest.fn().mockResolvedValue('抽取过程段落。\n\n最终名单段落。');
      prisma.projectManagementItem.findUnique.mockResolvedValue({
        id: 'pm-01',
        title: '岩土勘察项目',
        procurementMethod: '公开招标',
        procurementCategory: '工程',
        projectReason: '某工程勘察',
        supplierRequirements: '',
        currentStage: 'EXPERT_SELECTION',
        invitedSuppliers: null,
        expertInfo: '张三|地质部|岩土工程|高级工程师|组长\n李四|设计部|结构|工程师|成员',
        projectOverview: '岩土工程勘察',
      });
      readFileMock.mockRejectedValueOnce(new Error('no cache'));

      const result = await service.analyzeStep('pm-01', 'EXPERT_SELECTION');

      expect(result).toEqual({ content: '抽取过程段落。\n\n最终名单段落。', empty: false });
      expect((aiService as any).chat).toHaveBeenCalledTimes(1);
      expect((await import('node:fs/promises')).writeFile).toHaveBeenCalled();
    });
  });

  it('rejects completing a non-contract stage out of order', async () => {
    const { service, prisma } = makeService();

    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01',
      currentStage: 'TENDER_DOCUMENT',
      status: 'ACTIVE',
      title: '办公家具采购',
      procurementMethod: '公开招标',
      requesterDepartment: '采购中心',
      budgetAmount: 380000,
    });
    prisma.projectManagementStage.findMany.mockResolvedValue([
      { stageKey: 'INITIATION', status: 'COMPLETED', attachments: [] },
      { stageKey: 'TENDER_DOCUMENT', status: 'IN_PROGRESS', attachments: [] },
      { stageKey: 'EXPERT_SELECTION', status: 'NOT_STARTED', attachments: [] },
      { stageKey: 'BID_EVALUATION', status: 'NOT_STARTED', attachments: [] },
      { stageKey: 'AWARD_DECISION', status: 'NOT_STARTED', attachments: [] },
      { stageKey: 'CONTRACT', status: 'NOT_STARTED', attachments: [] },
    ]);

    await expect(
      service.completeProject('pm-01', {
        confirmedCompleted: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('archives a contract-complete project and creates a procurement ledger record', async () => {
    const { service, prisma } = makeService();

    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01',
      title: '办公家具采购',
      requesterName: '张三',
      requesterDepartment: '采购中心',
      procurementMethod: '公开招标',
      procurementCategory: '货物',
      procurementOrganizationForm: '自行组织',
      budgetAmount: 380000,
      currentStage: 'CONTRACT',
      status: 'ACTIVE',
      departmentNumber: 'CS-001',
    });
    prisma.projectManagementStage.findMany.mockResolvedValue([
      {
        stageKey: 'INITIATION',
        status: 'COMPLETED',
        attachments: [{ id: 'a1' }],
      },
      {
        stageKey: 'TENDER_DOCUMENT',
        status: 'COMPLETED',
        attachments: [{ id: 'a2' }],
      },
      {
        stageKey: 'EXPERT_SELECTION',
        status: 'COMPLETED',
        attachments: [{ id: 'a3' }],
      },
      {
        stageKey: 'BID_EVALUATION',
        status: 'COMPLETED',
        attachments: [{ id: 'a4' }],
      },
      {
        stageKey: 'AWARD_DECISION',
        status: 'COMPLETED',
        attachments: [{ id: 'a5' }],
      },
      {
        stageKey: 'CONTRACT',
        status: 'COMPLETED',
        attachments: [{ id: 'a6' }],
      },
    ]);
    prisma.department.upsert.mockResolvedValue({
      id: 'dept-01',
      name: '采购中心',
    });
    prisma.project.create.mockResolvedValue({
      id: 'project-01',
      name: '办公家具采购',
    });
    prisma.procurementRound.create.mockResolvedValue({ id: 'round-01' });
    prisma.projectManagementItem.update.mockResolvedValue({
      id: 'pm-01',
      status: 'ARCHIVED',
      archivedProcurementRoundId: 'round-01',
    });

    await expect(
      service.completeProject('pm-01', { confirmedCompleted: true }),
    ).resolves.toMatchObject({
      id: 'pm-01',
      status: 'ARCHIVED',
      archivedProcurementRoundId: 'round-01',
    });

    expect(prisma.procurementRound.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          procurementMethod: '公开招标',
          budgetAmount: 380000,
        }),
      }),
    );
  });

  it('rejects marking a later stage complete before the current stage finishes', async () => {
    const { service, prisma } = makeService();

    prisma.projectManagementStage.findFirst.mockResolvedValue({
      id: 'stage-contract',
      stageKey: 'CONTRACT',
      status: 'NOT_STARTED',
      projectManagementItemId: 'pm-01',
    });
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01',
      currentStage: 'TENDER_DOCUMENT',
    });

    await expect(
      service.updateStage('pm-01', 'CONTRACT', { status: 'COMPLETED' }),
    ).rejects.toThrow('请先完成当前阶段后再推进下一阶段。');
  });

  it('allows the current stage to complete and advances the next stage', async () => {
    const { service, prisma, aiService, readFileMock } = makeService();

    // P1-12：完成实质校验的放行前提（采购文件阶段 ≥1 附件）
    prisma.attachment = { count: jest.fn().mockResolvedValue(1) };
    prisma.invitationRsvp = { count: jest.fn().mockResolvedValue(1) };
    prisma.bidExpert = { count: jest.fn().mockResolvedValue(1) };

    prisma.projectManagementStage.findFirst.mockResolvedValue({
      id: 'stage-tender',
      stageKey: 'TENDER_DOCUMENT',
      status: 'IN_PROGRESS',
      projectManagementItemId: 'pm-01',
    });
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01',
      title: '办公家具采购',
      requesterName: '张三',
      requesterDepartment: '采购中心',
      procurementMethod: '公开招标',
      procurementCategory: '货物',
      procurementOrganizationForm: '自行组织',
      budgetAmount: 380000,
      projectReason: '年度办公环境升级',
      supplierRequirements: '具备同类项目供货经验',
      currentStage: 'TENDER_DOCUMENT',
      stages: [
        {
          id: 'stage-tender',
          stageKey: 'TENDER_DOCUMENT',
          stageName: '招标文件',
          stageOrder: 2,
          status: 'IN_PROGRESS',
          attachments: [],
        },
      ],
    });
    prisma.projectManagementStage.update.mockResolvedValue({
      id: 'stage-tender',
      status: 'COMPLETED',
    });
    prisma.projectManagementStage.updateMany.mockResolvedValue({ count: 1 });
    prisma.projectManagementItem.update.mockResolvedValue({
      id: 'pm-01',
      currentStage: 'SUPPLIER_INVITATION',
    });
    aiService.analyzeProjectDetail.mockResolvedValue({
      summary: {
        stageMatch: '项目简报',
        contentSummary: '项目推进顺利。',
      },
      fileAnalyses: [],
    });

    await expect(
      service.updateStage('pm-01', 'TENDER_DOCUMENT', { status: 'COMPLETED' }),
    ).resolves.toMatchObject({
      id: 'stage-tender',
      status: 'COMPLETED',
    });

    // TENDER_DOCUMENT 完成后,下一阶段是 SUPPLIER_INVITATION(供应商邀请)
    expect(prisma.projectManagementStage.updateMany).toHaveBeenCalledWith({
      where: {
        projectManagementItemId: 'pm-01',
        stageKey: 'SUPPLIER_INVITATION',
        status: 'NOT_STARTED',
      },
      data: { status: 'IN_PROGRESS' },
    });
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-01' },
      data: { currentStage: 'SUPPLIER_INVITATION' },
    });
  });

  it('allows completing procurement demand in small purchase and advances contract stage', async () => {
    const { service, prisma, aiService } = makeService();

    prisma.projectManagementStage.findFirst.mockResolvedValue({
      id: 'stage-demand',
      stageKey: 'PROCUREMENT_DEMAND',
      status: 'IN_PROGRESS',
      projectManagementItemId: 'pm-small',
    });
    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-small',
      title: '小额打印服务',
      requesterName: '张三',
      requesterDepartment: '采购中心',
      procurementMethod: '小额采购',
      procurementCategory: '其他',
      procurementOrganizationForm: '自行组织',
      budgetAmount: 3000,
      projectReason: '日常办公需要',
      supplierRequirements: '按需交付',
      currentStage: 'PROCUREMENT_DEMAND',
      stages: [
        {
          id: 'stage-demand',
          stageKey: 'PROCUREMENT_DEMAND',
          stageName: '采购需求',
          stageOrder: 1,
          status: 'IN_PROGRESS',
          attachments: [],
        },
        {
          id: 'stage-contract',
          stageKey: 'CONTRACT',
          stageName: '合同',
          stageOrder: 2,
          status: 'NOT_STARTED',
          attachments: [],
        },
      ],
    });
    prisma.projectManagementStage.update.mockResolvedValue({
      id: 'stage-demand',
      status: 'COMPLETED',
    });
    prisma.projectManagementStage.findMany.mockResolvedValue([
      { stageKey: 'PROCUREMENT_DEMAND', stageName: '采购需求', stageOrder: 1 },
      { stageKey: 'CONTRACT', stageName: '合同', stageOrder: 2 },
    ]);
    prisma.projectManagementStage.updateMany.mockResolvedValue({ count: 1 });
    prisma.projectManagementItem.update.mockResolvedValue({
      id: 'pm-small',
      currentStage: 'CONTRACT',
    });
    aiService.analyzeProjectDetail.mockResolvedValue({
      summary: {
        stageMatch: '项目简报',
        contentSummary: '项目推进顺利。',
      },
      fileAnalyses: [],
    });

    await expect(
      service.updateStage('pm-small', 'PROCUREMENT_DEMAND', { status: 'COMPLETED' }),
    ).resolves.toMatchObject({
      id: 'stage-demand',
      status: 'COMPLETED',
    });

    expect(prisma.projectManagementStage.updateMany).toHaveBeenCalledWith({
      where: {
        projectManagementItemId: 'pm-small',
        stageKey: 'CONTRACT',
        status: 'NOT_STARTED',
      },
      data: { status: 'IN_PROGRESS' },
    });
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-small' },
      data: { currentStage: 'CONTRACT' },
    });
  });

  it('restores a recycled project back to active status', async () => {
    const { service, prisma } = makeService();

    prisma.projectManagementItem.findUnique.mockResolvedValue({
      id: 'pm-01',
      status: 'RECYCLED',
    });
    prisma.projectManagementItem.update.mockResolvedValue({
      id: 'pm-01',
      status: 'ACTIVE',
    });

    await expect(service.restoreFromRecycleBin('pm-01')).resolves.toMatchObject(
      {
        id: 'pm-01',
        status: 'ACTIVE',
      },
    );

    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith({
      where: { id: 'pm-01' },
      data: { status: 'ACTIVE' },
    });
  });

  describe('updateStage 阶段完成实质校验（P1-12）', () => {
    const completing = { status: 'COMPLETED' } as any;

    it('TENDER_DOCUMENT 完成 + 0 附件 → 400', async () => {
      const { service, prisma } = makeService();
      prisma.projectManagementStage.findFirst.mockResolvedValue({ id: 'st-1', stageKey: 'TENDER_DOCUMENT' });
      prisma.projectManagementItem.findUnique.mockResolvedValue({ currentStage: 'TENDER_DOCUMENT' });
      prisma.attachment = { count: jest.fn().mockResolvedValue(0) };
      await expect(service.updateStage('pm-01', 'TENDER_DOCUMENT', completing)).rejects.toThrow('至少上传 1 份文件');
    });

    it('SUPPLIER_INVITATION 完成 + 0 邀请回执 → 400', async () => {
      const { service, prisma } = makeService();
      prisma.projectManagementStage.findFirst.mockResolvedValue({ id: 'st-1', stageKey: 'SUPPLIER_INVITATION' });
      prisma.projectManagementItem.findUnique.mockResolvedValue({ currentStage: 'SUPPLIER_INVITATION' });
      prisma.invitationRsvp = { count: jest.fn().mockResolvedValue(0) };
      await expect(service.updateStage('pm-01', 'SUPPLIER_INVITATION', completing)).rejects.toThrow('发送邀请通知');
    });

    it('EXPERT_SELECTION 完成 + BidProject 存在但 0 专家 → 400', async () => {
      const { service, prisma } = makeService();
      prisma.projectManagementStage.findFirst.mockResolvedValue({ id: 'st-1', stageKey: 'EXPERT_SELECTION' });
      prisma.projectManagementItem.findUnique.mockResolvedValue({ currentStage: 'EXPERT_SELECTION' });
      prisma.bidProject = { findFirst: jest.fn().mockResolvedValue({ id: 'bp-1' }) };
      prisma.bidExpert = { count: jest.fn().mockResolvedValue(0) };
      await expect(service.updateStage('pm-01', 'EXPERT_SELECTION', completing)).rejects.toThrow('完成专家抽取');
    });

    it('EXPERT_SELECTION 完成 + BidProject 尚未懒创建 → 放行（不拦截）', async () => {
      const { service, prisma } = makeService();
      prisma.projectManagementStage.findFirst.mockResolvedValue({ id: 'st-1', stageKey: 'EXPERT_SELECTION' });
      prisma.projectManagementItem.findUnique
        .mockResolvedValueOnce({ currentStage: 'EXPERT_SELECTION' }) // updateStage 前置读
        .mockResolvedValue({ id: 'pm-01', currentStage: 'CONTRACT', stages: [{ stageKey: 'EXPERT_SELECTION', attachments: [] }] }); // refreshProjectAnalysis
      prisma.bidProject = { findFirst: jest.fn().mockResolvedValue(null) };
      prisma.projectManagementStage.update.mockResolvedValue({});
      prisma.projectManagementStage.findMany.mockResolvedValue([{ stageKey: 'EXPERT_SELECTION', stageOrder: 5, status: 'COMPLETED' }]);
      prisma.projectManagementItem.update.mockResolvedValue({});
      prisma.attachment = { count: jest.fn().mockResolvedValue(1) };
      await expect(service.updateStage('pm-01', 'EXPERT_SELECTION', completing)).resolves.toBeDefined();
    });
  });

  describe('ensureBidProject 时间兜底（P0-5）', () => {
    const mockItem = (prisma: Record<string, any>, over: Record<string, unknown>) => {
      prisma.projectManagementItem.findUnique.mockResolvedValue({
        id: 'pm-01', title: '测试项目', procurementMethod: '谈判采购', budgetAmount: null,
        projectOverview: null, currentRound: 1, ...over,
      });
    };

    it('未填开标时间/立项时间时：deadline 不得落在过去（兜底顺延）', async () => {
      const { service, prisma } = makeService();
      prisma.announcement = { findFirst: jest.fn() };
      prisma.bidProject = { findFirst: jest.fn(), create: jest.fn() };
      mockItem(prisma, { bidOpeningTime: null, initiationDate: null });
      prisma.announcement.findFirst.mockResolvedValue(null);
      prisma.bidProject.findFirst.mockResolvedValue(null);
      prisma.bidProject.create.mockImplementation(({ data }: any) => ({ ...data }));

      const r = await service.ensureBidProject('pm-01');

      expect(new Date(r.deadline).getTime()).toBeGreaterThan(Date.now() - 1000);
      expect(new Date(r.openTime).getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it('开标时间早于 12h 前（陈旧值）时：deadline 同样顺延到未来', async () => {
      const { service, prisma } = makeService();
      prisma.announcement = { findFirst: jest.fn() };
      prisma.bidProject = { findFirst: jest.fn(), create: jest.fn() };
      mockItem(prisma, { bidOpeningTime: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), initiationDate: null });
      prisma.announcement.findFirst.mockResolvedValue(null);
      prisma.bidProject.findFirst.mockResolvedValue(null);
      prisma.bidProject.create.mockImplementation(({ data }: any) => ({ ...data }));

      const r = await service.ensureBidProject('pm-01');

      expect(new Date(r.deadline).getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it('P0-2 收尾：创建后回填 ACCEPTED 回执供应商进候选池（rsvp 早于懒创建的时序洞）', async () => {
      const { service, prisma } = makeService();
      prisma.announcement = { findFirst: jest.fn() };
      prisma.bidProject = { findFirst: jest.fn(), create: jest.fn().mockImplementation(({ data }: any) => ({ ...data })) };
      prisma.invitationRsvp = { findMany: jest.fn().mockResolvedValue([{ supplierId: 's1', supplierName: '甲公司' }]) };
      prisma.bidSupplier = { upsert: jest.fn().mockResolvedValue({}) };
      mockItem(prisma, { bidOpeningTime: null, initiationDate: null });

      await service.ensureBidProject('pm-01');

      expect(prisma.bidSupplier.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId_supplierName: expect.objectContaining({ supplierName: '甲公司' }) },
        create: expect.objectContaining({ supplierId: 's1', supplierName: '甲公司' }),
      }));
    });

    it('未来开标时间（>12h）时：保持「开标前 12h 截标」业务规则不变', async () => {
      const { service, prisma } = makeService();
      prisma.announcement = { findFirst: jest.fn() };
      prisma.bidProject = { findFirst: jest.fn(), create: jest.fn() };
      const future = new Date(Date.now() + 72 * 3600 * 1000);
      mockItem(prisma, { bidOpeningTime: future.toISOString(), initiationDate: null });
      prisma.announcement.findFirst.mockResolvedValue(null);
      prisma.bidProject.findFirst.mockResolvedValue(null);
      prisma.bidProject.create.mockImplementation(({ data }: any) => ({ ...data }));

      const r = await service.ensureBidProject('pm-01');

      expect(Math.abs(new Date(r.deadline).getTime() - (future.getTime() - 12 * 3600 * 1000))).toBeLessThan(5000);
    });
  });
});
