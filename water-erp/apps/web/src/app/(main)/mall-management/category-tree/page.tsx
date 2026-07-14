'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { GitBranch } from 'lucide-react';
import { useCategoryTree } from '@/lib/hooks/use-category-tree';
import { findNode, type CategoryNode } from '@/lib/category-tree-utils';
import { CategoryTree } from '@/components/catalog/CategoryTree';
import { CategoryFormDialog } from '@/components/catalog/CategoryFormDialog';
import { AttributeTemplateEditor } from '@/components/catalog/AttributeTemplateEditor';
import {
  createCategory, updateCategory, deleteCategory, toggleCategoryStatus,
  createAttributeTemplate, deleteAttributeTemplate,
} from '@/lib/api/catalog-admin';

interface CategoryFormData { name: string; code: string; isLeaf: boolean; icon: string; }

export default function CategoryTreePage() {
  const { tree, loading, error, refresh } = useCategoryTree();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedNode = selectedId ? findNode(tree, selectedId) : null;

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create-root' | 'create-child' | 'edit'>('create-root');
  const [formParentId, setFormParentId] = useState<number | null>(null);
  const [formInitial, setFormInitial] = useState<CategoryFormData | undefined>();

  const [attrEditorOpen, setAttrEditorOpen] = useState(false);
  const [attrNode, setAttrNode] = useState<CategoryNode | null>(null);

  const handleAddRoot = () => { setFormMode('create-root'); setFormParentId(null); setFormInitial(undefined); setFormOpen(true); };
  const handleAddChild = (parent: CategoryNode) => { setFormMode('create-child'); setFormParentId(parent.id); setFormInitial(undefined); setFormOpen(true); };
  const handleEdit = (node: CategoryNode) => { setFormMode('edit'); setFormParentId(node.id); setFormInitial({ name: node.name, code: node.code || '', isLeaf: node.isLeaf, icon: node.icon || '' }); setFormOpen(true); };
  const handleConfigureAttrs = (node: CategoryNode) => { setAttrNode(node); setAttrEditorOpen(true); };

  const handleDelete = async (node: CategoryNode) => {
    if (!window.confirm(`确认删除「${node.name}」？${node.children?.length ? '\n注意：该节点下有子节点，无法直接删除。' : ''}`)) return;
    try { await deleteCategory(node.id); toast.success('已删除'); refresh(); } catch (e: any) { toast.error(e.message); }
  };

  const handleToggleStatus = async (node: CategoryNode) => {
    try { await toggleCategoryStatus(node.id); toast.success(node.status === 'ACTIVE' ? '已停用' : '已启用'); refresh(); }
    catch (e: any) { toast.error(e.message); }
  };

  const handleFormSave = async (data: CategoryFormData) => {
    if (formMode === 'edit' && formParentId) {
      await updateCategory(formParentId, data);
    } else {
      await createCategory({ ...data, parentId: formParentId });
    }
    toast.success(formMode === 'edit' ? '已更新' : '已创建');
    refresh();
  };

  const currentTemplates = attrNode?.attributeTemplates ?? [];
  const currentTemplatesFromTree = selectedNode?.attributeTemplates ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><GitBranch size={17} /></div>
            <div>
              <div className="page-hero__title">品类树管理</div>
              <div className="page-hero__sub">维护采购目录的层级分类体系，为叶子品类配置属性模板</div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        <div className="h-[calc(100vh-240px)]">
          <CategoryTree
            tree={tree} loading={loading} error={error} onRefresh={refresh}
            selectedId={selectedId} onSelect={(node) => { setSelectedId(node.id); }}
            onEdit={handleEdit} onDelete={handleDelete} onToggleStatus={handleToggleStatus}
            onAddRoot={handleAddRoot} onAddChild={handleAddChild} onConfigureAttrs={handleConfigureAttrs}
          />
        </div>
        <div className="neu-card rounded-2xl p-5 h-[calc(100vh-240px)] overflow-y-auto">
          {selectedNode ? (
            <div className="flex flex-col gap-4">
              <h3 className="text-lg font-bold text-[var(--foreground)]">{selectedNode.name}</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-[var(--muted-foreground)]">编码</span><p className="font-medium font-mono">{selectedNode.code || '—'}</p></div>
                <div><span className="text-[var(--muted-foreground)]">状态</span><p className={`font-medium ${selectedNode.status === 'ACTIVE' ? 'text-green-600' : 'text-gray-400'}`}>{selectedNode.status === 'ACTIVE' ? '启用' : '停用'}</p></div>
                <div><span className="text-[var(--muted-foreground)]">节点类型</span><p className="font-medium">{selectedNode.isLeaf ? '🍃 叶子节点' : '📁 分组节点'}</p></div>
                <div><span className="text-[var(--muted-foreground)]">排序</span><p className="font-medium tabular-nums">{selectedNode.sortOrder}</p></div>
              </div>
              {selectedNode.isLeaf && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-[var(--foreground)]">属性模板</span>
                    <button onClick={() => handleConfigureAttrs(selectedNode)} className="neu-btn-xs is-info">编辑模板</button>
                  </div>
                  {currentTemplatesFromTree.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {currentTemplatesFromTree.map((t: any) => (
                        <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[rgba(96,139,239,0.05)] text-sm">
                          <span className="font-medium">{t.name}</span>
                          <code className="text-[10px] font-mono text-[var(--accent)]">{t.fieldKey}</code>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(96,139,239,0.1)] text-[var(--accent)]">{t.fieldType}</span>
                          {t.required && <span className="text-[10px] text-red-400">必填</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--muted-foreground)]">该品类暂无自定义属性</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-[var(--muted-foreground)]">👈 选择左侧品类节点查看详情</div>
          )}
        </div>
      </div>
      <CategoryFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSave={handleFormSave}
        initial={formInitial} title={formMode === 'edit' ? '编辑品类节点' : formMode === 'create-child' ? '新增子节点' : '新增根节点'} />
      <AttributeTemplateEditor open={attrEditorOpen} onClose={() => { setAttrEditorOpen(false); refresh(); }}
        categoryName={attrNode?.name} templates={currentTemplatesFromTree.length > 0 ? currentTemplatesFromTree : (attrNode ? currentTemplates : [])}
        onSave={async (data) => { await createAttributeTemplate(attrNode!.id, data); refresh(); }}
        onDelete={async (id) => { await deleteAttributeTemplate(id); refresh(); }} />
    </div>
  );
}
