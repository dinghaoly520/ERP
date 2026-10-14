/* =================================================================
   /bids/[id]/submit — 投标提交页（dual-v3 · SCCA 真盾）
   旧 legacy 表单（完整标书/拆分文件 + clientDeks）已整体移除（2026-10-14
   代解密清除）——本页承载 SCCA CA 投递卡（双层信封+P7 签名）。
   门控：DOWNLOAD/SUBMIT 且未递交；否则提示并返回详情页。
   ================================================================= */
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { bidApi } from '@/lib/api/bid';
import { supplierApi } from '@/lib/api/supplier';
import { CaBidSubmitSection } from '@/components/ca-bid-submit-section';

export default function BidSubmitPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;
  const [stageOk, setStageOk] = useState<boolean | null>(null);
  const [submission, setSubmission] = useState<any>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, sub] = await Promise.all([
        bidApi.getProject(projectId),
        supplierApi.getBidSubmission(projectId).catch(() => null),
      ]);
      if (!['DOWNLOAD', 'SUBMIT'].includes(p.stage)) {
        setError('该项目当前不在投标阶段');
        return;
      }
      if (sub?.status === 'submitted') {
        setError('该项目已递交标书');
        return;
      }
      setSubmission(sub);
      setStageOk(true);
    } catch (e: any) {
      setError(e?.message ?? '项目加载失败');
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link href={`/bids/${projectId}`} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
          <ArrowLeft size={14} strokeWidth={1.75} /> 返回项目详情
        </Link>
      </div>

      <div className="neu-card mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} strokeWidth={1.75} />
          <span className="font-medium">投标提交</span>
        </div>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          本项目按 SCCA CA 双层信封（dual-v3）投递：标书文件由平台与贵司 U盾双层加密，
          信封由盾 P7 签名——平台开标前无法读取内容。
        </p>
      </div>

      {error && (
        <div className="neu-card" data-testid="submit-error">
          <p className="text-sm" style={{ color: 'var(--danger, #c0392b)' }}>{error}</p>
          <Link href={`/bids/${projectId}`} className="neu-btn-soft mt-3 inline-flex items-center gap-1.5">
            返回项目详情
          </Link>
        </div>
      )}

      {stageOk === true && (
        <CaBidSubmitSection
          projectId={projectId}
          submissionId={submission?.id ?? ''}
          revision={(submission as any)?.revision ?? 0}
          onSubmitted={() => {
            toast.success('投标文件已递交（dual-v3 双信封 + 盾 P7 签名）');
            router.push(`/bids/${projectId}`);
          }}
        />
      )}

      {stageOk === null && !error && (
        <div className="neu-card"><p className="text-sm text-[var(--muted-foreground)]">正在加载项目…</p></div>
      )}
    </div>
  );
}
