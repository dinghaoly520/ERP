import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();


type AnnouncementSeedType = 'BID_NOTICE' | 'WIN_NOTICE' | 'POLICY' | 'PLATFORM';

type AnnouncementSeedInput = (string | boolean)[];

const typeSummaryPrefix: Record<AnnouncementSeedType, string> = {
  BID_NOTICE: '招标公告',
  WIN_NOTICE: '中标公示',
  POLICY: '政策法规',
  PLATFORM: '平台通知',
};

function buildAnnouncementSeeds(
  type: AnnouncementSeedType,
  rows: AnnouncementSeedInput[],
  contentBuilder: (row: AnnouncementSeedInput, index: number) => string,
) {
  return rows.map((row, index) => ({
    title: String(row[0]),
    content: contentBuilder(row, index),
    type,
    status: 'PUBLISHED' as const,
    summary: `${typeSummaryPrefix[type]}：${String(row[0]).replace(/公告|通知|公示|采购公告|招标公告/g, '')}`.slice(0, 80),
    publishDate: new Date(String(row[row.length - 1 - (typeof row[row.length - 1] === 'boolean' ? 1 : 0)])),
    isTop: typeof row[row.length - 1] === 'boolean' ? Boolean(row[row.length - 1]) : false,
    viewCount: 120 + index * 37 + type.length * 11,
    relatedProjectCode: type === 'BID_NOTICE' || type === 'WIN_NOTICE' ? String(row[1]) : undefined,
  }));
}

function buildBidNoticeContent(row: AnnouncementSeedInput) {
  const [title, code, projectName, method, budget, location, scope, period, contact] = row.map(String);
  return `<h2>${title}</h2>
<p>根据《中华人民共和国招标投标法》《中华人民共和国政府采购法》及四川水发集团采购管理制度，现就${projectName}组织采购活动，欢迎具备相应资质、业绩和履约能力的供应商参加。本公告内容为供应商报名、编制响应文件和参与评审的重要依据，请潜在投标人认真阅读并按系统要求提交资料。</p>
<h3>一、项目概况</h3>
<p>项目编号：${code}。采购方式：${method}。预算金额：${budget}。实施地点：${location}。采购范围包括${scope}，以及为完成本项目所需的运输、安装调试、技术培训、售后保障、资料移交和验收配合等全部工作。交付或服务周期为${period}，具体起算时间以合同约定和采购人书面通知为准。</p>
<h3>二、供应商资格要求</h3>
<p>供应商须在中华人民共和国境内依法注册，具有独立承担民事责任的能力，营业执照经营范围应覆盖本项目采购内容；具有良好的商业信誉和健全的财务会计制度，近三年内未被列入失信被执行人、重大税收违法失信主体或政府采购严重违法失信行为记录名单；具备履行合同所必需的设备、人员、资金和专业技术能力，并能按采购人要求提供质量证明、检测报告或同类项目业绩材料。</p>
<h3>三、报名及文件获取</h3>
<p>潜在供应商应通过四川水发集团ERP供应商门户完成注册、资质维护和项目报名。报名资料应真实、完整、清晰，凡因资料缺失、证书过期、联系人信息错误或未按时确认澄清文件造成的后果，由供应商自行承担。采购文件、答疑澄清、补遗通知和开标安排均以平台发布内容为准。</p>
<h3>四、投标要求</h3>
<p>投标文件应按照采购文件格式编制，报价应包含税费、运输、装卸、保险、安装、调试、培训、验收、质保和风险等完成合同的全部费用。供应商不得相互串通投标，不得以低于成本的报价竞争，不得提供虚假材料。联系人：${contact}，咨询电话以平台项目页面公布为准。</p>`;
}

function buildWinNoticeContent(row: AnnouncementSeedInput) {
  const [title, code, projectName, winner, amount, score, period, quality, date] = row.map(String);
  return `<h2>${title}</h2>
<p>四川水发集团${projectName}已按采购文件规定完成开标、评审和结果确认工作。评标委员会依据资格审查、符合性审查、商务技术响应、报价合理性、履约能力和类似业绩等因素进行了独立评审，现将中标候选结果予以公示，接受投标人和社会监督。</p>
<h3>一、项目基本情况</h3>
<p>项目编号：${code}。项目名称：${projectName}。本项目评审过程严格执行集团采购管理制度，评审专家按规定完成签到、回避确认、独立打分和电子签章，监督人员对关键节点进行了见证，平台完整记录了文件解密、评审汇总、澄清答复和结果确认等操作日志。</p>
<h3>二、中标候选人信息</h3>
<p>第一中标候选人：${winner}。投标报价：${amount}。综合得分：${score}。承诺周期：${period}。质量标准：${quality}。该候选人在资格条件、技术方案、服务保障、项目组织、风险控制和售后响应等方面总体满足采购文件要求，报价构成清晰，主要人员和设备配置能够支撑项目实施。</p>
<h3>三、公示及异议</h3>
<p>公示开始日期：${date}，公示期不少于三个工作日。投标人或其他利害关系人如对公示内容有异议，应在公示期内通过平台或书面方式向采购中心提出，异议材料应列明具体事实、理由、请求和必要证明，并加盖单位公章。逾期、匿名或缺少事实依据的异议，采购人可不予受理。</p>
<h3>四、后续安排</h3>
<p>公示期满且无有效异议后，采购人将按程序发出中标通知书，并组织合同谈判、履约保证、进场计划和资料归档工作。中标人应继续保持投标文件承诺的人员、设备和服务条件，不得擅自更换关键人员或降低服务标准。</p>`;
}

