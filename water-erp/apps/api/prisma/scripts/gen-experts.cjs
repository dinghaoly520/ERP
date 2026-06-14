/**
 * 生成评审专家快照（13 个专业方向 × 5 人 = 65 名），追加到
 *   prisma/seed-data/User.json         （bid_expert 用户，bcrypt 口令哈希）
 *   prisma/seed-data/ExpertProfile.json（专家档案）
 *
 * 幂等：以 username 前缀 `exp` 识别本脚本产出的记录，重跑前先剔除旧记录再追加。
 *
 * 运行： node prisma/scripts/gen-experts.cjs
 * 之后： pnpm db:seed  （TRUNCATE + JSON 重载，自动包含新专家）
 */
const fs = require('fs');
const path = require('path');
const { hashSync } = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'seed-data');
const DEPT_ID = 'cmqbysd9v0000koh13qyqfv3u'; // 采购中心（与现有 demo 专家一致）
const NOW = '2026-06-13T06:20:00.000Z';

// 13 个专业方向：每个方向 5 个姓名 + 职称 + 资格/专长描述
const DIRECTIONS = [
  { specialty: '职工代表', title: '高级政工师', names: ['周明华', '罗春燕', '邓启明', '唐玉兰', '蒋海峰'] },
  { specialty: '设备', title: '高级工程师', names: ['何志强', '高瑞林', '田晓峰', '彭雪梅', '秦立军'] },
  { specialty: '造价', title: '高级工程师', names: ['宋雅琴', '曾建平', '马丽娟', '郭维东', '袁小蓉'] },
  { specialty: '财资', title: '高级会计师', names: ['熊志远', '廖红梅', '白建国', '范婷婷', '雷旭东'] },
  { specialty: '测绘', title: '高级工程师', names: ['韩子昂', '邹敏', '魏长龙', '冯丽娜', '叶青松'] },
  { specialty: '工程设计院', title: '正高级工程师', names: ['沈国梁', '余慧敏', '曹远航', '夏雨薇', '任泽民'] },
  { specialty: '施工/EPC', title: '高级工程师', names: ['杜成林', '谢文博', '钟敏华', '贺建军', '梁思远'] },
  { specialty: '地质', title: '高级工程师', names: ['潘德辉', '崔若兰', '苏建明', '孔令川', '赖雨辰'] },
  { specialty: '人力资源', title: '高级人力资源管理师', names: ['尹秋月', '程浩然', '陆佳宁', '傅明哲', '施晓琳'] },
  { specialty: '审计法务', title: '高级审计师', names: ['谭正清', '方若曦', '孟立新', '常安琪', '石文涛'] },
  { specialty: '安全环保', title: '高级工程师', names: ['汪庆华', '龙嘉怡', '毛新宇', '郝文静', '段志鹏'] },
  { specialty: '市场营销', title: '高级经济师', names: ['邱晓东', '顾婷婷', '贾明轩', '梅雪', '戴晨阳'] },
  { specialty: '机电', title: '高级工程师', names: ['万成刚', '钱晓蕾', '丁博文', '黎海燕', '邵俊杰'] },
];

// 单位统一为「XXX水利技术服务中心」风格
const EMPLOYERS = [
  '四川水利技术服务中心',
  '成都水利技术服务中心',
  '绵阳水利技术服务中心',
  '德阳水利技术服务中心',
  '南充水利技术服务中心',
  '宜宾水利技术服务中心',
];

const USERNAME_PREFIX = 'exp'; // 本脚本产出专家用户名前缀
const read = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
const write = (f, data) => fs.writeFileSync(path.join(dataDir, f), JSON.stringify(data, null, 2) + '\n', 'utf-8');

/** 姓名某化：保留姓 + 某 + 末字。如 周明华→周某华，邹敏→邹某。幂等。 */
function anonymize(name) {
  if (!name) return name;
  if (name.length >= 3) return name[0] + '某' + name[name.length - 1];
  return name[0] + '某';
}

