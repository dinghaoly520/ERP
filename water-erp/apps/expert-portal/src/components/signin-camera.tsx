'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCcw, ScanFace, ShieldAlert, VideoOff } from 'lucide-react';
import type { FaceDetector, FaceDetectorResult } from '@mediapipe/tasks-vision';

export interface SigninCameraProps {
  userName?: string;
  /**
   * 身份核验模式闸（服务端 identityMode 透传，2026-09-20 修复）：
   * 仅 off 应急态渲染「应急签到（无照片）」——self/host 态该按钮必被服务端 400
   * PHOTO_REQUIRED 拒收，渲染出来只会诱导反复点击；self/host 态摄像头故障的唯一
   * 处置 = 主持人 :3007 核验矩阵手动确认，故只留「重试 + 联系主持人」指引
   */
  identityMode?: 'self' | 'host' | 'off';
  /**
   * 确认签到回调：photoBlob 为拍摄的 JPEG 留档照；occlusion 为遮挡检测结论
   * （passed=检测通过；unchecked=检测不可用降级或应急直签——服务端模式闸最终裁决，
   * self/host 态无照片会 400 PHOTO_REQUIRED，off 应急态放行）
   */
  onSignIn: (photoBlob: Blob | null, occlusion: 'passed' | 'unchecked') => void;
  /** 父组件签到请求进行中（禁用操作按钮） */
  busy?: boolean;
}

type CameraState = 'idle' | 'starting' | 'preview' | 'captured' | 'unavailable';
type DetectorState = 'loading' | 'ready' | 'failed';
type FaceStatus = 'no_face' | 'warn' | 'ok';

/** 连续通过帧数（~1.2s @100ms 节流）——防瞬间误判 */
const GOOD_FRAMES_REQUIRED = 12;
const DETECT_INTERVAL_MS = 100;
/** 眼/鼻/嘴关键点几何判定 + 检测置信度 + 人脸框占比（spec R3：检测≠识别，保证证据可用性） */
const MODEL_BASE = '/models/mediapipe';

interface FaceAssessment { ok: boolean; hint?: string }

/** blaze_face 关键点序：右眼/左眼/鼻尖/嘴/右耳/左耳（归一化坐标） */
function assessFace(det: FaceDetectorResult['detections'][number]): FaceAssessment {
  const score = det.categories?.[0]?.score ?? 0;
  if (score < 0.5) return { ok: false, hint: '画质或光线不足，请正对摄像头' };
  const w = det.boundingBox?.width ?? 0;
  const h = det.boundingBox?.height ?? 0;
  if (w < 0.15 || h < 0.15) return { ok: false, hint: '人脸太小，请靠近摄像头' };
  const kp = det.keypoints ?? [];
  if (kp.length < 6) return { ok: false, hint: '未检出完整面部特征点，请勿遮挡' };
  const [rEye, lEye, nose, mouth, rEar, lEar] = kp;
  if (Math.abs(nose.x - (rEye.x + lEye.x) / 2) > 0.08) return { ok: false, hint: '请正对摄像头' };
  const eyeY = (rEye.y + lEye.y) / 2;
  if (!(eyeY < nose.y && nose.y < mouth.y)) return { ok: false, hint: '口鼻区域疑似遮挡，请露出完整面部' };
  if (rEar.x <= rEye.x || lEar.x >= lEye.x) return { ok: false, hint: '请勿侧脸，正对摄像头' };
  return { ok: true };
}

/**
 * 专家签到留档照组件（必拍 + 客户端人脸遮挡检测，2026-09-18 身份核验设计 R3）
 *
 * - MediaPipe FaceDetector（Apache-2.0）WASM+模型自托管于 /public/models（内网不依赖 CDN）
 * - 检测≠识别：不建模板、不比对、判定即弃帧，仅保证留档照可用（防拍墙/拍纸/遮挡）
 * - 检测不可用（模型加载失败/老旧浏览器）→ 诚实降级：仍必拍，occlusion='unchecked'，不阻塞现场
 * - 无跳过入口；摄像头完全不可用时按模式分流（2026-09-20 修复）：off 应急态保留
 *   「应急签到」按钮（onSignIn(null,'unchecked')，服务端放行）；self/host 态该按钮
 *   必被 400 PHOTO_REQUIRED 拒——不渲染，只留「重试摄像头 + 联系主持人手动确认」指引
 */
