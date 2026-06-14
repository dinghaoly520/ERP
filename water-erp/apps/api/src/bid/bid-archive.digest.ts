import * as crypto from 'crypto';

interface ArchiveProject {
  id: string;
  projectCode: string;
  name: string;
  stage: string;
}
interface ArchiveItemLike {
  id: string;
  name: string;
  ownerRole: string;
  status: string;
}

/**
 * 计算归档内容的 SHA-256 digest。
 * 规范化：归档项按 id 排序后取 [id,name,ownerRole,status]，
 * 拼接项目元数据，再整体 SHA-256。同输入恒等、防篡改。
 */
export function computeArchiveDigest(project: ArchiveProject, items: ArchiveItemLike[]): string {
  const normalizedItems = [...items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(i => [i.id, i.name, i.ownerRole, i.status]);

  const payload = JSON.stringify({
    projectId: project.id,
    projectCode: project.projectCode,
    projectName: project.name,
    stage: project.stage,
    items: normalizedItems,
  });

  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return `sha256:${hash}`;
}
