"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supplierApi } from "@/lib/api/supplier";

/**
 * 供应商状态上下文 — 移植自 Vue supplier store 的 status 部分。
 * 外壳用它显示公司全称 + 菜单按 isTemporary 分支（X-1 权限集中点）。
 */
interface SupplierStatusContextValue {
  status: any | null;
  statusError: boolean;
  fetchStatus: () => Promise<void>;
}

const SupplierStatusContext = createContext<SupplierStatusContextValue | null>(null);

export async function loadSupplierStatus<T>(
  request: () => Promise<T>,
  onStatus: (status: T | null) => void,
  onErrorChange: (hasError: boolean) => void,
): Promise<void> {
  try {
    onStatus(await request());
    onErrorChange(false);
  } catch (error) {
    onStatus(null);
    onErrorChange(true);
    throw error;
  }
}

export function SupplierStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<any | null>(null);
  const [statusError, setStatusError] = useState(false);

  const fetchStatus = useCallback(
    () => loadSupplierStatus(supplierApi.getStatus, setStatus, setStatusError),
    [],
  );

  useEffect(() => {
    void fetchStatus().catch(() => {});
  }, [fetchStatus]);

  return (
    <SupplierStatusContext.Provider value={{ status, statusError, fetchStatus }}>
      {children}
    </SupplierStatusContext.Provider>
  );
}

export function useSupplierStatus() {
  const ctx = useContext(SupplierStatusContext);
  if (!ctx) throw new Error("useSupplierStatus must be used within SupplierStatusProvider");
  return ctx;
}
