/**
 * 存量掩码污染检测（2026-10-15，只读）：
 * 账号管理编辑表单曾把出口掩码（173****0762 / a***@x.com）原样提交并被 sealPii 密封入库，
 * 导致本人 /auth/me 拆封回显掩码串、个人中心资料修改被「手机号码格式不正确」卡死。
 * 写入侧已于 account-admin.controller 修复（含 * 剔除）；本脚本列出**仍受污染**的存量记录，
 * 供运维在部署环境排查后决定修复方式（清空 phone 或由管理员重录真实号码）。
 *
 * 运行：cd apps/api && npx tsx scripts/detect-masked-user-pii.ts
 */
import { PrismaClient } from '@prisma/client';
import { openPiiForMask, isSealedFieldSm } from '../src/common/crypto/sm-field-crypto';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { OR: [{ phone: { not: null } }, { email: { not: null } }] },
    select: { id: true, username: true, displayName: true, role: true, phone: true, email: true },
  });

  const polluted: { username: string; displayName: string; role: string; phone?: string; email?: string }[] = [];
  let checked = 0;
  for (const u of users) {
    const row: typeof polluted[number] = { username: u.username, displayName: u.displayName ?? '', role: u.role };
    let hit = false;
    for (const [field, stored] of [['phone', u.phone], ['email', u.email]] as const) {
      if (!stored) continue;
      checked++;
      let plain: string | null;
      try {
        // 掩码串也被密封过（isSealedFieldSm=true），需先拆封再看内容；
        // 未密封的存量明文直通（openPiiForMask 宽容语义）
        plain = openPiiForMask(stored);
      } catch {
        row[field as 'phone' | 'email'] = '<拆封失败：密钥不匹配或格式损坏>';
        hit = true;
        continue;
      }
      if (plain && plain.includes('*')) {
        row[field as 'phone' | 'email'] = plain;
        hit = true;
      }
    }
    if (hit) polluted.push(row);
  }

  console.log(`检查 ${checked} 个非空 phone/email 字段（${users.length} 个账号）\n`);
  if (polluted.length === 0) {
    console.log('✓ 无掩码污染记录');
    return;
  }
  console.log(`✗ 发现 ${polluted.length} 条污染记录（拆封后含 * = 掩码串被当明文密封入库）：\n`);
  for (const r of polluted) {
    console.log(`  ${r.username}（${r.displayName || '-'} · ${r.role}）` +
      `${r.phone ? ` phone=${r.phone}` : ''}${r.email ? ` email=${r.email}` : ''}`);
  }
  console.log('\n修复建议：管理员在账号管理编辑中输入完整真实号码（新代码不会再把掩码密封入库），');
  console.log('或先清空再由本人通过个人中心资料修改申请补录。');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
