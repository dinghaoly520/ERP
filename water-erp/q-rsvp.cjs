const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rsvps = await p.invitationRsvp.findMany({
    select: { projectId: true, supplierName: true, status: true },
    take: 50,
  });
  console.log('rsvp 总数:', rsvps.length);
  const byProject = {};
  for (const r of rsvps) {
    if (!r.projectId) continue;
    byProject[r.projectId] = byProject[r.projectId] || { total: 0, accepted: 0, names: [] };
    byProject[r.projectId].total++;
    if (r.status === 'ACCEPTED') byProject[r.projectId].accepted++;
    if (byProject[r.projectId].names.length < 3) byProject[r.projectId].names.push(r.supplierName);
  }
  // 查这些 projectId 对应的 PMI 状态
  const ids = Object.keys(byProject);
  const pmis = await p.projectManagementItem.findMany({
    where: { OR: [{ id: { in: ids } }, { bidProjects: { some: { id: { in: ids } } } }] },
    select: { id: true, title: true, status: true },
  });
  for (const m of pmis) {
    const stat = byProject[m.id] || Object.entries(byProject).find(([pid]) => pmis.some(x => x.id === m.id && false))?.[1];
    console.log('PMI:', m.title, '|', m.status, '| 自身rsvp:', byProject[m.id]?.total ?? 0);
  }
  console.log('含rsvp的projectId样例:', JSON.stringify(Object.entries(byProject).slice(0, 5).map(([k, v]) => ({ pid: k.slice(0, 10), ...v }))));
  await p.$disconnect();
})();
