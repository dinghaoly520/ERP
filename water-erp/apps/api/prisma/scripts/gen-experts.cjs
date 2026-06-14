/**
 * 生成 100 名评审专家快照（20 个专业方向 × 5 人），追加到
 *   prisma/seed-data/Department.json     （新增技术部门）
 *   prisma/seed-data/User.json           （bid_expert 用户，bcrypt 哈希）
 *   prisma/seed-data/ExpertProfile.json  （专家档案，含身份证号/性别/年龄）
 *
 * 幂等：以 username 前缀 `exp` 识别本脚本产出记录，重跑前先剔除旧记录再追加。
 *
 * 运行： node prisma/scripts/gen-experts.cjs
 *       pnpm db:seed  （TRUNCATE + JSON 重载）
 */
const fs = require('fs');
const path = require('path');
const { hashSync } = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'seed-data');
const NOW = '2026-06-13T06:20:00.000Z';
const USERNAME_PREFIX = 'exp';

// ═══ 部门（7 个，覆盖四川水发典型组织架构）═══
const DEPARTMENTS = [
  { id: 'seeddept001', name: '工程技术中心',  code: 'ENG'    },
  { id: 'seeddept002', name: '采购管理中心',  code: 'PROCM'  },
  { id: 'seeddept003', name: '财务审计中心',  code: 'FIN'    },
  { id: 'seeddept004', name: '安全质量中心',  code: 'QHSE'   },
  { id: 'seeddept005', name: '法务风控中心',  code: 'LEGAL'  },
  { id: 'seeddept006', name: '市场经营中心',  code: 'MKT'    },
  { id: 'seeddept007', name: '综合管理中心',  code: 'ADMIN'  },
];

// ═══ 20 个专业方向（每方向 5 人 = 100 名专家）═══
const DIRECTIONS = [
  { specialty: '水利工程',   title: '正高级工程师',       dept: 0, names: ['陈江河', '黄晓明', '谢永康', '邱丽华', '曾海龙'] },
  { specialty: '水文水资源', title: '高级工程师',         dept: 0, names: ['林清源', '肖玉兰', '郑文斌', '梁思雨', '许德胜'] },
  { specialty: '地质勘察',   title: '正高级工程师',       dept: 0, names: ['潘德辉', '崔若兰', '苏建明', '孔令川', '赖雨辰'] },
  { specialty: '测绘遥感',   title: '高级工程师',         dept: 0, names: ['韩子昂', '邹敏', '魏长龙', '冯丽娜', '叶青松'] },
  { specialty: '工程设计',   title: '正高级工程师',       dept: 0, names: ['沈国梁', '余慧敏', '曹远航', '夏雨薇', '任泽民'] },
  { specialty: '施工管理',   title: '高级工程师',         dept: 0, names: ['杜成林', '谢文博', '钟敏华', '贺建军', '梁思远'] },
  { specialty: '机电设备',   title: '高级工程师',         dept: 0, names: ['万成刚', '钱晓蕾', '丁博文', '黎海燕', '邵俊杰'] },
  { specialty: '信息化建设', title: '高级工程师',         dept: 4, names: ['赵志远', '陶雅琴', '侯建平', '童丽丽', '汤明辉'] },
  { specialty: '环境工程',   title: '高级工程师',         dept: 3, names: ['田茂林', '向玉珍', '谭志刚', '游丽华', '阎晓峰'] },
  { specialty: '材料检测',   title: '高级工程师',         dept: 3, names: ['陆永康', '江雪梅', '文建军', '蒲海燕', '康睿'] },
  { specialty: '工程造价',   title: '高级工程师',         dept: 1, names: ['宋雅琴', '曾建平', '马丽娟', '郭维东', '袁小蓉'] },
  { specialty: '财务审计',   title: '高级会计师',         dept: 2, names: ['熊志远', '廖红梅', '白建国', '范婷婷', '雷旭东'] },
  { specialty: '合同管理',   title: '高级经济师',         dept: 5, names: ['顾明轩', '柯雅文', '施俊杰', '宫晓阳', '费秋萍'] },
  { specialty: '招标代理',   title: '高级经济师',         dept: 1, names: ['戴晨阳', '章雪', '盛建民', '滕静', '裴文凯'] },
  { specialty: '安全评价',   title: '高级工程师',         dept: 3, names: ['汪庆华', '龙嘉怡', '毛新宇', '郝文静', '段志鹏'] },
  { specialty: '人力资源管理', title: '高级人力资源管理师', dept: 6, names: ['尹秋月', '程浩然', '陆佳宁', '傅明哲', '施晓琳'] },
  { specialty: '法务合规',   title: '高级律师',           dept: 4, names: ['谭正清', '方若曦', '孟立新', '常安琪', '石文涛'] },
  { specialty: '市场经营',   title: '高级经济师',         dept: 5, names: ['邱晓东', '顾婷婷', '贾明轩', '梅雪', '戴明远'] },
  { specialty: '职工代表',   title: '高级政工师',         dept: 6, names: ['周明华', '罗春燕', '邓启明', '唐玉兰', '蒋海峰'] },
  { specialty: '财务管理',   title: '高级经济师',         dept: 2, names: ['董建国', '段红霞', '莫志伟', '骆春梅', '祝凯'] },
];

