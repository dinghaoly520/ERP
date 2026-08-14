'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCcw, VideoOff } from 'lucide-react';

export interface SigninCameraProps {
  userName?: string;
  /**
   * 确认签到回调：photoBlob 为拍摄的 JPEG 照片；
   * 摄像头不可用/被拒时传 null（跳过拍照直接签到，照片留痕缺失不阻塞——真实闸门是手机验证 + 服务端 sign-in）
   */
  onSignIn: (photoBlob: Blob | null) => void;
  /** 父组件签到请求进行中（禁用操作按钮） */
  busy?: boolean;
}

type CameraState = 'idle' | 'preview' | 'captured' | 'unavailable';

/**
 * 专家签到拍照留痕组件（真实摄像头取景，不做人脸比对）
 *
 * - 用户主动「开启摄像头」触发 getUserMedia（浏览器授权由用户手势发起）
 * - 预览取景 → 「拍照」canvas 截帧 JPEG → 缩略图确认（重拍 / 确认签到）
 * - 无摄像头 / 拒绝授权 / 截图失败 → 诚实降级「直接签到」：提示跳过拍照，onSignIn(null)
 * - 照片由父组件上传（category=expert_signin_photo）后随签到请求提交 photoAssetId
 */
export function SigninCamera({ userName, onSignIn, busy = false }: SigninCameraProps) {
  const [state, setState] = useState<CameraState>('idle');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearPhotoUrl = useCallback(() => {
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
      clearPhotoUrl();
    };
  }, [stopStream, clearPhotoUrl]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setState('preview');
      // video 元素在 preview 态渲染时经 ref 回调挂流
      const video = videoElRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => {});
      }
    } catch {
      // 无摄像头 / 用户拒绝授权 / 权限被策略拦截 → 诚实降级
      setState('unavailable');
    } finally {
      setStarting(false);
    }
  }, []);

  /** preview 态 video 元素挂载回调：挂流并播放 */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  const handleCapture = useCallback(() => {
    const video = videoElRef.current;
    if (!video || video.videoWidth === 0) {
      setState('unavailable');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setState('unavailable');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        stopStream();
        if (!blob) {
          setState('unavailable');
          return;
        }
        clearPhotoUrl();
        const url = URL.createObjectURL(blob);
        photoUrlRef.current = url;
        setPhotoBlob(blob);
        setPhotoUrl(url);
        setState('captured');
      },
      'image/jpeg',
      0.85,
    );
  }, [stopStream, clearPhotoUrl]);

  const handleRetake = useCallback(() => {
    clearPhotoUrl();
    setPhotoBlob(null);
    setPhotoUrl(null);
    void startCamera();
  }, [clearPhotoUrl, startCamera]);

  const handleClosePreview = useCallback(() => {
    stopStream();
    setState('idle');
  }, [stopStream]);

  return (
    <div className="flex flex-col items-center">
      {/* 标题 */}
      <div className="mb-5 flex items-center gap-2.5">
        <Camera size={20} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
        <span className="text-sm font-bold text-[var(--foreground)]">签到拍照留痕</span>
      </div>

      {/* 取景区 */}
      <div className="relative mx-auto mb-4 flex h-[220px] w-[240px] items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-[oklch(0.96_0.01_258)]">
        {state === 'idle' && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[oklch(0.985_0.005_258)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]">
              <Camera size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]" />
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">
              开启摄像头拍摄现场照片，随签到记录保存留痕
            </span>
          </div>
        )}

        {state === 'preview' && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video ref={attachVideo} className="h-full w-full object-cover" muted playsInline />
        )}

        {state === 'captured' && photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="签到照片" className="h-full w-full object-cover" />
        )}

        {state === 'unavailable' && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[oklch(0.96_0.015_27/0.35)]">
              <VideoOff size={28} strokeWidth={1.5} className="text-[var(--warning)]" />
            </div>
            <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              未检测到可用摄像头或已拒绝授权。系统不进行人脸比对，仅拍照留痕——可跳过拍照直接签到。
            </span>
          </div>
        )}
      </div>

      {/* 说明 / 操作区 */}
      {state === 'idle' && (
        <button
          type="button"
          onClick={() => void startCamera()}
          disabled={starting || busy}
          className="neu-btn-primary !h-[42px] !px-8"
        >
          {starting ? (
            <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Camera size={16} strokeWidth={1.5} />
          )}
          开启摄像头
        </button>
      )}

      {state === 'preview' && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCapture}
            disabled={busy}
            className="neu-btn-primary !h-[42px] !px-8"
          >
            <Camera size={16} strokeWidth={1.5} />
            拍照
          </button>
          <button
            type="button"
            onClick={handleClosePreview}
            disabled={busy}
            className="neu-btn-soft !h-[42px] !px-6"
          >
            关闭
          </button>
        </div>
      )}

      {state === 'captured' && (
        <>
          <p className="mb-3 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
            {userName ? `留痕人：${userName} · ` : ''}照片将作为签到记录附件保存（不进行人脸比对）
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRetake}
              disabled={busy}
              className="neu-btn-soft !h-[42px] !px-6"
            >
              <RefreshCcw size={15} strokeWidth={1.5} />
              重拍
            </button>
            <button
              type="button"
              onClick={() => photoBlob && onSignIn(photoBlob)}
              disabled={busy || !photoBlob}
              className="neu-btn-primary !h-[42px] !px-8"
            >
              {busy ? (
                <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Camera size={16} strokeWidth={1.5} />
              )}
              {busy ? '签到中…' : '确认签到'}
            </button>
          </div>
        </>
      )}

      {state === 'unavailable' && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={starting || busy}
            className="neu-btn-soft !h-[42px] !px-6"
          >
            <RefreshCcw size={15} strokeWidth={1.5} />
            重试摄像头
          </button>
          <button
            type="button"
            onClick={() => onSignIn(null)}
            disabled={busy}
            className="neu-btn-primary !h-[42px] !px-8"
          >
            直接签到
          </button>
        </div>
      )}
    </div>
  );
}