function buildPolicyContent(row: AnnouncementSeedInput) {
  const [title, focus, audience, date] = row.map(String);
  return `<h2>${title}</h2>
<p>${audience}：为进一步规范四川水发集团采购管理工作，提升采购活动透明度、合规性和执行效率，根据国家有关法律法规、行业监管要求及集团内部控制制度，现就${focus}等事项作出如下要求。各单位应结合岗位职责认真学习执行，确保采购事项可追溯、可监督、可评价。</p>
<h3>一、总体要求</h3>
<p>采购活动应坚持依法合规、公开公平、诚实信用、权责一致和降本增效原则。任何部门和个人不得以拆分项目、规避审批、指定品牌、设置不合理条件或私下沟通等方式影响供应商公平竞争。涉及预算、技术参数、评分办法、评审过程、合同履约和验收付款的资料，应按规定在ERP系统中留痕。</p>
<h3>二、重点管理事项</h3>
<p>围绕${focus}，相关责任人应提前做好计划编制、风险识别、资料审核和节点提醒。供应商提交的证照、业绩、授权、检测报告、信用承诺等材料应真实有效；采购经办人员应对需求完整性、价格合理性和流程合规性进行复核；评审专家应独立、客观、公正发表意见，并主动申报可能影响公正评审的利害关系。</p>
<h3>三、监督与责任</h3>
<p>集团采购中心、纪检监督和审计部门将通过系统日志、抽查复核、专项检查和投诉处理等方式开展监督。对提供虚假材料、围标串标、泄露评审信息、恶意投诉、履约失信或不按制度执行的单位和个人，将视情节采取约谈整改、暂停资格、纳入信用记录、移送纪检或依法追责等措施。</p>
<h3>四、实施时间</h3>
<p>本通知自${date}起施行。此前规定与本通知不一致的，以本通知为准。执行过程中如遇特殊情形，应及时向采购中心报告并履行书面审批程序，不得擅自变通处理。</p>`;
}

function buildPlatformContent(row: AnnouncementSeedInput) {
  const [title, moduleName, features, date] = row.map(String);
  return `<h2>${title}</h2>
<p>尊敬的平台用户：为持续提升四川水发集团ERP招采平台的稳定性、易用性和业务支撑能力，系统将围绕${moduleName}开展功能调整或服务优化。本次公告涉及${features}等内容，请各供应商、评标专家和集团内部用户提前了解相关变化，合理安排业务操作时间。</p>
<h3>一、更新内容</h3>
<p>本次更新重点优化${features}。系统将进一步完善页面提示、状态流转、消息提醒、附件校验和操作留痕能力，减少因资料遗漏、版本不一致、超时未确认或浏览器环境异常造成的业务中断。涉及在线提交、电子签章、开标解密、评分确认和资料归档的功能，将在关键节点增加二次确认和风险提示。</p>
<h3>二、用户注意事项</h3>
<p>请用户在${date}后首次登录时检查个人资料、联系电话、邮箱、CA证书和常用浏览器环境是否正常。供应商应及时维护企业资质和联系人信息，专家应确认评审账号、专业信息和回避事项，内部用户应复核岗位权限和待办任务。若发现页面显示异常，可先清理浏览器缓存后重新登录。</p>
<h3>三、服务支持</h3>
<p>平台运行期间将安排技术人员值守，对登录失败、文件上传中断、证书识别异常、消息未送达和数据展示不一致等问题进行跟踪处理。用户反馈问题时，请尽量提供账号、项目名称、发生时间、页面截图和操作步骤，以便快速定位。涉及投标截止、开标解密和评审提交等紧急事项，可同步联系采购中心业务人员。</p>
<h3>四、数据安全</h3>
<p>平台不会要求用户通过非官方链接提交账号密码或支付费用。请妥善保管登录凭证和CA证书，不得将账号转借他人使用。如发现异常登录、信息泄露或疑似诈骗信息，请立即暂停操作并联系平台管理员。</p>`;
}