export function SigninCamera({ userName, identityMode = 'self', onSignIn, busy = false }: SigninCameraProps) {
  const [state, setState] = useState<CameraState>('idle');
  const [detectorState, setDetectorState] = useState<DetectorState>('loading');
  const [faceStatus, setFaceStatus] = useState<FaceStatus>('no_face');
  const [hint, setHint] = useState<string>('');
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const rafRef = useRef<number | null>(null);
  const goodFramesRef = useRef(0);
  const lastDetectAtRef = useRef(0);
  const stateRef = useRef<CameraState>('idle');
  stateRef.current = state;

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

  const stopDetection = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopDetection();
      stopStream();
      clearPhotoUrl();
      detectorRef.current?.close();
      detectorRef.current = null;
    };
  }, [stopDetection, stopStream, clearPhotoUrl]);

  /** 预览态检测循环：节流评估人脸质量，连续 GOOD_FRAMES_REQUIRED 帧通过 → 放开「拍照」 */
  const runDetection = useCallback(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (stateRef.current !== 'preview') return;
      const video = videoElRef.current;
      const detector = detectorRef.current;
      if (!video || !detector || video.readyState < 2) return;
      const now = performance.now();
      if (now - lastDetectAtRef.current < DETECT_INTERVAL_MS) return;
      lastDetectAtRef.current = now;
      const best = detector.detectForVideo(video, now).detections[0];
      if (!best) {
        goodFramesRef.current = 0;
        setFaceStatus('no_face');
        setHint('未检测到人脸');
        return;
      }
      const a = assessFace(best);
      if (a.ok) {
        goodFramesRef.current += 1;
        if (goodFramesRef.current >= GOOD_FRAMES_REQUIRED) {
          setFaceStatus('ok');
          setHint('');
        } else {
          setFaceStatus('warn');
          setHint('正在核对面部，请保持…');
        }
      } else {
        goodFramesRef.current = 0;
        setFaceStatus('warn');
        setHint(a.hint ?? '请调整位置');
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

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
      const video = videoElRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => {});
      }
      // 检测器懒加载（一次）：失败 → 降级仍必拍（occlusion=unchecked）
      if (!detectorRef.current && detectorState === 'loading') {
        try {
          const { FilesetResolver, FaceDetector: FD } = await import('@mediapipe/tasks-vision');
          const vision = await FilesetResolver.forVisionTasks(`${MODEL_BASE}/wasm`);
          detectorRef.current = await FD.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `${MODEL_BASE}/blaze_face_short_range.tflite`, delegate: 'CPU' },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.3,
          });
          setDetectorState('ready');
          runDetection();
        } catch {
          setDetectorState('failed');
        }
      } else if (detectorRef.current) {
        runDetection();
      }
    } catch {
      // 无摄像头 / 用户拒绝授权 / 权限被策略拦截 → 无跳过：仅应急入口（服务端裁决）
      setState('unavailable');
    } finally {
      setStarting(false);
    }
  }, [detectorState, runDetection]);

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
        stopDetection();
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
  }, [stopDetection, stopStream, clearPhotoUrl]);

  const handleRetake = useCallback(() => {
    clearPhotoUrl();
    setPhotoBlob(null);
    setPhotoUrl(null);
    goodFramesRef.current = 0;
    setFaceStatus('no_face');
    setHint('');
    void startCamera();
  }, [clearPhotoUrl, startCamera]);

  const handleClosePreview = useCallback(() => {
    stopDetection();
    stopStream();
    setState('idle');
  }, [stopDetection, stopStream]);

  /** 拍照可放开：检测通过；或检测降级（failed——仍必拍，结论 unchecked） */
  const captureAllowed = detectorState === 'failed' || (detectorState === 'ready' && faceStatus === 'ok');
  const occlusion: 'passed' | 'unchecked' = detectorState === 'failed' ? 'unchecked' : 'passed';

  return (
    <div className="flex flex-col items-center">
      {/* 标题 */}
      <div className="mb-5 flex items-center gap-2.5">
        <Camera size={20} strokeWidth={1.5} className="text-[var(--accent-strong)]" />
        <span className="text-sm font-bold text-[var(--foreground)]">签到留档照（必拍）</span>
      </div>

      {/* 取景区 */}
      <div className="relative mx-auto mb-3 flex h-[220px] w-[240px] items-center justify-center overflow-hidden rounded-2xl bg-[oklch(0.96_0.01_258)] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258/0.12),inset_-2px_-2px_5px_oklch(1_0_0/0.6)]">
        {state === 'idle' && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[oklch(0.985_0.005_258)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]">
              <Camera size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]" />
            </div>
            <span className="text-xs text-[var(--muted-foreground)]">
              开启摄像头拍摄留档照；拍摄时进行人脸遮挡检测（不做人脸比对）
            </span>
          </div>
        )}

        {state === 'preview' && (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={attachVideo} className="h-full w-full object-cover" muted playsInline />
            {/* 检测状态角标 */}
            <div
              className={`absolute left-2 top-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                detectorState === 'failed'
                  ? 'bg-[oklch(0.96_0.015_27/0.9)] text-[var(--warning)]'
                  : faceStatus === 'ok'
                    ? 'bg-[oklch(0.94_0.05_152/0.92)] text-[var(--success)]'
                    : 'bg-black/55 text-white'
              }`}
            >
              <ScanFace size={13} strokeWidth={1.5} />
              {detectorState === 'loading' && '检测组件加载中…'}
              {detectorState === 'failed' && '遮挡检测不可用（降级必拍）'}
              {detectorState === 'ready' && (faceStatus === 'ok' ? '面部完整，可拍照' : hint || '检测中…')}
            </div>
          </>
        )}

        {state === 'captured' && photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="签到留档照" className="h-full w-full object-cover" />
        )}

        {state === 'unavailable' && (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[oklch(0.96_0.015_27/0.35)]">
              <VideoOff size={28} strokeWidth={1.5} className="text-[var(--warning)]" />
            </div>
            <span className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              {identityMode === 'off'
                ? '未检测到可用摄像头或已拒绝授权。系统处于应急模式，可无照片签到，也可重试摄像头补拍留档照。'
                : '未检测到可用摄像头或已拒绝授权。请重试；若确认摄像头故障，请联系主持人现场处理——主持人可在开评标管理端为您手动确认签到。'}
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
            disabled={busy || !captureAllowed}
            title={captureAllowed ? '' : hint || '面部检测通过后可拍照'}
            className="neu-btn-primary !h-[42px] !px-8"
          >
            <Camera size={16} strokeWidth={1.5} />
            {captureAllowed ? '拍照' : '请正对摄像头…'}
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
            {userName ? `留痕人：${userName} · ` : ''}
            照片将作为签到留档证据保存
            {occlusion === 'unchecked' && '（遮挡检测未运行）'}
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
              onClick={() => photoBlob && onSignIn(photoBlob, occlusion)}
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
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void startCamera()}
              disabled={starting || busy}
              className={identityMode === 'off' ? 'neu-btn-soft !h-[42px] !px-6' : 'neu-btn-primary !h-[42px] !px-8'}
            >
              <RefreshCcw size={15} strokeWidth={1.5} />
              重试摄像头
            </button>
            {identityMode === 'off' && (
              <button
                type="button"
                onClick={() => onSignIn(null, 'unchecked')}
                disabled={busy}
                className="neu-btn-primary !h-[42px] !px-8"
              >
                <ShieldAlert size={16} strokeWidth={1.5} />
                应急签到（无照片）
              </button>
            )}
          </div>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {identityMode === 'off'
              ? '应急签到需系统处于应急模式方可通过，否则将被拒绝'
              : '摄像头故障的处置：主持人在开评标管理端「评标管理」核验矩阵中手动确认签到（需登记理由，全程留痕）'}
          </span>
        </div>
      )}
    </div>
  );
}
