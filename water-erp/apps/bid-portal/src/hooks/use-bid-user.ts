'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface BidPortalUser {
  id: string;
  username: string;
  displayName?: string | null;
  role?: string | null;
}

// 模块级缓存：app-shell 与评标视图等共享一次 /auth/me 请求
let cached: BidPortalUser | null = null;
let inFlight: Promise<BidPortalUser | null> | null = null;

function loadMe(): Promise<BidPortalUser | null> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = api
    .get<BidPortalUser>('/auth/me')
    .then((u) => { cached = u; return u; })
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** 当前登录用户（含 role）——用于 leader/admin 审批类按钮的显隐（如「评标延期审批」）。 */
export function useBidUser(): BidPortalUser | null {
  const [user, setUser] = useState<BidPortalUser | null>(cached);
  useEffect(() => { void loadMe().then(setUser); }, []);
  return user;
}
