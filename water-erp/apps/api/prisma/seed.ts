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

  await prisma.user.upsert({
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
          { expertName: '王建国', major: '水利工程', signedIn: true, avoidanceConfirmed: true, progress: 92, totalScore: 91.6 },
          { expertName: '刘晓梅', major: '机电设备', signedIn: true, avoidanceConfirmed: true, progress: 86, totalScore: 89.4 },
          { expertName: '陈志强', major: '造价咨询', signedIn: true, avoidanceConfirmed: true, progress: 78, totalScore: 88.1 },
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

  // Seed announcements
  const announcements = await Promise.all([
    prisma.announcement.create({
      data: {
        title: '2026年度水利工程物资集中采购招标公告',
        content: `<h2>招标公告</h2>
<p>根据《中华人民共和国政府采购法》等有关规定，四川水发集团就2026年度水利工程物资集中采购项目进行公开招标，欢迎符合条件的供应商参加投标。</p>
<h3>一、项目概况</h3>
<p>项目名称：2026年度水利工程物资集中采购</p>
<p>项目编号：BID-2026-0518</p>
<p>采购方式：公开招标</p>
<h3>二、投标人资格要求</h3>
<p>1. 具有独立法人资格，持有有效的营业执照；</p>
<p>2. 具有良好的商业信誉和健全的财务会计制度；</p>
<p>3. 具有履行合同所必需的设备和专业技术能力；</p>
<p>4. 参加政府采购活动前三年内，在经营活动中没有重大违法记录。</p>
<h3>三、报名时间及方式</h3>
<p>报名时间：2026年5月20日至2026年6月5日</p>
<p>报名方式：通过四川水发集团ERP供应商门户在线报名</p>`,
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
        content: `<h2>招标公告</h2><p>四川水发集团就智慧水务信息化系统建设项目进行公开招标。</p><p>项目编号：BID-2026-0522</p><p>采购方式：综合评分法</p>`,
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
        title: '升钟水库灌区续建配套工程中标公示',
        content: `<h2>中标公示</h2><p>项目编号：BID-2026-0526</p><p>经评标委员会评审，推荐中标候选人如下：</p><p>第一中标候选人：四川川水建设工程有限公司，投标报价：3260.00万元</p>`,
        type: 'WIN_NOTICE',
        status: 'PUBLISHED',
        summary: '升钟水库灌区续建配套工程中标候选人公示',
        publishDate: new Date('2026-06-05'),
        viewCount: 342,
      },
    }),
    prisma.announcement.create({
      data: {
        title: '关于规范供应商注册及资质管理工作的通知',
        content: `<h2>通知</h2><p>各供应商：</p><p>为进一步规范供应商注册及资质管理工作，现就有关事项通知如下：</p><p>一、所有新注册供应商须在注册时上传完整的企业资质材料。</p><p>二、已入库供应商的资质材料即将到期的，请提前30天更新。</p><p>三、信息变更须通过供应商门户提交变更申请，经审核通过后生效。</p>`,
        type: 'POLICY',
        status: 'PUBLISHED',
        summary: '规范供应商注册及资质管理的政策通知',
        publishDate: new Date('2026-05-15'),
        viewCount: 512,
      },
    }),
    prisma.announcement.create({
      data: {
        title: 'ERP供应商门户系统升级公告',
        content: `<p>供应商门户已完成系统升级，新增以下功能：</p><p>1. 在线标书提交功能</p><p>2. 实时消息通知</p><p>3. 评价记录查看</p><p>4. 信息变更在线申请</p>`,
        type: 'PLATFORM',
        status: 'PUBLISHED',
        summary: '供应商门户系统功能升级通知',
        publishDate: new Date('2026-06-01'),
        viewCount: 128,
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

  // ── Seed extra expert users (刘晓梅、陈志强) so expert workstation has matching users ──
  await prisma.user.upsert({
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

  await prisma.user.upsert({
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
