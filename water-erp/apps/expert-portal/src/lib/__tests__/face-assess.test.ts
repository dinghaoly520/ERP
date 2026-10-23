import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFace, type FaceDetectionLite } from '../face-assess.ts';

// 背景（2026-10-23「拍照签到遮挡识别一直不通过无法拍照」事故）：blaze_face 关键点
// 「右眼/右耳」是解剖学命名（被摄者视角），未镜像画面里落在图像左侧；assessFace
// 耳位检查按图像坐标写反了方向，正脸永远判「请勿侧脸」，goodFrames 每帧清零，
// 拍照按钮永久禁用。以下正脸夹具为 2026-10-23 真实采样（randomuser 三张正脸照片
// 过 640×480 画布 + 生产同版 wasm/模型的检测结果，score 0.83~0.95）。

const FRAME = { w: 640, h: 480 };

/** 真实正脸 #1：score 0.903，bbox 276×275px，kp 见下（归一化坐标） */
const realFace1: FaceDetectionLite = {
  categories: [{ score: 0.903 }],
  boundingBox: { originX: 162, originY: 126, width: 276, height: 275 },
  keypoints: [
    { x: 0.412, y: 0.436 }, // 右眼（图像偏左）
    { x: 0.57, y: 0.451 }, // 左眼
    { x: 0.501, y: 0.607 }, // 鼻尖
    { x: 0.489, y: 0.703 }, // 嘴
    { x: 0.298, y: 0.451 }, // 右耳（比右眼更靠图像左）
    { x: 0.632, y: 0.477 }, // 左耳（比左眼更靠图像右）
  ],
};

const realFace2: FaceDetectionLite = {
  categories: [{ score: 0.834 }],
  boundingBox: { originX: 195, originY: 122, width: 236, height: 236 },
  keypoints: [
    { x: 0.399, y: 0.396 },
    { x: 0.55, y: 0.405 },
    { x: 0.457, y: 0.533 },
    { x: 0.46, y: 0.624 },
    { x: 0.337, y: 0.422 },
    { x: 0.653, y: 0.442 },
  ],
};

const realFace3: FaceDetectionLite = {
  categories: [{ score: 0.949 }],
  boundingBox: { originX: 244, originY: 95, width: 190, height: 190 },
  keypoints: [
    { x: 0.469, y: 0.308 },
    { x: 0.589, y: 0.305 },
    { x: 0.528, y: 0.404 },
    { x: 0.529, y: 0.482 },
    { x: 0.406, y: 0.347 },
    { x: 0.659, y: 0.344 },
  ],
};

test('真实正脸夹具 ×3 判定通过（修复前全部误判「请勿侧脸」）', () => {
  for (const det of [realFace1, realFace2, realFace3]) {
    assert.deepEqual(assessFace(det, FRAME.w, FRAME.h), { ok: true });
  }
});

test('侧脸（右耳滑到右眼图像右侧之内）仍拒绝', () => {
  const det: FaceDetectionLite = {
    ...realFace1,
    keypoints: realFace1.keypoints!.map((p, i) => (i === 4 ? { x: 0.5, y: 0.451 } : p)),
  };
  assert.equal(assessFace(det, FRAME.w, FRAME.h).ok, false);
});

test('人脸过小（bbox 占画面 <15%）拒绝——bbox 为像素，须按画面尺寸归一', () => {
  const det: FaceDetectionLite = {
    ...realFace1,
    boundingBox: { originX: 290, originY: 210, width: 70, height: 70 }, // 70/640≈0.109
  };
  const a = assessFace(det, FRAME.w, FRAME.h);
  assert.equal(a.ok, false);
  assert.match(a.hint ?? '', /太小/);
});

test('置信度不足拒绝', () => {
  const a = assessFace({ ...realFace1, categories: [{ score: 0.4 }] }, FRAME.w, FRAME.h);
  assert.equal(a.ok, false);
  assert.match(a.hint ?? '', /光线/);
});

test('关键点不足 6 个拒绝（遮挡检出）', () => {
  const a = assessFace({ ...realFace1, keypoints: realFace1.keypoints!.slice(0, 4) }, FRAME.w, FRAME.h);
  assert.equal(a.ok, false);
  assert.match(a.hint ?? '', /遮挡/);
});
