'use client';
import { useEffect, useState } from 'react';

export interface OverviewAlerts { expiringQualifications: number; overloadedExperts: number; }
export interface SupplierAlertQual { id: string; name: string; type: string; validTo: Date; daysLeft: number; }
export interface SupplierAlerts { expiringQualifications: SupplierAlertQual[]; }
export interface ExpertAlerts { activeProjectCount: number; overloaded: boolean; consecutiveE: boolean; }

export function useAlertsOverview() {
  const [data, setData] = useState<OverviewAlerts>({ expiringQualifications: 0, overloadedExperts: 0 });
  useEffect(() => {
    let active = true;
    fetch('/api/alerts/overview', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active && d) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return data;
}

export function useSupplierAlerts(supplierId: string | undefined) {
  const [data, setData] = useState<SupplierAlerts>({ expiringQualifications: [] });
  useEffect(() => {
    if (!supplierId) return;
    let active = true;
    fetch(`/api/alerts/supplier/${supplierId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active && d) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [supplierId]);
  return data;
}

export function useExpertAlerts(expertUserId: string | undefined) {
  const [data, setData] = useState<ExpertAlerts>({ activeProjectCount: 0, overloaded: false, consecutiveE: false });
  useEffect(() => {
    if (!expertUserId) return;
    let active = true;
    fetch(`/api/alerts/expert/${expertUserId}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active && d) setData(d); })
      .catch(() => {});
    return () => { active = false; };
  }, [expertUserId]);
  return data;
}
