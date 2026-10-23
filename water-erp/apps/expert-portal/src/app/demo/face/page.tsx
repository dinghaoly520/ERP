'use client';

/**
 * 签到留档照·遮挡检测验证页（演示，2026-10-23）
 *
 * 免登录、不上传——复用生产组件 SigninCamera（判定逻辑 lib/face-assess.ts，
 * 修复 blaze_face 耳位方向后正脸可过）。用于局域网实机验证摄像头链路：
 * 正脸保持 ~1.2s → 角标「面部完整，可拍照」→ 拍照 → 确认后展示本帧结论。
 *
 * LAN http 访问摄像头须浏览器把本源加入安全上下文白名单：
 * chrome://flags/#unsafely-treat-insecure-origin-as-secure → 填
 * http://192.168.1.111:3006 → 重启浏览器（与 :3004/:3006 既有演示机口径一致）。
 */

import { useEffect, useState } from 'react';
import { RotateCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { SigninCamera } from '@/components/signin-camera';

interface DemoResult {
  occlusion: 'passed' | 'unchecked';
  photoKB: number;
  at: string;
}

export default function FaceDemoPage() {
  const [result, setResult] = useState<DemoResult | null>(null);
  const [round, setRound] = useState(0);
  const [insecure, setInsecure] = useState(false);

  useEffect(() => {
    setInsecure(!window.isSecureContext);
  }, []);

  return (
    <div className="flow-page flex min-h-screen items-center justify-center px-4 py-10">
      <div className="neu-card-static w-full max-w-[420px] p-7">
        <div className="mb-1 flex items-center gap-2.5">
          <ShieldCheck size={20} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
          <span className="text-sm font-bold text-[var(--foreground)]">签到留档照·遮挡检测验证</span>
        </div>
        <p className="mb-5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          演示页：与 :3006 真实签到同一组件与判定逻辑，不登录、不上传、不写库。
          正对摄像头保持约 1 秒，角标变「面部完整，可拍照」即通过。
        </p>

        {insecure && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--foreground)]">
            <TriangleAlert size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[var(--warning)]" />
            <span>
              当前为非安全上下文（http），浏览器会拒绝摄像头授权。请在演示机 Chrome 打开
              <span className="font-mono"> chrome://flags/#unsafely-treat-insecure-origin-as-secure </span>
              填入 <span className="font-mono">{typeof window !== 'undefined' ? window.location.origin : ''}</span>
              并重启浏览器；本机 localhost 访问无需此设置。
            </span>
          </div>
        )}

        {result ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex flex-col items-center gap-1.5 text-center">
              <span className="text-sm font-bold text-[var(--success)]">
                {result.occlusion === 'passed' ? '遮挡检测通过 · 照片已捕获（演示）' : '检测未运行 · 应急无照片（演示）'}
              </span>
              <span className="text-[11px] text-[var(--muted-foreground)]">
                {result.occlusion === 'passed' ? `照片大小 ${result.photoKB} KB · ` : ''}
                捕获时刻 {result.at} · 仅本地展示，未上传
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setResult(null); setRound((r) => r + 1); }}
              className="neu-btn-soft !h-[42px] !px-8"
            >
              <RotateCcw size={15} strokeWidth={1.5} />
              再测一次
            </button>
          </div>
        ) : (
          <SigninCamera
            key={round}
            identityMode="self"
            onSignIn={(photoBlob, occlusion) =>
              setResult({
                occlusion,
                photoKB: photoBlob ? Math.round(photoBlob.size / 1024) : 0,
                at: new Date().toLocaleTimeString('zh-CN'),
              })
            }
          />
        )}
      </div>
    </div>
  );
}