function gen() {
  const users = read('User.json');
  const profiles = read('ExpertProfile.json');

  // 幂等：剔除本脚本之前产出的记录
  const cleanUsers = users.filter((u) => !(u.username && u.username.startsWith(USERNAME_PREFIX)));
  const cleanProfileUserIds = new Set(users.filter((u) => u.username && u.username.startsWith(USERNAME_PREFIX)).map((u) => u.id));
  const cleanProfiles = profiles.filter((p) => !cleanProfileUserIds.has(p.userId));

  const existingUsernames = new Set(cleanUsers.map((u) => u.username));
  let uid = 1;
  const newUsers = [];
  const newProfiles = [];

  DIRECTIONS.forEach((dir, di) => {
    const dirNo = String(di + 1).padStart(2, '0');
    dir.names.forEach((name, ni) => {
      const personNo = String(ni + 1).padStart(2, '0');
      const username = `${USERNAME_PREFIX}${dirNo}${personNo}`; // 如 exp0101
      if (existingUsernames.has(username)) return;

      const userId = `seedexpu${String(uid).padStart(4, '0')}`;
      const profileId = `seedexpp${String(uid).padStart(4, '0')}`;
      uid += 1;

      // 让抽取状态更真实：约 15% 占用、5% 停用、其余可用
      const roll = (di * 5 + ni) % 20;
      const availability = roll === 0 ? '停用' : roll <= 3 ? '占用' : '可用';

      newUsers.push({
        id: userId,
        username,
        displayName: anonymize(name),
        email: `${username}@expert.water-erp.local`,
        passwordHash: hashSync(`${username}@2026`, 10),
        role: 'bid_expert',
        isActive: true,
        departmentId: DEPT_ID,
        createdAt: NOW,
        updatedAt: NOW,
      });

      newProfiles.push({
        id: profileId,
        userId,
        specialty: dir.specialty,
        title: dir.title,
        employer: EMPLOYERS[(di + ni) % EMPLOYERS.length],
        phone: `138${String(26000000 + di * 1000 + ni * 37).padStart(8, '0')}`,
        idNumber: `5101${String(1972 + ((di + ni) % 18))}${String(10000000 + di * 100000 + ni * 1234).slice(-8)}`,
        availability,
        notes: `${dir.specialty}方向评审专家，擅长${dir.title === '高级政工师' ? '职工权益与民主评议' : dir.specialty + '领域评审'}。`,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
  });

  // 统一并处理原有 demo 专家（非 exp* 的 bid_expert）：姓名某化 + 单位改为「XXX水利技术服务中心」
  const profileByUser = new Map(cleanProfiles.map((p) => [p.userId, p]));
  let origIdx = 0;
  for (const u of cleanUsers) {
    if (u.role !== 'bid_expert') continue;
    if (u.username && u.username.startsWith(USERNAME_PREFIX)) continue; // 本脚本产出的已在上方处理
    u.displayName = anonymize(u.displayName);
    const prof = profileByUser.get(u.id);
    if (prof) {
      if (!prof.employer || !prof.employer.endsWith('水利技术服务中心')) {
        prof.employer = EMPLOYERS[origIdx % EMPLOYERS.length];
      }
      origIdx += 1;
    }
  }

  write('User.json', [...cleanUsers, ...newUsers]);
  write('ExpertProfile.json', [...cleanProfiles, ...newProfiles]);

  console.log(`✔ 新增专家用户 ${newUsers.length} 个（前缀 ${USERNAME_PREFIX}*）`);
  console.log(`✔ 新增专家档案 ${newProfiles.length} 条`);
  console.log(`  User.json 总计 ${cleanUsers.length + newUsers.length} 行`);
  console.log(`  ExpertProfile.json 总计 ${cleanProfiles.length + newProfiles.length} 行`);
  console.log('  口令约定：<用户名>@2026，例如 exp0101@2026');
}

gen();