async function main() {
  const dept = await prisma.department.upsert({
    where: { name: '采购中心' },
    update: {},
    create: { name: '采购中心', code: 'PROC' },
  });

  // 采购管理端账号（web 门户）—— 原 admin 已移除
  const webUser = await prisma.user.upsert({
    where: { username: 'caigou' },
    update: {},
    create: {
      username: 'caigou',
      displayName: '采购管理员',
      passwordHash: hashSync('caigou@2026', 10),
      role: 'procurement_staff',
      departmentId: dept.id,
      email: 'caigou@scsdjt.com',
    },
  });

  await prisma.user.upsert({
    where: { username: 'lizhuren' },
    update: {},
    create: {
      username: 'lizhuren',
      displayName: '李主任',
      passwordHash: hashSync('lizhuren@2026', 10),
      role: 'bid_host',
      departmentId: dept.id,
    },
  });

  // 专家用户在项目创建之前 upsert，以便获取 ID 关联 BidExpert
  const expertWangjg = await prisma.user.upsert({
    where: { username: 'wangjg' },
    update: {},
    create: {
      username: 'wangjg',
      displayName: '王建国',
      passwordHash: hashSync('wangjg@2026', 10),
      role: 'bid_expert',
      departmentId: dept.id,
    },
  });

  const expertLiuxm = await prisma.user.upsert({
    where: { username: 'liuxm' },
    update: {},
    create: {
      username: 'liuxm',
      displayName: '刘晓梅',
      passwordHash: hashSync('liuxm@2026', 10),
      role: 'bid_expert',
      departmentId: dept.id,
      email: 'liuxm@expert.com',
    },
  });

  const expertChenzq = await prisma.user.upsert({
    where: { username: 'chenzq' },
    update: {},
    create: {
      username: 'chenzq',
      displayName: '陈志强',
      passwordHash: hashSync('chenzq@2026', 10),
      role: 'bid_expert',
      departmentId: dept.id,
      email: 'chenzq@expert.com',
    },
  });

  const project = await prisma.bidProject.create({
    data: {
      projectCode: 'BID-2026-0518',
      name: '2026年度水利工程物资集中采购',
      procurementMethod: '公开招标',
      openTime: new Date('2026-06-08T09:30:00'),
      deadline: new Date('2026-06-08T09:00:00'),
      stage: 'OPENING',
      riskNote: '解密窗口进行中',
      suppliers: {
        create: [
          { supplierName: '四川川水建设工程有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-001', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
          { supplierName: '成都华西物资供应有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-002', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
          { supplierName: '四川智水科技有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-003', decryptStatus: 'RUNNING', confirmStatus: 'PENDING' },
          { supplierName: '四川宏达水利工程有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-004', decryptStatus: 'DANGER', confirmStatus: 'EXCEPTION' },
          { supplierName: '成都诚信建材有限公司', downloadStatus: '已下载', submitStatus: '已提交', encryptStatus: '密文已校验', receiptNo: 'TB-20260608-005', decryptStatus: 'PENDING', confirmStatus: 'PENDING' },
        ],
      },
      openingSession: {
        create: {
          host: '采购中心-李主任',
          supervisor: '纪检监督-周老师',
          status: '解密中',
          decryptWindowStart: new Date('2026-06-08T09:30:00'),
          decryptWindowEnd: new Date('2026-06-08T10:00:00'),
          remainingSeconds: 1122,
        },
      },
      openingRecords: {
        create: [
          { supplierName: '四川川水建设工程有限公司', amount: '1260.00万元', period: '120日历天', qualityTarget: '合格', bondStatus: '已缴纳', decryptResult: '解密成功', confirmStatus: '已确认' },
          { supplierName: '成都华西物资供应有限公司', amount: '1288.50万元', period: '118日历天', qualityTarget: '合格', bondStatus: '已缴纳', decryptResult: '解密成功', confirmStatus: '已确认' },
          { supplierName: '四川智水科技有限公司', amount: '1320.00万元', period: '115日历天', qualityTarget: '合格', bondStatus: '电子保函', decryptResult: '解密中', confirmStatus: '待确认' },
        ],
      },
      experts: {
        create: [
          { userId: expertWangjg.id, expertName: '王建国', major: '水利工程', signedIn: true, avoidanceConfirmed: true, progress: 92, totalScore: 91.6 },
          { userId: expertLiuxm.id, expertName: '刘晓梅', major: '机电设备', signedIn: true, avoidanceConfirmed: true, progress: 86, totalScore: 89.4 },
          { userId: expertChenzq.id, expertName: '陈志强', major: '造价咨询', signedIn: true, avoidanceConfirmed: true, progress: 78, totalScore: 88.1 },
        ],
      },
      scoreItems: {
        create: [
          { category: 'QUALIFICATION', name: '资格性审查', maxScore: 0 },
          { category: 'RESPONSIVE', name: '符合性审查', maxScore: 0 },
          { category: 'BUSINESS', name: '商务评分', maxScore: 20 },
          { category: 'TECHNICAL', name: '技术评分', maxScore: 50 },
          { category: 'PRICE', name: '价格评分', maxScore: 30 },
        ],
      },
      clarifications: {
        create: [
          { question: '请说明主要设备交货计划与施工节点衔接安排。', issuer: '王建国', supplierName: '四川智水科技有限公司', status: '已回复', reply: '已补充交货计划说明，不改变投标实质内容。' },
        ],
      },
      supervisionLogs: {
        create: [
          { time: new Date('2026-06-08T08:55:00'), role: '系统', target: '投标文件', action: '投标截止自动锁定', result: '成功', riskFlag: '无' },
          { time: new Date('2026-06-08T09:30:00'), role: '开标主持人', target: '在线开标大厅', action: '启动开标', result: '成功', riskFlag: '无' },
          { time: new Date('2026-06-08T09:42:00'), role: '供应商', target: '投标文件解密', action: '证书校验失败', result: '异常', riskFlag: '投标人原因待确认' },
          { time: new Date('2026-06-08T10:05:00'), role: '专家', target: '技术评分', action: '提交评分', result: '成功', riskFlag: '存在偏差提醒' },
        ],
      },
      archiveItems: {
        create: [
          { name: '招标文件定稿', ownerRole: '招标管理端', status: 'ARCHIVED', hashDigest: 'SHA256-A19C8E', archivedAt: new Date('2026-06-08T08:30:00') },
          { name: '招标文件下载日志', ownerRole: '供应商端', status: 'ARCHIVED', hashDigest: 'SHA256-B72F31', archivedAt: new Date('2026-06-08T08:31:00') },
          { name: '投标文件提交回执', ownerRole: '供应商端', status: 'ARCHIVED', hashDigest: 'SHA256-C08A92', archivedAt: new Date('2026-06-08T09:00:00') },
          { name: '在线开标记录', ownerRole: '开标主持端', status: 'ARCHIVED', hashDigest: 'SHA256-D55E02', archivedAt: new Date('2026-06-08T10:05:00') },
          { name: '专家评分汇总表', ownerRole: '专家评标端', status: 'NOT_STARTED' },
          { name: '评标报告', ownerRole: '专家评标端', status: 'PENDING_CONFIRM' },
          { name: '结果公示截图', ownerRole: '归档端', status: 'NOT_STARTED' },
        ],
      },
    },
  });

  console.log(`Seeded: project ${project.projectCode}`);

  // ── Seed announcements (4 types × 12 announcements, content 500-1000 chars each) ──
  const announcementSeeds = [
    ...buildAnnouncementSeeds('BID_NOTICE', [
      ['2026年度水利工程物资集中采购招标公告', 'BID-2026-0518', '2026年度水利工程物资集中采购', '公开招标', '1500万元', '成都市及集团所属水利工程现场', '水泵、阀门、管材、闸门启闭机及配套备品备件', '120日历天', '采购中心李主任', '2026-05-20', true],
      ['智慧水务信息化系统建设项目招标公告', 'BID-2026-0522', '智慧水务信息化系统建设项目', '公开招标', '800万元', '集团总部及试点水库、灌区', '数据采集平台、调度指挥中心、移动巡检应用和网络安全体系', '180日历天', '信息技术部周工', '2026-05-22', false],
      ['2026年度防汛抗旱物资储备采购招标公告', 'BID-2026-0601', '2026年度防汛抗旱物资储备采购', '公开招标', '600万元', '成都、绵阳、南充、达州四个储备点', '编织袋、铅丝笼、救生衣、抽水泵、应急照明和土工布', '90日历天', '应急保障部陈工', '2026-06-01', false],
      ['都江堰灌区现代化改造工程设备采购招标公告', 'BID-2026-0605', '都江堰灌区现代化改造工程设备采购', '竞争性磋商', '2200万元', '都江堰灌区及指定安装点', '自动化闸门、流量计量、视频监控、通信网络和备电系统', '150日历天', '工程管理部何工', '2026-06-05', false],
      ['岷江流域水质在线监测站建设项目招标公告', 'BID-2026-0610', '岷江流域水质在线监测站建设项目', '公开招标', '980万元', '岷江干流及重要支流监测断面', '水质传感器、站房集成、采样预处理、数据传输和运维服务', '160日历天', '生态水务部赵工', '2026-06-10', false],
      ['农村供水保障工程管网材料采购招标公告', 'BID-2026-0616', '农村供水保障工程管网材料采购', '公开招标', '1250万元', '川东北片区农村供水工程现场', 'PE管、球墨铸铁管、阀门井配件、入户水表和安装辅材', '100日历天', '供水事业部杨工', '2026-06-16', false],
      ['水库大坝安全监测自动化改造项目招标公告', 'BID-2026-0620', '水库大坝安全监测自动化改造项目', '公开招标', '760万元', '集团所属重点中型水库', '渗压计、位移计、雨量站、采集终端、预警平台和技术服务', '140日历天', '安全运行部刘工', '2026-06-20', false],
      ['泵站节能改造及电气设备采购招标公告', 'BID-2026-0625', '泵站节能改造及电气设备采购', '竞争性磋商', '540万元', '成都平原灌区骨干泵站', '高效水泵、变频柜、智能电表、电缆桥架及安装调试', '80日历天', '机电设备部唐工', '2026-06-25', false],
      ['水利工程施工监理服务框架协议采购公告', 'BID-2026-0701', '水利工程施工监理服务框架协议采购', '框架协议采购', '400万元', '集团年度新开工水利工程项目', '施工准备、质量进度投资控制、安全文明监督和档案审核服务', '自协议签订之日起一年', '招采管理部蒋工', '2026-07-01', false],
      ['渠道清淤及生态修复工程施工招标公告', 'BID-2026-0706', '渠道清淤及生态修复工程施工', '公开招标', '1860万元', '川中灌区骨干渠道沿线', '渠道清淤、边坡修复、生态护岸、弃土处置和水保措施', '210日历天', '工程建设部宋工', '2026-07-06', false],
      ['水利工程档案数字化加工服务采购公告', 'BID-2026-0712', '水利工程档案数字化加工服务采购', '竞争性磋商', '320万元', '集团档案中心及项目单位档案室', '纸质档案整理、扫描、著录、质检、挂接和安全保密服务', '120日历天', '综合管理部罗工', '2026-07-12', false],
      ['重点水源工程生态流量监测设备采购招标公告', 'BID-2026-0718', '重点水源工程生态流量监测设备采购', '公开招标', '690万元', '重点水源工程取退水口及生态断面', '雷达流量计、视频水尺、太阳能供电、通信终端和平台接入', '110日历天', '水资源管理部邓工', '2026-07-18', false],
    ], buildBidNoticeContent),
    ...buildAnnouncementSeeds('WIN_NOTICE', [
      ['升钟水库灌区续建配套工程中标公示', 'BID-2026-0526', '升钟水库灌区续建配套工程', '四川川水建设工程有限公司', '3260万元', '95.6分', '180日历天', '合格，争创省优', '2026-06-06'],
      ['武引水库除险加固工程勘察设计中标公示', 'BID-2026-0415', '武引水库除险加固工程勘察设计', '四川省水利水电勘测设计研究院', '458万元', '96.3分', '90日历天', '满足现行勘察设计规范', '2026-05-09'],
      ['岷江流域水质在线监测站建设项目中标公示', 'BID-2026-0610', '岷江流域水质在线监测站建设项目', '四川智水科技有限公司', '948万元', '94.8分', '160日历天', '达到等保及环保监测要求', '2026-07-22'],
      ['农村供水保障工程管网材料采购中标公示', 'BID-2026-0616', '农村供水保障工程管网材料采购', '成都华西物资供应有限公司', '1218万元', '93.5分', '100日历天', '符合国家饮用水管材标准', '2026-07-28'],
      ['水库大坝安全监测自动化改造项目中标公示', 'BID-2026-0620', '水库大坝安全监测自动化改造项目', '成都数源水利科技有限公司', '738万元', '92.9分', '140日历天', '满足安全监测验收规程', '2026-08-01'],
      ['泵站节能改造及电气设备采购中标公示', 'BID-2026-0625', '泵站节能改造及电气设备采购', '四川宏达机电设备有限公司', '526万元', '91.7分', '80日历天', '一次性验收合格', '2026-08-06'],
      ['水利工程施工监理服务框架协议采购入围公示', 'BID-2026-0701', '水利工程施工监理服务框架协议采购', '四川水发工程监理咨询有限公司', '综合费率下浮12%', '95.1分', '协议期一年', '按项目合同约定执行', '2026-08-12'],
      ['渠道清淤及生态修复工程施工中标公示', 'BID-2026-0706', '渠道清淤及生态修复工程施工', '四川清源生态建设有限公司', '1812万元', '94.2分', '210日历天', '合格并满足水保要求', '2026-08-18'],
      ['水利工程档案数字化加工服务中标公示', 'BID-2026-0712', '水利工程档案数字化加工服务采购', '成都云档信息技术有限公司', '306万元', '93.0分', '120日历天', '符合档案数字化规范', '2026-08-24'],
      ['重点水源工程生态流量监测设备采购中标公示', 'BID-2026-0718', '重点水源工程生态流量监测设备采购', '四川川仪水务装备有限公司', '672万元', '92.6分', '110日历天', '满足生态流量监管要求', '2026-08-30'],
      ['年度办公及生产网络安全服务采购中标公示', 'BID-2026-0722', '年度办公及生产网络安全服务采购', '四川安信网盾科技有限公司', '286万元', '94.5分', '一年', '满足等保测评整改要求', '2026-09-03'],
      ['水厂自动加药系统改造项目中标公示', 'BID-2026-0728', '水厂自动加药系统改造项目', '成都净源自动化设备有限公司', '438万元', '91.9分', '95日历天', '出水指标稳定达标', '2026-09-09'],
    ], buildWinNoticeContent),
    ...buildAnnouncementSeeds('POLICY', [
      ['关于规范供应商注册及资质管理工作的通知', '供应商注册、资质维护、信息变更和违规处理', '供应商及相关单位', '2026-05-15'],
      ['关于进一步加强招标投标活动廉洁自律的通知', '围标串标防控、专家回避、监督举报和责任追究', '集团各部门、供应商及评标专家', '2026-04-20'],
      ['供应商信用评价结果应用管理细则', '信用等级、评价周期、结果应用和申诉复核', '已入库供应商及采购使用部门', '2026-06-03'],
      ['非招标采购方式适用范围及审批流程指引', '询价、竞争性谈判、单一来源和框架协议采购适用条件', '采购经办人员及项目单位', '2026-06-08'],
      ['采购需求编制与论证管理办法', '需求调研、技术参数、预算测算和专家论证', '项目申报部门及采购中心', '2026-06-12'],
      ['评标专家抽取与履职评价管理规定', '专家抽取、签到回避、评审纪律和履职评价', '评标专家及监督人员', '2026-06-18'],
      ['采购合同履约验收管理细则', '交付确认、质量验收、问题整改和付款条件', '合同承办部门及供应商', '2026-06-24'],
      ['供应商黑名单及失信行为处理办法', '失信认定、限制措施、修复条件和公示管理', '全部供应商及采购参与人员', '2026-07-02'],
      ['电子招标投标档案归档管理规范', '电子文件形成、签章、校验、归档和长期保存', '项目单位、采购中心及档案管理人员', '2026-07-09'],
      ['采购项目预算控制与价格评审指引', '预算编制、最高限价、异常低价和价格评审', '项目预算编制人员及评标委员会', '2026-07-16'],
      ['供应商现场踏勘和答疑澄清管理规则', '踏勘组织、问题收集、澄清发布和公平披露', '采购经办人员及潜在投标人', '2026-07-23'],
      ['采购活动数据安全与保密管理要求', '账号权限、文件加密、日志审计和保密责任', '平台用户、评标专家及系统运维人员', '2026-07-30'],
    ], buildPolicyContent),
    ...buildAnnouncementSeeds('PLATFORM', [
      ['ERP供应商门户系统升级公告', '供应商门户', '在线标书提交、实时消息通知、评价记录查看和信息变更申请', '2026-06-01'],
      ['关于开展2026年度供应商年度评估的通知', '供应商管理模块', '资料完整性、响应及时性、履约表现、合规经营和综合评价', '2026-06-02'],
      ['电子开标大厅浏览器兼容性提醒', '在线开标大厅', '证书驱动检测、浏览器版本提示、网络连通性检查和应急联系方式', '2026-06-09'],
      ['评标专家工作台评分功能优化公告', '专家工作台', '分项评分暂存、异常分差提醒、回避确认和电子签章', '2026-06-14'],
      ['采购商城商品目录维护通知', '采购商城', '商品分类调整、价格有效期维护、图片规范和上下架流程', '2026-06-19'],
      ['平台短信与邮件通知通道切换公告', '消息通知中心', '短信模板升级、邮件域名调整、到达率监控和退订说明', '2026-06-26'],
      ['系统例行维护窗口公告', '全平台', '数据库备份、索引优化、日志归档和短时访问影响', '2026-07-03'],
      ['供应商资质到期自动提醒功能上线公告', '供应商资质模块', '90天、30天、7天分级提醒和在线补充材料', '2026-07-10'],
      ['移动端门户试运行公告', '移动端门户', '公告查询、项目报名、消息查看和资料预览', '2026-07-17'],
      ['CA证书在线绑定流程调整公告', '账号与证书中心', '证书绑定、解绑、授权委托和异常申诉流程', '2026-07-24'],
      ['采购项目进度看板上线公告', '采购项目看板', '阶段节点、责任人、逾期预警和统计导出', '2026-07-31'],
      ['平台用户账号安全专项提醒', '账号安全中心', '密码强度、异地登录提醒、权限复核和离职账号停用', '2026-08-07'],
    ], buildPlatformContent),
  ];

  const announcements = await prisma.announcement.createMany({
    data: announcementSeeds,
    skipDuplicates: true,
  });

  console.log(`Seeded: ${announcements.count} announcements`);

  // ── Seed a demo supplier user for testing the portal ──
  const demoSupplierUser = await prisma.user.upsert({
    where: { username: 'supplier1' },
    update: {},
    create: {
      username: 'supplier1',
      displayName: '张经理',
      passwordHash: hashSync('supplier1@2026', 10),
      role: 'supplier',
      isActive: true,
      email: 'zhang@chuanshui.com',
    },
  });

  const demoClassification = await prisma.supplierClassification.upsert({
    where: { code: 'ENG' },
    update: {},
    create: { name: '工程建设类', code: 'ENG', description: '水利、市政、建筑工程施工类供应商' },
  });

  await prisma.supplierClassification.upsert({
    where: { code: 'MAT' },
    update: {},
    create: { name: '物资采购类', code: 'MAT', description: '钢材、水泥、建材等物资供应商' },
  });
  await prisma.supplierClassification.upsert({
    where: { code: 'SVC' },
    update: {},
    create: { name: '服务采购类', code: 'SVC', description: '软件、咨询、监理等服务供应商' },
  });

  const demoSupplier = await prisma.supplier.upsert({
    where: { userId: demoSupplierUser.id },
    update: {},
    create: {
      userId: demoSupplierUser.id,
      name: '四川川水建设工程有限公司',
      normalizedName: '四川川水建设工程有限公司',
      creditCode: '91510000MA62K5XX0X',
      enterpriseType: '国有企业',
      legalPerson: '张明',
      registeredAddress: '四川省成都市高新区天府大道北段1700号',
      businessScope: '水利水电工程、市政公用工程、房屋建筑工程施工；建筑材料销售',
      status: 'APPROVED',
      classificationId: demoClassification.id,
      contacts: {
        create: [
          { name: '张经理', phone: '13800138001', email: 'zhang@chuanshui.com', isPrimary: true },
          { name: '王芳', phone: '13800138002', email: 'wangfang@chuanshui.com', isPrimary: false },
        ],
      },
      qualifications: {
        create: [
          { type: '营业执照', name: '企业法人营业执照', fileUrl: '/uploads/license.pdf', validFrom: new Date('2020-01-01'), validTo: new Date('2030-12-31'), status: '有效' },
          { type: '资质证书', name: '水利水电工程施工总承包一级', fileUrl: '/uploads/qual1.pdf', validFrom: new Date('2023-06-01'), validTo: new Date('2028-06-30'), status: '有效' },
          { type: '安全生产许可证', name: '安全生产许可证', fileUrl: '/uploads/safety.pdf', validFrom: new Date('2022-03-15'), validTo: new Date('2027-03-14'), status: '有效' },
          { type: '质量管理体系认证', name: 'ISO 9001质量管理体系认证', fileUrl: '/uploads/iso9001.pdf', validFrom: new Date('2024-01-10'), validTo: new Date('2027-01-09'), status: '有效' },
        ],
      },
    },
  });

  // Seed evaluations for demo supplier
  await prisma.supplierEvaluation.createMany({
    data: [
      {
        supplierId: demoSupplier.id, evaluatorId: demoSupplierUser.id, projectId: project.id,
        score: 95.0, level: 'A',
        completenessScore: 18.5, responsivenessScore: 19.0, cooperationScore: 19.5, complianceScore: 19.0, overallScore: 19.0,
        comment: '工程质量优秀，履约能力强，配合度高。',
      },
      {
        supplierId: demoSupplier.id, evaluatorId: demoSupplierUser.id,
        score: 88.0, level: 'B',
        completenessScore: 17.0, responsivenessScore: 18.0, cooperationScore: 18.0, complianceScore: 17.5, overallScore: 17.5,
        comment: '整体表现良好，建议加强资料完整性。',
      },
      {
        supplierId: demoSupplier.id, evaluatorId: demoSupplierUser.id,
        score: 92.0, level: 'A',
        completenessScore: 18.0, responsivenessScore: 19.0, cooperationScore: 18.5, complianceScore: 18.5, overallScore: 18.0,
      },
    ],
    skipDuplicates: true,
  });

  // Seed notifications for demo supplier user
  await prisma.notification.createMany({
    data: [
      { userId: demoSupplierUser.id, type: 'SUPPLIER_APPROVED', title: '供应商审核通过', content: '您的供应商注册申请已审核通过，企业名称：四川川水建设工程有限公司。欢迎加入供应商库！', link: '/profile' },
      { userId: demoSupplierUser.id, type: 'BID_PUBLISHED', title: '新招标公告发布', content: '2026年度水利工程物资集中采购项目已发布招标公告，截止时间：2026年6月8日。', link: '/bids' },
      { userId: demoSupplierUser.id, type: 'BID_REMINDER', title: '投标截止提醒', content: '项目"智慧水务信息化系统建设项目"投标截止时间为明天14:00，请尽快完成提交。', link: '/my-bids' },
      { userId: demoSupplierUser.id, type: 'SYSTEM', title: '资质即将到期提醒', content: '您有一项资质证书"安全生产许可证"将于90天后到期，请及时更新。', link: '/qualifications' },
    ],
    skipDuplicates: true,
  });

  // Seed more bid projects for richer demo
  await prisma.bidProject.create({
    data: {
      projectCode: 'BID-2026-0522',
      name: '智慧水务信息化系统建设项目',
      procurementMethod: '综合评分法',
      openTime: new Date('2026-07-10T14:30:00'),
      deadline: new Date('2026-07-10T14:00:00'),
      stage: 'SUBMIT',
      riskNote: '1家插件版本过旧',
    },
  });

  await prisma.bidProject.create({
    data: {
      projectCode: 'BID-2026-0526',
      name: '升钟水库灌区续建配套工程',
      procurementMethod: '经评审最低价法',
      openTime: new Date('2026-06-05T10:00:00'),
      deadline: new Date('2026-06-05T09:30:00'),
      stage: 'ARCHIVED',
    },
  });

  await prisma.bidProject.create({
    data: {
      projectCode: 'BID-2026-0601',
      name: '2026年度防汛抗旱物资储备采购',
      procurementMethod: '公开招标',
      openTime: new Date('2026-07-20T09:00:00'),
      deadline: new Date('2026-07-20T08:30:00'),
      stage: 'DOWNLOAD',
    },
  });

  await prisma.bidProject.create({
    data: {
      projectCode: 'BID-2026-0605',
      name: '都江堰灌区现代化改造工程设备采购',
      procurementMethod: '竞争性磋商',
      openTime: new Date('2026-07-15T10:00:00'),
      deadline: new Date('2026-07-15T09:30:00'),
      stage: 'SUBMIT',
    },
  });

  // ── Seed 管理端通知（投递给采购管理端账号 caigou）──
  await prisma.notification.createMany({
    data: [
      { userId: webUser.id, type: 'SYSTEM', title: '系统升级完成', content: 'ERP管理平台已完成v2.0升级，新增专家工作台、供应商门户等功能模块。', link: '/dashboard' },
      { userId: webUser.id, type: 'SYSTEM', title: '新供应商注册待审核', content: '供应商"成都华西物资供应有限公司"提交了入库申请，请及时审核。', link: '/supplier' },
      { userId: webUser.id, type: 'SYSTEM', title: '评标进度提醒', content: '项目"2026年度水利工程物资集中采购"已有3位专家提交评分，当前进度85%。', link: '/bid' },
      { userId: webUser.id, type: 'SYSTEM', title: '供应商资质到期预警', content: '有2家供应商的资质证书将在30天内到期，请通知相关供应商及时更新。', link: '/supplier' },
    ],
    skipDuplicates: true,
  });

  // ── Seed pending supplier for admin to review ──
  const pendingSupplierUser = await prisma.user.upsert({
    where: { username: 'supplier2' },
    update: {},
    create: {
      username: 'supplier2',
      displayName: '赵总',
      passwordHash: hashSync('supplier2@2026', 10),
      role: 'supplier',
      isActive: true,
      email: 'zhao@huaxi.com',
    },
  });

  await prisma.supplier.upsert({
    where: { userId: pendingSupplierUser.id },
    update: {},
    create: {
      userId: pendingSupplierUser.id,
      name: '成都华西物资供应有限公司',
      normalizedName: '成都华西物资供应有限公司',
      creditCode: '91510100MA6D3KXX1X',
      enterpriseType: '有限责任公司',
      legalPerson: '赵伟',
      registeredAddress: '四川省成都市武侯区人民南路四段1号',
      businessScope: '建筑材料、金属材料、五金交电销售；货物进出口',
      status: 'PENDING',
      contacts: {
        create: [
          { name: '赵总', phone: '13900139001', email: 'zhao@huaxi.com', isPrimary: true },
        ],
      },
      qualifications: {
        create: [
          { type: '营业执照', name: '企业法人营业执照', fileUrl: '/uploads/hx-license.pdf', validFrom: new Date('2021-05-01'), validTo: new Date('2031-04-30'), status: '有效' },
        ],
      },
    },
  });

  // ── 电子商城账号（mall 门户）──
  await prisma.user.upsert({
    where: { username: 'mall' },
    update: {},
    create: {
      username: 'mall',
      displayName: '商城采购员',
      passwordHash: hashSync('mall@2026', 10),
      role: 'mall',
      isActive: true,
      email: 'mall@scsdjt.com',
    },
  });

  console.log('Seeded: caigou/mall accounts, expert users, pending supplier');
  console.log('\n  各门户独立账号（每端口需单独登录）:');
  console.log('    [采购管理端 :3004]  caigou / caigou@2026');
  console.log('    [开评标管理端 :3007]  lizhuren / lizhuren@2026  (登录入口为专家端 :3005 → 管理员tab)');
  console.log('    [供应商端  :3003]  supplier1 / supplier1@2026');
  console.log('    [专家评标  :3005]  wangjg / wangjg@2026    · liuxm / liuxm@2026  · chenzq / chenzq@2026');
  console.log('    [电子商城  :3002]  mall / mall@2026');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
