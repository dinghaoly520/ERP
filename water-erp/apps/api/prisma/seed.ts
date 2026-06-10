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
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
