export interface CategoryNode {
  id: number;
  name: string;
  code: string | null;
  parentId: number | null;
  sortOrder: number;
  status: string;
  isLeaf: boolean;
  icon: string | null;
  /** B2（4.1.1.3）：目录分级 */
  centralizedLevel?: string | null;
  centralizedThreshold?: number | null;
  children: CategoryNode[];
  attributeTemplates?: AttributeTemplate[];
}

export interface AttributeTemplate {
  id: number;
  categoryId: number;
  name: string;
  fieldKey: string;
  fieldType: string;
  required: boolean;
  options: string[] | null;
  unit: string | null;
  sortOrder: number;
}

export function flattenTree(tree: CategoryNode[]): CategoryNode[] {
  const result: CategoryNode[] = [];
  const walk = (nodes: CategoryNode[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  return result;
}

export function findNode(tree: CategoryNode[], id: number): CategoryNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function getNodePath(tree: CategoryNode[], id: number): CategoryNode[] {
  const path: CategoryNode[] = [];
  const walk = (nodes: CategoryNode[], trail: CategoryNode[]): boolean => {
    for (const node of nodes) {
      const newTrail = [...trail, node];
      if (node.id === id) { path.push(...newTrail); return true; }
      if (node.children?.length && walk(node.children, newTrail)) return true;
    }
    return false;
  };
  walk(tree, []);
  return path;
}

export function getLeafNodes(tree: CategoryNode[]): CategoryNode[] {
  return flattenTree(tree).filter(n => n.isLeaf);
}
