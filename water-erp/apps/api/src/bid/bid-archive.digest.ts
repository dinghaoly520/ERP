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

/** 稳定排序：归档项按 id 升序，确保输入顺序不影响哈希。 */
function sortByItemId(items: ArchiveItemLike[]): ArchiveItemLike[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 创世哈希：基于项目元数据，作为链首的前驱。 */
function genesisHash(project: ArchiveProject): string {
  const genesisPayload = JSON.stringify({
    projectId: project.id,
    projectCode: project.projectCode,
    projectName: project.name,
    stage: project.stage,
  });
  return crypto.createHash('sha256').update(genesisPayload, 'utf8').digest('hex');
}

/**
 * 计算归档内容的 SHA-256 哈希链（向后兼容：单一摘要）。
 * 归档项按 id 排序后取 [id,name,ownerRole,status]，拼接项目元数据，再整体 SHA-256。
 * 同输入恒等、防篡改。
 *
 * @deprecated 新代码应使用 {@link computeArchiveChain} 获取逐项链式哈希。
 */
export function computeArchiveDigest(project: ArchiveProject, items: ArchiveItemLike[]): string {
  const normalizedItems = sortByItemId(items).map(i => [i.id, i.name, i.ownerRole, i.status]);
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

/**
 * 计算逐项 SHA-256 哈希链：每个 item 的哈希 = SHA-256(prevHash + itemContent)。
 * prevHash 初始为项目元数据的创世哈希，逐项传递。
 *
 * 链式防篡改：篡改任一项会改变该项及所有后续项的哈希，可被独立验证每一环。
 * 输入顺序不影响结果（按 id 稳定排序）。
 *
 * @returns Map<itemId, `sha256:${hex}`>
 */
export function computeArchiveChain(project: ArchiveProject, items: ArchiveItemLike[]): Map<string, string> {
  const sorted = sortByItemId(items);
  const result = new Map<string, string>();
  let prevHash = genesisHash(project);

  for (const item of sorted) {
    const itemPayload = JSON.stringify({
      prevHash,
      id: item.id,
      name: item.name,
      ownerRole: item.ownerRole,
      status: item.status,
    });
    const h = crypto.createHash('sha256').update(itemPayload, 'utf8').digest('hex');
    result.set(item.id, `sha256:${h}`);
    prevHash = h; // 链：本项哈希成为下一项的前驱
  }
  return result;
}

/**
 * 项目根哈希 = 链中最后一个 item 的哈希（整条链的摘要指纹）。
 * 若无 item，返回创世哈希。用于状态头/导出包的"档案指纹"展示。
 */
export function computeArchiveRootDigest(project: ArchiveProject, items: ArchiveItemLike[]): string {
  const sorted = sortByItemId(items);
  if (sorted.length === 0) return `sha256:${genesisHash(project)}`;
  const chain = computeArchiveChain(project, items);
  return chain.get(sorted[sorted.length - 1].id)!;
}
