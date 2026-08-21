"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supplierApi } from "@/lib/api/supplier";

/**
 * 供应商状态上下文 — 移植自 Vue supplier store 的 status 部分。
 * 外壳用它显示公司全称 + 菜单按 isTemporary 分支（X-1 权限集中点）。
 */
interface SupplierStatusContextValue {
  status: any | null;
  fetchStatus: () => Promise<void>;
}

const SupplierStatusContext = createContext<SupplierStatusContextValue | null>(null);

export function SupplierStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<any | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await supplierApi.getStatus());
    } catch { /* 静默：状态失败不阻塞外壳 */ }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <SupplierStatusContext.Provider value={{ status, fetchStatus }}>
      {children}
    </SupplierStatusContext.Provider>
  );
}

export function useSupplierStatus() {
  const ctx = useContext(SupplierStatusContext);
  if (!ctx) throw new Error("useSupplierStatus must be used within SupplierStatusProvider");
  return ctx;
}
