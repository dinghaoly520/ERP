const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // 找目标：PUBLIC_ANNOUNCEMENT + DOWNLOAD + 已发布公告
  const target = await p.projectManagementItem.findFirst({
    where: { status: 'ACTIVE', currentStage: 'PUBLIC_ANNOUNCEMENT', bidProjects: { some: { stage: 'DOWNLOAD' } } },
    select: { id: true, title: true, bidProjects: { select: { id: true, stage: true, projectCode: true } } },
  });
  if (!target) { console.log('无候选'); process.exit(0); }
  const bp = target.bidProjects[0];
  console.log('目标:', target.title, '| bp:', bp.id.slice(-6), bp.stage);

  // 造一条 TODO 工作安排
  const user = await p.user.findFirst({ where: { role: 'admin' }, select: { id: true } });
  const wa = await p.workArrangement.create({ data: { userId: user.id, title: '终止联动测试安排', type: 'PROJECT', projectManagementItemId: target.id } });
  const ann = await p.announcement.findFirst({ where: { relatedProjectCode: bp.projectCode, status: 'PUBLISHED' }, select: { id: true, status: true } });
  console.log('前置: wa=', wa.status, '| 公告=', ann?.status);

  // 触发终止（直接调 service 不方便——用 HTTP）
  console.log('TERMINATE_VIA_HTTP');
  await p.$disconnect();
  globalThis.__target = { projectId: target.id, waId: wa.id, bpId: bp.id, annId: ann?.id };
})();
