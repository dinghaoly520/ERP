'use client';

/**
 * 工位迁移领取页（2026-09-22 修正方案）——平板扫桌面二维码后进入。
 *
 * 三步领取：① 迁移票据（免闸4工位锁，不需要主持人解锁）② 登录密码重证
 * （个人秘密绑定——防专家互扫冒名评分，错 3 次烧票）③ 留档照重拍（检测级
 * 证据；摄像头不可用可跳过，如实留痕）。成功后 API 写 token_expert，
 * 直跳 /tablet/evaluate/:projectId。
 *
 * 公开路由：proxy.ts 放行 + 本页位于 (claim) 路由组（不经 (tablet) 布局的
 * /auth/me 鉴权门——匿名扫码者无会话会被布局 401 弹回登录，2026-09-23 严格验收实测）。
 */

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowRight, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { SigninCamera } from '@/components/signin-camera';

function ClaimFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const ticket = params.get('tk') ?? '';
  const projectId = params.get('p') ?? '';

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [expertName, setExpertName] = useState<string | undefined>(undefined);
  const [photoBusy, setPhotoBusy] = useState(false);
  // 严版（2026-09-23）：签到无留档照者迁移照必拍；摄像头不可用须主持人现场豁免（轮询解锁）
  const [photoRequired, setPhotoRequired] = useState(false);
  const [photoExempted, setPhotoExempted] = useState(false);

  if (!ticket || !projectId) {
    return (
      <div className="mx-auto max-w-md px-6 pt-16 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">迁移链接无效——请回到桌面端重新扫码</p>
      </div>
    );
  }

  // 严版（2026-09-23）：强制补拍时轮询主持人豁免状态（5s），豁免到位即解锁跳过。
  // 顶层挂载（条件 hooks 会因 claimed 翻转改变 hook 计数而崩页——2026-09-23 严格验收实测）。
  useEffect(() => {
    if (!claimed || !photoRequired || photoExempted) return;
    const t = setInterval(() => {
      api.get<{ photoRequired: boolean; exempted: boolean }>(`/expert/projects/${projectId}/transfer-photo-status`)
        .then((d) => { if (d.exempted) setPhotoExempted(true); })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [claimed, photoRequired, photoExempted, projectId]);

  // ②③ 迁移已完成会话在身：留档照（或跳过）→ 进评审页
  if (claimed) {
    const finish = async (payload: { photoAssetId?: string | null; occlusion?: 'passed' | 'unchecked' | null; skipped?: boolean }) => {
      setPhotoBusy(true);
      try {
        await api.post(`/expert/projects/${projectId}/transfer-photo`, payload);
      } catch {
        /* 留痕失败不阻塞进入（会话已迁移成功） */
      } finally {
        router.replace(`/tablet/evaluate/${projectId}`);
      }
    };
    const handlePhoto = async (photoBlob: Blob | null, occlusion: 'passed' | 'unchecked') => {
      if (!photoBlob) return;
      setPhotoBusy(true);
      try {
        const fd = new FormData();
        fd.append('file', photoBlob, `expert-transfer-${Date.now()}.jpg`);
        const asset = await api.post<{ id: string }>('/upload?category=expert_signin_photo', fd);
        await finish({ photoAssetId: asset.id, occlusion });
      } catch (e: any) {
        toast.error(e?.message || '照片上传失败，可重试或跳过');
        setPhotoBusy(false);
      }
    };
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 pt-8 pb-12">
        <div className="exp-alert exp-alert--success flex items-center gap-2 !p-4">
          <Smartphone size={18} strokeWidth={1.5} className="shrink-0" />
          <div>
            <p className="text-sm font-semibold">迁移成功{expertName ? ` · ${expertName}` : ''}</p>
            <p className="text-xs opacity-80">{photoRequired && !photoExempted ? '请拍摄留档照；摄像头不可用需主持人现场豁免' : '请拍摄留档照后进入评审'}</p>
          </div>
        </div>
        <div className="neu-card-static p-4">
          <SigninCamera userName={expertName} onSignIn={(b, o) => void handlePhoto(b, o)} busy={photoBusy} identityMode="self" />
          {!photoRequired || photoExempted ? (
            <button
              type="button"
              onClick={() => void finish({ skipped: true })}
              disabled={photoBusy}
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] underline-offset-2 hover:underline"
            >
              {photoExempted ? '主持人已豁免留档照，进入评审' : '暂不拍摄，直接进入评审'} <ArrowRight size={13} strokeWidth={1.7} />
            </button>
          ) : (
            <p className="mt-4 text-xs leading-relaxed text-[var(--warning)]">
              您的签到未留档照，本次迁移<strong>必须补拍留档照</strong>；如摄像头不可用，请联系主持人现场确认——
              主持人在开评标管理端豁免后，本页自动解锁（正在等待确认…）。
            </p>
          )}
        </div>
      </div>
    );
  }

  // ① 票据 + 密码重证
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ username: string; projectId: string; photoRequired?: boolean }>('/auth/expert-transfer/claim', {
        ticket,
        password,
      });
      setExpertName(r.username);
      setPhotoRequired(!!r.photoRequired);
      setClaimed(true);
      setPassword('');
    } catch (e: any) {
      const code = e?.data?.code;
      setError(
        code === 'TICKET_INVALID' ? '迁移码已过期或已使用——请回桌面端重新生成'
        : code === 'TICKET_STALE' ? '桌面会话已变化，迁移码失效——请回桌面端重新生成'
        : code === 'TICKET_BURNED' ? '密码连续错误 3 次，迁移码已作废——请回桌面端重新生成'
        : e?.message || '迁移失败',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-5 px-6 pt-10 pb-12">
      <div className="space-y-2">
        <h1 className="text-[1.2rem] font-black tracking-[-0.01em] text-[var(--foreground)]">工位迁移</h1>
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
          输入您的<strong className="text-[var(--foreground)]">登录密码</strong>确认本人身份，将评审工作位从桌面迁移到本平板。
        </p>
      </div>
      <div className="neu-card-static space-y-4 p-5">
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">登录密码（必填）</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && password) void submit(); }}
            placeholder="与专家门户登录密码一致"
            disabled={busy}
            className="neu-input w-full !h-12"
            autoFocus
          />
        </div>
        {error && <p className="text-xs font-semibold text-[var(--danger,#c0392b)]">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !password}
          className="neu-btn-primary !h-[46px] w-full"
        >
          {busy ? '验证中…' : '确认迁移到本平板'}
        </button>
        <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          迁移后桌面端评审会话自动失效；如密码遗忘，请联系主持人在开评标管理端解除锁定后重新登录。
        </p>
      </div>
    </div>
  );
}

export default function TabletClaimPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">加载中…</div>}>
      <ClaimFlow />
    </Suspense>
  );
}
