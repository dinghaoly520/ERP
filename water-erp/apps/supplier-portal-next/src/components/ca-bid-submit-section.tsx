/* =================================================================
   ca-bid-submit-section — dual-v3 投递卡数据装配 + 能力门控（I5 评审修复）
   装配：capabilities（v3 开关+绑定）+ getMyStatus（supplierId）+ getAdminCert（kadmin）
   门控：allowedEnvelopeVersions 含 dual-v3 且 ACTIVE SCCA 绑定在位才渲染卡片
   ================================================================= */
'use client';
import { useEffect, useState } from 'react';
import { supplierApi } from '@/lib/api/supplier';
import { CaBidSubmitCard } from './ca-bid-submit-card';

interface SectionInfo {
  context: { supplierId: string; submissionId: string; revision: number; signingBindingId: string; signingCertFingerprint: string };
  adminCert: { adminCertId: string; publicKey: string };
}

export function CaBidSubmitSection({ projectId, submissionId, revision, onSubmitted }: {
  projectId: string;
  submissionId: string;
  revision: number;
  onSubmitted?: () => void;
}) {
  const [info, setInfo] = useState<SectionInfo | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [caps, status, adminCert] = await Promise.all([
          supplierApi.caCapabilities(),
          supplierApi.getStatus(),
          supplierApi.getAdminCert(),
        ]);
        if (!alive) return;
        const allowed = Array.isArray((caps as any)?.allowedEnvelopeVersions)
          && (caps as any).allowedEnvelopeVersions.includes('dual-v3');
        const binding = (caps as any)?.activeBinding;
        const fingerprint = binding?.signingCert?.sha256Fingerprint;
        // 门控：平台 v3 开（capabilities 投影）+ ACTIVE SCCA 绑定 + 签名证指纹在位
        if (!allowed || !binding || binding.kind !== 'ca' || typeof fingerprint !== 'string') return;
        setInfo({
          context: {
            supplierId: (status as any)?.id ?? '',
            submissionId, revision,
            signingBindingId: binding.id ?? '',
            signingCertFingerprint: fingerprint,
          },
          adminCert: { adminCertId: adminCert.adminCertId, publicKey: adminCert.publicKey },
        });
      } catch {
        /* capabilities/管理证不可得=不渲染（灰度未开或后端不可用） */
      }
    })();
    return () => { alive = false; };
  }, [projectId, submissionId, revision]);

  if (!info || !info.context.supplierId) return null;
  return (
    <CaBidSubmitCard
      projectId={projectId}
      context={info.context}
      adminCert={info.adminCert}
      onSubmitted={onSubmitted ? () => onSubmitted() : undefined}
    />
  );
}