// ═══ 工作单位（15 家，覆盖四川各地市水利系统）═══
const EMPLOYERS = [
  '四川省水利发展集团本部',
  '四川省水利科学研究院',
  '四川水发勘测设计有限公司',
  '四川水发建设有限公司',
  '成都水利技术服务中心',
  '绵阳市水利规划设计研究院',
  '德阳水利技术服务中心',
  '南充市水利电力勘察设计院',
  '宜宾市水利技术服务中心',
  '泸州市水利技术服务中心',
  '乐山市水利水电设计院',
  '达州市水利技术服务中心',
  '眉山市水利技术服务中心',
  '遂宁市水利技术服务中心',
  '广安市水利技术服务中心',
];

const read  = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
const write = (f, data) => fs.writeFileSync(path.join(dataDir, f), JSON.stringify(data, null, 2) + '\n', 'utf-8');

function gen() {
  // ═══ 1. 更新 Department.json（合并新部门，去重）═══
  let deps = [];
  try { deps = read('Department.json'); } catch { /* 文件不存在则新建 */ }
  const existName  = new Set(deps.map(d => d.name));
  const existCode  = new Set(deps.map(d => d.code));
  const addedDeps  = [];
  DEPARTMENTS.forEach(d => {
    if (!existName.has(d.name) && !existCode.has(d.code)) {
      addedDeps.push({ ...d, createdAt: NOW, updatedAt: NOW });
    }
  });
  if (addedDeps.length > 0) {
    write('Department.json', [...deps, ...addedDeps]);
  }

  // ═══ 2. 生成 User + ExpertProfile ═══
  const users    = read('User.json');
  const profiles = read('ExpertProfile.json');

  // 幂等：剔除本脚本历史产物
  const cleanUsers    = users.filter(u => !(u.username?.startsWith(USERNAME_PREFIX)));
  const oldExpUserIds = new Set(users.filter(u => u.username?.startsWith(USERNAME_PREFIX)).map(u => u.id));
  const cleanProfiles = profiles.filter(p => !oldExpUserIds.has(p.userId));

  const existUsername = new Set(cleanUsers.map(u => u.username));
  let seq = 1;
  const newUsers = [];
  const newProfiles = [];

  // 生成性别感知的身份证号
  // 18位：6位地区码 + 8位出生日期 + 3位顺序码(奇数=男,偶数=女) + 1位校验码
  const areaCodes = ['510101','510107','510681','510703','510902','511302','511502','511702','511402','511102','510304','510683','511381','510923','511623'];
  function genIdNumber(gender, year, month, day) {
    const area = areaCodes[(year * 7 + month * 3 + day) % areaCodes.length];
    const birth = `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}`;
    const seq = gender === 'male'
      ? String(101 + (year + month + day) % 799).padStart(3, '0') // 奇数
      : String(100 + (year + month + day) % 798).padStart(3, '0'); // 偶数
    const pre = area + birth + seq;
    // 校验码计算
    const weights = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
    const checkChars = ['1','0','X','9','8','7','6','5','4','3','2'];
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += Number(pre[i]) * weights[i];
    return pre + checkChars[sum % 11];
  }

  DIRECTIONS.forEach((dir, di) => {
    const specNo = String(di + 1).padStart(2, '0');
    const deptId = DEPARTMENTS[dir.dept].id;
    dir.names.forEach((name, ni) => {
      const personNo = String(ni + 1).padStart(2, '0');
      const username = `${USERNAME_PREFIX}${specNo}${personNo}`;
      if (existUsername.has(username)) return;

      const userId    = `seedexpu${String(seq).padStart(4, '0')}`;
      const profileId = `seedexpp${String(seq).padStart(4, '0')}`;
      seq += 1;

      // 性别：根据姓名字数判断（单名多为男性，含梅/雪/丽/敏/兰/燕/蕾/静/婷/怡/佳/萍/薇 → 女性）
      const femaleMarkers = ['梅','雪','丽','敏','兰','燕','蕾','静','婷','怡','佳','萍','薇','琴','娟','红','霞','玉','芬','芳','英','秀','玲','琳','瑶','珊','诗','馨','婉','芷','秋','春','月','桃','杏','云','雨','荷','莲','香','娇'];
      const isFemale = femaleMarkers.some(m => name.includes(m));
      const gender = isFemale ? 'female' : 'male';

      // 出生年份（62-92年），年龄分布 34-64
      const birthYear = 1962 + (di * 13 + ni * 7) % 31;
      const birthMonth = (5 + (di * 3 + ni * 2)) % 12 + 1;
      const birthDay = Math.min(28, 1 + (di * 7 + ni * 11) % 28);
      const age = 2026 - birthYear;
      const idNumber = genIdNumber(gender, birthYear, birthMonth, birthDay);

      // 职称多样性补充
      const titles = [dir.title, dir.title];
      if (age > 55 && !dir.title.startsWith('正高级')) titles.push('教授级高级' + dir.title.slice(2));
      if (age < 45 && dir.title.startsWith('高级') && !dir.title.includes('正')) titles.push('工程师');
      const title = titles[di % titles.length];

      // 可用性: 80% 可用, 12% 占用, 8% 停用
      const roll = (di * 5 + ni) % 25;
      const availability = roll === 0 ? '停用' : roll <= 3 ? '占用' : '可用';

      const employer = EMPLOYERS[(di * 3 + ni * 2) % EMPLOYERS.length];
      const phone = `1${[3,5,7,8,9][di % 5]}${String(280000000 + di * 137000 + ni * 7900).slice(-9)}`;

      // 特长描述
      const skillList = [
        `${dir.specialty}领域评审`,
        '招标文件技术评审',
        '供应商资质审查',
        '评分标准制定',
        '项目现场考察',
        '投标方案比选',
        '合同技术条款审核',
        '隐蔽工程验收',
      ];
      const skills = [skillList[di % skillList.length], skillList[(di + ni) % skillList.length]];

      newUsers.push({
        id: userId, username, role: 'bid_expert', isActive: true,
        displayName: name,
        email: `${username}@expert.water-erp.local`,
        passwordHash: hashSync(`${username}@2026`, 10),
        departmentId: deptId,
        createdAt: NOW, updatedAt: NOW,
      });

      newProfiles.push({
        id: profileId, userId,
        specialty: dir.specialty,
        title,
        employer,
        phone,
        idNumber,
        availability,
        notes: `${gender === 'male' ? '男' : '女'}，${age}岁，${dir.specialty}方向评审专家。擅长${skills.join('、')}。`,
        createdAt: NOW, updatedAt: NOW,
      });
    });
  });

  write('User.json', [...cleanUsers, ...newUsers]);
  write('ExpertProfile.json', [...cleanProfiles, ...newProfiles]);

  console.log(`✔ 新增部门 ${addedDeps.length} 个`);
  console.log(`✔ 新增专家用户 ${newUsers.length} 个`);
  console.log(`✔ 新增专家档案 ${newProfiles.length} 条`);
  console.log(`  性别分布：男 ${newUsers.filter((_,i) => DIRECTIONS[Math.floor(i/5)].names[i%5] && !['梅','雪','丽','敏','兰','燕','蕾','静','婷','怡','佳','萍','薇','琴','娟','红','霞','玉','芬','芳','英','秀','玲','琳','瑶','珊','诗','馨','婉','芷','秋','春','月','桃','杏','云','雨','荷','莲','香','娇'].some(m => DIRECTIONS[Math.floor(i/5)].names[i%5].includes(m))).length} 名，女 ${newUsers.length - newUsers.filter((_,i) => DIRECTIONS[Math.floor(i/5)].names[i%5] && !['梅','雪','丽','敏','兰','燕','蕾','静','婷','怡','佳','萍','薇','琴','娟','红','霞','玉','芬','芳','英','秀','玲','琳','瑶','珊','诗','馨','婉','芷','秋','春','月','桃','杏','云','雨','荷','莲','香','娇'].some(m => DIRECTIONS[Math.floor(i/5)].names[i%5].includes(m))).length} 名`);
  console.log(`  年龄区间：34-64 岁`);
  console.log(`  口令：<用户名>@2026`);
}

gen();
