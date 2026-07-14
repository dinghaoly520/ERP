'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CategoryNode } from '@/lib/category-tree-utils';
import { getCategoryTree } from '@/lib/api/catalog-admin';

let cachedTree: CategoryNode[] | null = null;
let fetchPromise: Promise<CategoryNode[]> | null = null;

export function useCategoryTree() {
  const [tree, setTree] = useState<CategoryNode[]>(cachedTree ?? []);
  const [loading, setLoading] = useState(!cachedTree);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      fetchPromise = null;
      cachedTree = null;
      const data = await getCategoryTree();
      cachedTree = data;
      setTree(data);
    } catch (err: any) {
      setError(err.message || '加载品类树失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedTree) {
      setTree(cachedTree);
      setLoading(false);
      return;
    }
    if (fetchPromise) {
      fetchPromise.then(data => { setTree(data); setLoading(false); }).catch(() => setLoading(false));
      return;
    }
    fetchPromise = getCategoryTree()
      .then(data => { cachedTree = data; setTree(data); setLoading(false); return data; })
      .catch(err => { setError(err.message || '加载品类树失败'); setLoading(false); });
  }, []);

  return { tree, loading, error, refresh };
}
