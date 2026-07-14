'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CategoryNode } from '@/lib/category-tree-utils';

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
      const res = await fetch('/api/catalog/categories/tree', { credentials: 'include' });
      if (!res.ok) throw new Error('加载品类树失败');
      const data = await res.json();
      cachedTree = data;
      setTree(data);
    } catch (err: any) {
      setError(err.message || '加载品类树失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedTree) { setTree(cachedTree); setLoading(false); return; }
    if (fetchPromise) {
      fetchPromise.then(data => { setTree(data); setLoading(false); });
      return;
    }
    fetchPromise = fetch('/api/catalog/categories/tree', { credentials: 'include' })
      .then(res => { if (!res.ok) throw new Error('加载品类树失败'); return res.json(); })
      .then(data => { cachedTree = data; setTree(data); setLoading(false); return data; })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  return { tree, loading, error, refresh };
}
