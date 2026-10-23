/**
 * 签到留档照·人脸遮挡检测判定（SigninCamera 用，2026-09-18 身份核验设计 R3）
 *
 * 输入为 MediaPipe FaceDetector（blaze_face_short_range）单帧检测结果。
 * 检测 ≠ 识别：不建模板、不比对，仅保证留档照可用（防拍墙/拍纸/遮挡）。
 */

export interface FaceAssessment {
  ok: boolean;
  hint?: string;
}

/**
 * blaze_face 关键点序：右眼/左眼/鼻尖/嘴/右耳/左耳。
 * 「右」是解剖学命名（被摄者视角）——未镜像摄像头画面里，被摄者的右眼/右耳
 * 落在图像**左侧**（实测正脸采样：rEar.x≈0.30 < rEye.x≈0.41 < lEye.x≈0.57
 * < lEar.x≈0.63）。正脸判定 = 双耳分别位于同侧眼睛的外侧。
 * bbox 为**像素**（tasks-vision BoundingBox originX/width 皆像素），尺寸
 * 门槛须按画面宽高归一（2026-10-23 前两处皆写错：耳位方向反、像素当归一值，
 * 导致正脸永远「请勿侧脸」无法拍照，尺寸检查永不触发）。
 */
export interface FaceDetectionLite {
  categories?: { score?: number }[];
  boundingBox?: { originX?: number; originY?: number; width?: number; height?: number };
  keypoints?: { x: number; y: number }[];
}

/** frameW/frameH：视频帧像素宽高（video.videoWidth/videoHeight），用于 bbox 归一 */
export function assessFace(det: FaceDetectionLite, frameW: number, frameH: number): FaceAssessment {
  const score = det.categories?.[0]?.score ?? 0;
  if (score < 0.5) return { ok: false, hint: '画质或光线不足，请正对摄像头' };
  const w = det.boundingBox?.width ?? 0;
  const h = det.boundingBox?.height ?? 0;
  if (frameW > 0 && frameH > 0 && (w / frameW < 0.15 || h / frameH < 0.15)) {
    return { ok: false, hint: '人脸太小，请靠近摄像头' };
  }
  const kp = det.keypoints ?? [];
  if (kp.length < 6) return { ok: false, hint: '未检出完整面部特征点，请勿遮挡' };
  const [rEye, lEye, nose, mouth, rEar, lEar] = kp;
  if (Math.abs(nose.x - (rEye.x + lEye.x) / 2) > 0.08) return { ok: false, hint: '请正对摄像头' };
  const eyeY = (rEye.y + lEye.y) / 2;
  if (!(eyeY < nose.y && nose.y < mouth.y)) return { ok: false, hint: '口鼻区域疑似遮挡，请露出完整面部' };
  // 正脸：右耳在右眼图像左侧（外侧）、左耳在左眼图像右侧（外侧）；任一耳朵滑进
  // 眼睛内侧 = 侧脸/半侧脸（转体时对侧耳趋近面中线）
  if (rEar.x >= rEye.x || lEar.x <= lEye.x) return { ok: false, hint: '请勿侧脸，正对摄像头' };
  return { ok: true };
}
