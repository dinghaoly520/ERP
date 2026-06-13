import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const dept = await prisma.department.upsert({
    where: { name: '采购中心' },
    update: {},
    create: { name: '采购中心', code: 'PROC' },
  });

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      displayName: '系统管理员',
      passwordHash: hashSync('admin123', 10),
      role: 'admin',
      departmentId: dept.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'lizhuren' },
    update: {},
    create: {
      username: 'lizhuren',
      displayName: '李主任',
      passwordHash: hashSync('123456', 10),
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
      passwordHash: hashSync('123456', 10),
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
      passwordHash: hashSync('123456', 10),
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
      passwordHash: hashSync('123456', 10),
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

  // ── Seed announcements (15 announcements, content 500-1000 chars each) ──
  const announcements = await Promise.all([
    // ── 招标公告 (BID_NOTICE) ──
    prisma.announcement.create({
      data: {
        title: '2026年度水利工程物资集中采购招标公告',
        content: `<h2>招标公告</h2>
<p>根据《中华人民共和国政府采购法》《中华人民共和国招标投标法》及其实施条例等有关规定，四川水发集团就2026年度水利工程物资集中采购项目进行公开招标，欢迎符合条件的供应商参加投标。</p>
<h3>一、项目概况</h3>
<p>项目名称：2026年度水利工程物资集中采购</p>
<p>项目编号：BID-2026-0518</p>
<p>采购方式：公开招标</p>
<p>预算金额：人民币壹仟伍佰万元整（¥15,000,000.00）</p>
<p>项目地点：四川省成都市及所辖水利工程项目现场</p>
<p>交货期限：合同签订后120日历天内完成全部物资的交付及验收</p>
<p>质量标准：符合国家标准及相关行业规范要求</p>
<h3>二、投标人资格要求</h3>
<p>1. 具有独立法人资格，持有有效的营业执照，经营范围须涵盖本次采购内容；</p>
<p>2. 具有良好的商业信誉和健全的财务会计制度，提供近三年经审计的财务报表；</p>
<p>3. 具有履行合同所必需的设备和专业技术能力，提供相关证明材料；</p>
<p>4. 参加政府采购活动前三年内，在经营活动中没有重大违法记录，须提供书面声明；</p>
<p>5. 本项目不接受联合体投标，不允许转包或分包。</p>
<h3>三、报名时间及方式</h3>
<p>报名时间：2026年5月20日至2026年6月5日（工作日9:00-17:00）</p>
<p>报名方式：通过四川水发集团ERP供应商门户（supplier.scsdjt.com）在线报名</p>
<p>联系人：采购中心 李主任　电话：028-8888-0518</p>`,
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        summary: '2026年度水利工程物资集中采购项目公开招标',
        publishDate: new Date('2026-05-20'),
        isTop: true,
        relatedProjectCode: 'BID-2026-0518',
        viewCount: 256,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '智慧水务信息化系统建设项目招标公告',
        content: `<h2>招标公告</h2>
<p>四川水发集团拟就智慧水务信息化系统建设项目进行公开招标，现邀请合格的供应商前来投标。本项目旨在通过信息化手段提升集团水务管理效率，实现数据采集、监测预警、调度指挥等核心功能的智能化升级。</p>
<h3>一、项目基本信息</h3>
<p>项目名称：智慧水务信息化系统建设项目</p>
<p>项目编号：BID-2026-0522</p>
<p>采购方式：综合评分法</p>
<p>预算金额：人民币捌佰万元整（¥8,000,000.00）</p>
<p>项目周期：合同签订后180日历天内完成系统开发、部署及试运行</p>
<h3>二、采购需求概述</h3>
<p>1. 水务数据采集与监测平台建设：覆盖集团所辖水库、灌区、取水口等重点水利工程的水情、雨情、工情数据实时采集与在线监测；</p>
<p>2. 智能调度指挥中心：建设集GIS地理信息、视频监控、应急指挥于一体的综合调度平台；</p>
<p>3. 移动端应用开发：开发面向管理人员和一线运维人员的移动端APP，支持巡检上报、工单管理等；</p>
<p>4. 数据中心及网络安全建设：满足等保三级安全要求，建设双活数据中心架构。</p>
<h3>三、投标人资格要求</h3>
<p>1. 具有独立法人资格，持有有效的营业执照；</p>
<p>2. 具备计算机信息系统集成二级及以上资质或电子与智能化工程专业承包二级及以上资质；</p>
<p>3. 近三年内有不少于2个同类信息化系统建设项目业绩，单个合同金额不低于500万元；</p>
<p>4. 项目经理须具备PMP或信息系统项目管理师资质，且具有5年以上信息化项目管理经验。</p>
<h3>四、时间安排</h3>
<p>报名时间：2026年5月22日至2026年6月15日</p>
<p>投标截止时间：2026年7月10日14:00　开标时间：2026年7月10日14:30</p>`,
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        summary: '智慧水务信息化系统建设，综合评分法招标',
        publishDate: new Date('2026-05-22'),
        relatedProjectCode: 'BID-2026-0522',
        viewCount: 189,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '2026年度防汛抗旱物资储备采购招标公告',
        content: `<h2>招标公告</h2>
<p>为保障2026年度汛期防汛抗旱工作的顺利开展，确保各类应急物资储备充足，四川水发集团现就2026年度防汛抗旱物资储备采购项目进行公开招标，诚邀符合条件的供应商积极参与。</p>
<h3>一、项目概况</h3>
<p>项目名称：2026年度防汛抗旱物资储备采购</p>
<p>项目编号：BID-2026-0601</p>
<p>采购方式：公开招标</p>
<p>预算金额：人民币陆佰万元整（¥6,000,000.00）</p>
<p>交货地点：四川省内指定防汛物资仓库（成都、绵阳、南充、达州四个储备点）</p>
<p>交货期限：合同签订后60日历天内完成首批物资交付，90日历天内完成全部物资交付</p>
<h3>二、采购内容</h3>
<p>1. 防汛编织袋：50万条，规格≥60cm×100cm，材质为聚丙烯，需满足国标要求；</p>
<p>2. 防汛铅丝笼：1万个，网格尺寸10cm×10cm，丝径不小于3.0mm；</p>
<p>3. 橡胶救生衣：5000件，需取得船检认证，浮力≥150N；</p>
<p>4. 便携式抽水泵：200台，流量≥200m³/h，扬程≥15m，配套柴油机动力；</p>
<p>5. 应急照明设备：500套，LED光源，防水等级IP65以上，连续工作时间不低于8小时；</p>
<p>6. 土工布：10万平方米，单位面积质量≥300g/m²，抗拉强度≥15kN/m。</p>
<h3>三、资格要求</h3>
<p>投标人须为所投产品的生产企业或授权代理商，具有相关产品的质量检测报告。代理商投标的，须提供生产企业的授权委托书。</p>
<h3>四、报名安排</h3>
<p>报名时间：2026年6月1日至2026年7月10日　报名方式：通过ERP供应商门户在线报名</p>`,
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        summary: '2026年度防汛抗旱物资储备采购项目公开招标',
        publishDate: new Date('2026-06-01'),
        relatedProjectCode: 'BID-2026-0601',
        viewCount: 312,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '都江堰灌区现代化改造工程设备采购招标公告',
        content: `<h2>招标公告</h2>
<p>四川水发集团作为都江堰灌区现代化改造工程的项目实施主体，现就工程所需关键设备进行竞争性磋商采购，欢迎具备相应资质和能力的供应商参与。</p>
<h3>一、项目概况</h3>
<p>项目名称：都江堰灌区现代化改造工程设备采购</p>
<p>项目编号：BID-2026-0605</p>
<p>采购方式：竞争性磋商</p>
<p>预算金额：人民币贰仟贰佰万元整（¥22,000,000.00）</p>
<p>实施地点：都江堰灌区及四川水发集团指定安装地点</p>
<p>供货及安装周期：合同签订后150日历天</p>
<h3>二、采购范围</h3>
<p>1. 自动化闸门控制系统：包含电动执行机构、PLC控制柜、水位流量传感器、远程监控终端等，共48套；</p>
<p>2. 智能水表及流量计量系统：超声波流量计80台、电磁流量计60台，配套数据采集与传输设备；</p>
<p>3. 视频监控及安防系统：高清球机200台、固定枪机150台、NVR录像设备20套、监控平台1套；</p>
<p>4. 通信网络设备：光纤收发器100对、工业交换机50台、无线网桥30套；</p>
<p>5. 电源及备电系统：UPS不间断电源30台、太阳能供电系统20套、柴油发电机组5台。</p>
<h3>三、资格要求</h3>
<p>投标人须为中华人民共和国境内依法注册的企业法人，注册资金不低于500万元，近三年内有不少于2个水利信息化或灌区改造类项目业绩。</p>
<h3>四、时间安排</h3>
<p>磋商文件获取时间：2026年6月5日至2026年7月5日</p>
<p>响应文件提交截止时间：2026年7月15日09:30</p>`,
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        summary: '都江堰灌区现代化改造工程设备竞争性磋商',
        publishDate: new Date('2026-06-05'),
        relatedProjectCode: 'BID-2026-0605',
        viewCount: 278,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '四川水发集团总部办公楼物业管理服务招标公告',
        content: `<h2>招标公告</h2>
<p>四川水发集团总部办公楼物业管理服务项目，现面向社会公开招标，择优选择物业服务单位。</p>
<h3>一、项目基本情况</h3>
<p>项目名称：四川水发集团总部办公楼物业管理服务</p>
<p>项目编号：BID-2026-0401</p>
<p>采购方式：公开招标</p>
<p>预算金额：人民币叁佰贰拾万元整/年（¥3,200,000.00/年），服务期3年</p>
<p>服务对象：四川水发集团总部办公楼（含主楼、裙楼、地下停车场），建筑面积约28,000平方米</p>
<p>服务期限：3年（合同一年一签，年度考核合格后自动续签）</p>
<h3>二、服务范围</h3>
<p>1. 综合客服：前台接待、会议服务、信件收发、来访登记等；</p>
<p>2. 保洁服务：公共区域日常保洁、外墙清洗（每年2次）、石材养护、垃圾分类清运等；</p>
<p>3. 设施设备维护：供配电系统、中央空调、电梯、消防系统、给排水系统的日常巡检和保养维修；</p>
<p>4. 秩序维护：24小时安保巡逻、门禁管理、车辆引导、监控系统值守；</p>
<p>5. 绿化养护：室内绿植养护、室外景观绿化养护，确保四季常青；</p>
<p>6. 餐饮服务：员工食堂运营管理，满足每日300人次就餐需求。</p>
<h3>三、资格要求</h3>
<p>1. 具有独立法人资格，注册资金不低于200万元；</p>
<p>2. 具备物业管理企业二级及以上资质；</p>
<p>3. 近三年内有3个及以上同类办公楼物业管理项目业绩，单个项目面积不少于20,000平方米。</p>
<h3>四、报名安排</h3>
<p>报名时间：2026年4月1日至2026年4月20日　投标截止时间：2026年5月10日10:00</p>`,
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        summary: '集团总部办公楼物业管理服务三年期公开招标',
        publishDate: new Date('2026-04-01'),
        viewCount: 198,
      },
    }),
    // ── 中标公示 (WIN_NOTICE) ──
    prisma.announcement.create({
      data: {
        title: '升钟水库灌区续建配套工程中标公示',
        content: `<h2>中标候选人公示</h2>
<p>项目编号：BID-2026-0526</p>
<p>项目名称：升钟水库灌区续建配套工程</p>
<p>招标方式：经评审最低价法</p>
<p>开标时间：2026年6月5日10:00</p>
<p>公示期：2026年6月6日至2026年6月12日（7个自然日）</p>
<h3>中标候选人信息</h3>
<p>经评标委员会严格按照招标文件规定的评标标准和方法进行评审，推荐中标候选人如下：</p>
<h4>第一中标候选人：四川川水建设工程有限公司</h4>
<p>投标报价：人民币叁仟贰佰陆拾万元整（¥32,600,000.00）</p>
<p>工期承诺：180日历天　质量标准：合格，争创省优</p>
<p>项目经理：刘大伟，一级建造师（水利水电工程），注册编号：SC510120150001</p>
<p>综合评审得分：95.6分</p>
<h4>第二中标候选人：成都华西物资供应有限公司</h4>
<p>投标报价：¥33,100,000.00　工期承诺：190日历天　综合评审得分：91.2分</p>
<h4>第三中标候选人：四川宏达水利工程有限公司</h4>
<p>投标报价：¥33,800,000.00　工期承诺：200日历天　综合评审得分：88.7分</p>
<h3>异议受理</h3>
<p>如对以上公示内容有异议，请在公示期内以书面形式向采购中心提出。异议应当有明确的请求和必要的证明材料。</p>
<p>受理单位：四川水发集团采购中心　电话：028-8888-0526　邮箱：procurement@scsdjt.com</p>`,
        type: 'WIN_NOTICE',
        status: 'PUBLISHED',
        summary: '升钟水库灌区续建配套工程中标候选人公示',
        publishDate: new Date('2026-06-05'),
        viewCount: 342,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '2026年度办公设备集中采购中标公示',
        content: `<h2>中标候选人公示</h2>
<p>项目编号：BID-2026-0310</p>
<p>项目名称：2026年度办公设备集中采购</p>
<p>招标方式：公开招标（最低评标价法）</p>
<p>开标时间：2026年3月25日09:30</p>
<p>公示期：2026年3月26日至2026年4月1日</p>
<h3>中标候选人信息</h3>
<p>第一中标候选人：成都诚信办公设备有限公司</p>
<p>投标报价：¥1,856,000.00</p>
<p>交货承诺：合同签订后15个工作日内完成全部交货及安装调试</p>
<p>质保期：3年（上门服务，4小时响应，8小时到场）</p>
<p>第二中标候选人：四川智远科技发展有限公司</p>
<p>投标报价：¥1,920,000.00</p>
<p>第三中标候选人：绵阳创新电子科技有限公司</p>
<p>投标报价：¥1,975,000.00</p>
<h3>采购内容</h3>
<p>本次采购涵盖台式电脑（120台）、笔记本电脑（50台）、打印机（30台）、投影仪（10台）、会议系统（2套）等办公设备。要求所有设备均为原厂正品，提供原厂授权及售后服务承诺。</p>
<h3>异议渠道</h3>
<p>公示期内如有异议，请以书面形式提交至采购中心。联系电话：028-8888-0310。</p>`,
        type: 'WIN_NOTICE',
        status: 'PUBLISHED',
        summary: '2026年度办公设备集中采购中标候选人公示',
        publishDate: new Date('2026-03-26'),
        viewCount: 156,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '武引水库除险加固工程勘察设计中标公示',
        content: `<h2>中标候选人公示</h2>
<p>项目编号：BID-2026-0415</p>
<p>项目名称：武引水库除险加固工程勘察设计</p>
<p>招标方式：公开招标（综合评分法）</p>
<p>开标时间：2026年5月8日09:00</p>
<p>公示期：2026年5月9日至2026年5月15日</p>
<h3>中标候选人信息</h3>
<p>第一中标候选人：四川省水利水电勘测设计研究院</p>
<p>投标报价：¥4,580,000.00</p>
<p>勘察设计周期：90日历天（初步设计60天+施工图设计30天）</p>
<p>综合评分：96.3分</p>
<p>项目负责人：张志远，注册土木工程师（水利水电），高级工程师，从事水利设计20年</p>
<p>第二中标候选人：中国电建集团成都勘测设计研究院</p>
<p>投标报价：¥4,820,000.00　综合评分：94.1分</p>
<p>第三中标候选人：长江勘测规划设计研究院</p>
<p>投标报价：¥5,100,000.00　综合评分：91.5分</p>
<h3>项目概况</h3>
<p>武引水库位于四川省绵阳市江油市，总库容5.73亿立方米，是一座以防洪、灌溉为主，兼顾发电、供水等综合利用的大（一）型水利工程。本次除险加固工程主要内容包括大坝防渗处理、溢洪道加固改造、输水建筑物维修更新及金属结构更换等。勘察设计需按初步设计和施工图设计两个阶段实施。</p>
<h3>异议受理</h3>
<p>如对公示内容有异议，请在公示期内以书面形式提出。联系电话：028-8888-0415。</p>`,
        type: 'WIN_NOTICE',
        status: 'PUBLISHED',
        summary: '武引水库除险加固工程勘察设计中标候选人公示',
        publishDate: new Date('2026-05-09'),
        viewCount: 267,
      },
    }),
    // ── 政策法规 (POLICY) ──
    prisma.announcement.create({
      data: {
        title: '关于规范供应商注册及资质管理工作的通知',
        content: `<h2>关于规范供应商注册及资质管理工作的通知</h2>
<p>各供应商及相关单位：</p>
<p>为进一步规范四川水发集团供应商注册及资质管理工作，提升供应商库整体质量，保障采购活动的公平、公正、公开，根据《中华人民共和国政府采购法》及其实施条例、《政府采购供应商投诉处理办法》等相关法律法规，结合集团采购管理实际，现就有关事项通知如下：</p>
<h3>一、新注册供应商资质要求</h3>
<p>1. 所有新注册供应商须在注册时上传完整的企业资质材料，包括但不限于：营业执照正本扫描件、组织机构代码证、税务登记证（或三证合一证照）、开户许可证、法定代表人身份证明等；</p>
<p>2. 经营范围须与申请入库的供应商类别相匹配，不符合经营范围的企业将不予审核通过；</p>
<p>3. 供应商须指定至少一名专职联系人，并确保联系方式真实有效、能够及时接收通知。</p>
<h3>二、已入库供应商资质维护</h3>
<p>1. 已入库供应商的资质材料即将到期（有效期不足90天）的，须提前30天通过供应商门户提交更新申请；</p>
<p>2. 逾期未更新的资质将自动标记为"过期"状态，影响该供应商参与新的采购活动；</p>
<p>3. 企业基本信息发生变更（如企业名称、法定代表人、注册地址等），须在变更发生后15个工作日内通过供应商门户提交变更申请。</p>
<h3>三、信息变更流程</h3>
<p>所有信息变更须通过四川水发集团ERP供应商门户提交变更申请，上传相关证明材料，经采购中心审核通过后生效。不接受线下纸质变更申请。</p>
<h3>四、违规处理</h3>
<p>对提供虚假材料、冒用他人资质等违规行为，一经查实，将取消供应商资格并列入黑名单，三年内不得重新申请入库。本通知自发布之日起施行。</p>
<p>四川水发集团采购中心　2026年5月15日</p>`,
        type: 'POLICY',
        status: 'PUBLISHED',
        summary: '规范供应商注册及资质管理的政策通知',
        publishDate: new Date('2026-05-15'),
        viewCount: 512,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '关于进一步加强招标投标活动廉洁自律的通知',
        content: `<h2>关于进一步加强招标投标活动廉洁自律的通知</h2>
<p>集团各部门、各项目单位、各供应商及评标专家：</p>
<p>为深入贯彻落实中央八项规定精神和省委省政府关于廉洁建设的部署要求，进一步规范招标投标活动，营造公平竞争的市场环境，根据《中华人民共和国招标投标法》《招标投标法实施条例》及集团相关管理制度，现就加强招标投标活动廉洁自律有关事项通知如下：</p>
<h3>一、严禁围标串标行为</h3>
<p>1. 投标人之间不得相互约定投标报价、事先约定中标者或采取其他方式协同投标；</p>
<p>2. 投标人与招标人不得串通投标，不得通过行贿、送礼等不正当手段影响评标结果；</p>
<p>3. 对查实的围标串标行为，将依法取消投标资格，没收投标保证金，并移送有关部门处理。</p>
<h3>二、规范评标专家行为</h3>
<p>1. 评标专家应严格遵守回避制度，与投标人有利害关系的应主动申报回避；</p>
<p>2. 评标过程应独立客观，不得私下接触投标人或接受投标人的馈赠和宴请；</p>
<p>3. 评标专家不得向他人透露评标过程、评审意见及评审结论。</p>
<h3>三、加强监督管理</h3>
<p>1. 纪检监察部门将全程监督重大项目的招标投标活动；</p>
<p>2. 建立健全投诉举报机制，接受社会各界的监督；</p>
<p>3. 对违规违纪行为实行"零容忍"，发现一起、查处一起。</p>
<p>本通知自发布之日起执行。举报电话：028-8888-0001，举报邮箱：jubao@scsdjt.com。</p>`,
        type: 'POLICY',
        status: 'PUBLISHED',
        summary: '加强招标投标活动廉洁自律的政策通知',
        publishDate: new Date('2026-04-20'),
        viewCount: 438,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '关于印发《四川水发集团采购管理办法（2026年修订）》的通知',
        content: `<h2>关于印发《四川水发集团采购管理办法（2026年修订）》的通知</h2>
<p>集团各部门、各全资及控股子公司：</p>
<p>为进一步规范集团采购管理行为，提高采购效率，降低采购成本，防范采购风险，根据《中华人民共和国政府采购法》《中华人民共和国招标投标法》《四川省国有企业采购管理指引》等法律法规及规范性文件，结合集团实际情况和管理需要，对2024年版采购管理办法进行了全面修订。现将《四川水发集团采购管理办法（2026年修订）》印发给你们，请认真遵照执行。</p>
<h3>本次修订主要内容</h3>
<p>一、优化采购方式适用范围：明确了公开招标、邀请招标、竞争性磋商、竞争性谈判、单一来源采购、询价等六种采购方式的具体适用情形和审批权限；</p>
<p>二、强化供应商管理：新增供应商分类分级管理、供应商动态评价、黑名单制度等内容，建立供应商全生命周期管理体系；</p>
<p>三、完善评标专家管理：新增专家抽取"双随机"机制、专家履职评价制度，建立专家考核退出机制；</p>
<p>四、加强信息化管理：明确所有采购活动须通过集团ERP系统进行全流程线上管理，实现采购过程可追溯、可审计；</p>
<p>五、强化监督管理：新增采购后评价制度、供应商投诉处理机制，明确纪检审计部门的监督职责。</p>
<h3>执行要求</h3>
<p>各部门及子公司应于2026年6月30日前完成制度宣贯和培训工作，确保相关人员知悉并严格执行新办法的各项要求。执行中如有问题或建议，请及时反馈至采购中心。</p>
<p>四川水发集团有限公司　2026年4月10日</p>`,
        type: 'POLICY',
        status: 'PUBLISHED',
        summary: '印发2026年修订版采购管理办法的通知',
        publishDate: new Date('2026-04-10'),
        viewCount: 389,
      },
    }),
    // ── 平台通知 (PLATFORM) ──
    prisma.announcement.create({
      data: {
        title: 'ERP供应商门户系统升级公告',
        content: `<h2>ERP供应商门户系统升级公告</h2>
<p>尊敬的各供应商用户：</p>
<p>为持续提升用户体验和系统功能，四川水发集团技术团队于2026年6月1日凌晨完成了ERP供应商门户系统的全面升级。本次升级新增和优化了多项功能，现公告如下：</p>
<h3>一、新增功能</h3>
<p>1. 在线标书提交功能：供应商可直接通过门户在线编制和提交投标文件，支持PDF、Word、Excel等格式的文件上传，系统自动校验文件完整性和格式合规性；</p>
<p>2. 实时消息通知：新增站内信、邮件、短信三通道消息推送机制，确保供应商及时接收招标公告、中标通知、资质到期提醒等关键信息；</p>
<p>3. 评价记录查看：供应商可在线查看历史参与项目的评价记录和评分详情，了解自身在各维度的表现情况；</p>
<p>4. 信息变更在线申请：支持企业名称、法定代表人、注册地址、联系方式等关键信息的在线变更申请，审核进度实时可查。</p>
<h3>二、功能优化</h3>
<p>1. 招标公告列表新增高级筛选功能，支持按项目类型、采购方式、发布时间等多维度查询；</p>
<p>2. 优化了文件上传速度和稳定性，单个文件上传上限提升至500MB；</p>
<p>3. 新增移动端适配，支持通过手机浏览器正常使用门户核心功能。</p>
<h3>三、注意事项</h3>
<p>本次升级为无缝升级，不影响现有数据和使用习惯。如在升级后遇到任何使用问题，请联系技术支持：028-8888-9999。</p>
<p>四川水发集团信息技术部　2026年6月1日</p>`,
        type: 'PLATFORM',
        status: 'PUBLISHED',
        summary: '供应商门户系统功能升级通知',
        publishDate: new Date('2026-06-01'),
        viewCount: 128,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '关于开展2026年度供应商年度评估的通知',
        content: `<h2>关于开展2026年度供应商年度评估的通知</h2>
<p>各已入库供应商：</p>
<p>根据《四川水发集团采购管理办法》及《供应商管理办法》相关规定，集团采购中心将于2026年6月启动2026年度供应商年度评估工作。现将有关事项通知如下：</p>
<h3>一、评估范围</h3>
<p>截至2026年5月31日前已通过审核进入集团供应商库的所有供应商。</p>
<h3>二、评估维度</h3>
<p>本次评估将从以下五个维度进行综合评分（满分100分）：</p>
<p>1. 资料完整性（20分）：企业资质材料的齐全程度、有效性和规范性；</p>
<p>2. 响应及时性（20分）：对招标邀请、询价函等采购文件的响应速度和配合程度；</p>
<p>3. 合作表现（20分）：已执行合同的履约表现，包括交货准时率、质量合格率等；</p>
<p>4. 合规经营（20分）：企业信用状况、纳税情况、社保缴纳情况等合规性指标；</p>
<p>5. 综合评价（20分）：采购使用部门对供应商的综合服务能力评价。</p>
<h3>三、评估等级</h3>
<p>根据综合评分结果，供应商将被评定为A（优秀，≥90分）、B（良好，80-89分）、C（合格，70-79分）、D（不合格，＜70分）四个等级。D级供应商将暂停参与新项目投标资格6个月。</p>
<h3>四、时间安排</h3>
<p>评估周期：2026年6月1日至2026年6月30日</p>
<p>结果公示：2026年7月15日前通过供应商门户公示评估结果</p>
<p>请各供应商积极配合，及时更新和维护企业信息。如有疑问请联系采购中心：028-8888-0518。</p>`,
        type: 'PLATFORM',
        status: 'PUBLISHED',
        summary: '2026年度供应商年度评估工作启动通知',
        publishDate: new Date('2026-06-02'),
        viewCount: 456,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '系统维护公告：2026年6月15日例行维护',
        content: `<h2>系统维护公告</h2>
<p>尊敬的各位用户：</p>
<p>为保障系统稳定运行和数据安全，四川水发集团ERP管理平台将于2026年6月15日（周日）进行例行维护升级。维护期间部分功能将暂时不可用，现将具体安排公告如下：</p>
<h3>一、维护时间</h3>
<p>2026年6月15日 00:00 - 06:00（共计6小时）</p>
<h3>二、影响范围</h3>
<p>1. 供应商门户（supplier.scsdjt.com）：暂停在线投标文件提交功能，浏览和查询功能不受影响；</p>
<p>2. 专家评标系统：暂停在线评分提交功能，已提交的评分数据不受影响；</p>
<p>3. 管理后台：暂停审批和流程操作功能，数据查询和统计功能正常使用；</p>
<p>4. 公共信息门户：完全正常访问，不受维护影响。</p>
<h3>三、维护内容</h3>
<p>1. 数据库性能优化：对核心业务表进行索引优化和分区调整，提升查询效率；</p>
<p>2. 安全补丁更新：修复近期发现的安全漏洞，升级SSL证书；</p>
<p>3. 存储扩容：扩展文件存储空间，提升文件上传和下载速度；</p>
<p>4. 备份策略优化：升级数据备份方案，缩短数据恢复时间目标（RTO）。</p>
<h3>四、温馨提示</h3>
<p>请各用户提前做好工作安排，避免在维护时段内进行重要业务操作。维护完成后系统将自动恢复，无需重新登录。如有紧急事务，请联系技术支持热线：028-8888-9999。</p>
<p>给您带来不便，敬请谅解。　四川水发集团信息技术部　2026年6月10日</p>`,
        type: 'PLATFORM',
        status: 'PUBLISHED',
        summary: '2026年6月15日ERP系统例行维护公告',
        publishDate: new Date('2026-06-10'),
        viewCount: 98,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '关于启用电子签章功能的通知',
        content: `<h2>关于启用电子签章功能的通知</h2>
<p>各供应商、评标专家、集团各部门：</p>
<p>为进一步推进采购业务全流程电子化，提高合同签订效率，降低纸质文件管理成本，经集团研究决定，自2026年5月25日起正式启用电子签章功能。现将有关事项通知如下：</p>
<h3>一、适用范围</h3>
<p>1. 采购合同签署：集团与中标供应商之间的采购合同、框架协议等法律文件；</p>
<p>2. 投标文件签署：供应商在线提交的投标文件中的签章页；</p>
<p>3. 评标报告签署：评标专家对评标报告的在线确认和签章；</p>
<p>4. 变更审批签署：供应商信息变更、合同变更等审批流程中的签章确认。</p>
<h3>二、功能说明</h3>
<p>1. 电子签章采用符合《中华人民共和国电子签名法》规定的可靠电子签名技术，具有与手写签名和盖章同等的法律效力；</p>
<p>2. 每个签章操作均会生成唯一的时间戳和数字证书，确保文件防篡改、可验证；</p>
<p>3. 已签章文件可在ERP系统中在线查看和下载PDF版本，支持验签功能。</p>
<h3>三、使用方式</h3>
<p>各用户须先完成实名认证，上传手持身份证照片和企业授权书（供应商）或身份证明材料（专家），经审核通过后开通电子签章权限。签章操作支持PC端和移动端，登录ERP系统后可在相应业务页面直接使用。</p>
<h3>四、注意事项</h3>
<p>电子签章是严肃的法律行为，请妥善保管登录账号和密码，因账号保管不善导致的签章行为由账号所有人承担责任。如发现账号异常，请立即联系技术支持：028-8888-9999。</p>
<p>四川水发集团采购中心 信息技术部　2026年5月25日</p>`,
        type: 'PLATFORM',
        status: 'PUBLISHED',
        summary: 'ERP系统电子签章功能正式启用通知',
        publishDate: new Date('2026-05-25'),
        viewCount: 367,
      },
    }),
    // ── 招标计划预告 ──
    prisma.announcement.create({
      data: {
        title: '2026年第三季度招标计划预告',
        content: `<h2>2026年第三季度招标计划预告</h2>
<p>各潜在投标人、供应商：</p>
<p>为便于各供应商提前做好投标准备工作，现将四川水发集团2026年第三季度（7-9月）重点招标项目计划预告如下。具体招标时间及要求以正式发布的招标公告为准。</p>
<h3>一、工程建设类</h3>
<p>1. 大桥水库引水工程C1标段施工招标（预计7月中旬，预算约8,000万元）；</p>
<p>2. 青衣江流域防洪治理工程（二期）（预计8月上旬，预算约5,500万元）；</p>
<p>3. 黑龙滩水库除险加固工程（预计9月中旬，预算约3,200万元）。</p>
<h3>二、设备物资类</h3>
<p>1. 2026年下半年水利工程管材集中采购（预计7月下旬，预算约2,800万元）；</p>
<p>2. 水文监测自动化设备采购（预计8月中旬，预算约1,200万元）；</p>
<p>3. 办公家具及实验设备采购（预计9月上旬，预算约600万元）。</p>
<h3>三、服务类</h3>
<p>1. 2026年度工程监理服务框架协议招标（预计7月上旬，预算约500万元）；</p>
<p>2. 集团信息安全等级保护测评及咨询（预计8月下旬，预算约150万元）；</p>
<p>3. 法律顾问服务选聘（预计9月下旬，预算约80万元）。</p>
<h3>四、说明事项</h3>
<p>1. 以上项目计划和时间为初步安排，实际执行中可能根据项目进展情况进行调整；</p>
<p>2. 各项目的具体招标范围、资格要求、时间安排等信息以正式发布的招标公告为准；</p>
<p>3. 供应商可通过ERP系统订阅招标信息推送服务，第一时间获取招标动态。</p>
<p>四川水发集团采购中心　2026年6月12日</p>`,
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        summary: '2026年第三季度重点招标项目计划预告',
        publishDate: new Date('2026-06-12'),
        viewCount: 421,
      },
    }),
  ]);

  console.log(`Seeded: ${announcements.length} announcements`);

  // ── Seed a demo supplier user for testing the portal ──
  const demoSupplierUser = await prisma.user.upsert({
    where: { username: 'supplier1' },
    update: {},
    create: {
      username: 'supplier1',
      displayName: '张经理',
      passwordHash: hashSync('123456', 10),
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

  // ── Seed admin notifications ──
  const adminUser = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (adminUser) {
    await prisma.notification.createMany({
      data: [
        { userId: adminUser.id, type: 'SYSTEM', title: '系统升级完成', content: 'ERP管理平台已完成v2.0升级，新增专家工作台、供应商门户等功能模块。', link: '/dashboard' },
        { userId: adminUser.id, type: 'SYSTEM', title: '新供应商注册待审核', content: '供应商"成都华西物资供应有限公司"提交了入库申请，请及时审核。', link: '/supplier' },
        { userId: adminUser.id, type: 'SYSTEM', title: '评标进度提醒', content: '项目"2026年度水利工程物资集中采购"已有3位专家提交评分，当前进度85%。', link: '/bid' },
        { userId: adminUser.id, type: 'SYSTEM', title: '供应商资质到期预警', content: '有2家供应商的资质证书将在30天内到期，请通知相关供应商及时更新。', link: '/supplier' },
      ],
      skipDuplicates: true,
    });
  }

  // ── Seed pending supplier for admin to review ──
  const pendingSupplierUser = await prisma.user.upsert({
    where: { username: 'supplier2' },
    update: {},
    create: {
      username: 'supplier2',
      displayName: '赵总',
      passwordHash: hashSync('123456', 10),
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

  console.log('Seeded: admin notifications, expert users (liuxm, chenzq), pending supplier (supplier2 / 123456)');
  console.log('\n  Available accounts:');
  console.log('    admin / admin123       — 管理员');
  console.log('    lizhuren / 123456      — 开标主持人');
  console.log('    wangjg / 123456        — 专家·王建国');
  console.log('    liuxm / 123456         — 专家·刘晓梅');
  console.log('    chenzq / 123456        — 专家·陈志强');
  console.log('    supplier1 / 123456     — 供应商(已入库)');
  console.log('    supplier2 / 123456     — 供应商(待审核)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
