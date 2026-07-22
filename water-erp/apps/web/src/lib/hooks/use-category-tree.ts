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
      const list = data ?? [];
      cachedTree = list;
      setTree(list);
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
      fetchPromise
        .then(data => { setTree(data ?? []); setLoading(false); })
        .catch(() => setLoading(false));
      return;
    }
    fetchPromise = getCategoryTree()
      .then(data => { const list = data ?? []; cachedTree = list; setTree(list); setLoading(false); return list; })
      .catch(err => {
        // 关键：失败必须重置 fetchPromise 并继续 reject。否则该 Promise 会永远 resolve 为
        // undefined，后续挂载者 setTree(undefined) → 扁平化 walk(undefined) 直接白屏；
        // 重置后新挂载者会重新发起请求（自动重试）
        fetchPromise = null;
        setError(err?.message || '加载品类树失败');
        setLoading(false);
        throw err;
      });
  }, []);

  return { tree, loading, error, refresh };
}
