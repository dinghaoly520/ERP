/**
 * multipart 文件名 latin1 误读归一化（2026-11-13 生产乱码根治）
 *
 * 背景：multer 2.2.0 → busboy ^1.6.0 这套栈对 multipart 普通参数 `filename="中文"`
 * 的解码是恒等的（busboy 头值经 latin1Slice 累积，multer 不传 defParamCharset、
 * busboy 构造默认 undefined——「默认 utf8」是 busboy 2.x 的行为）。浏览器/undici
 * 发送的原始 UTF-8 文件名字节因此恒以 latin1 形态到达 `file.originalname`
 * （ASCII 无恙、中文变 `æŠ€æœ¯`），**任何新的 multer 上传端点写 originalName 前
 * 必须过本归一化**——2026-07-16 曾以无条件 latin1→utf8 修复过 /upload 等三处
 * （97dea7740），2026-11 的 dual-v3 密文暂存端点漏接复发（生产专家端标书获取乱码）。
 *
 * 条件式安全版（勿回退无条件 Buffer.from(s,'latin1').toString('utf8')——对
 * `filename*` 扩展参数/程序直写来的正确 UTF-8 名会二次毁伤，bid-document.service
 * 注释 2026-11 已踩过一次认知）：
 *   ① 名字含任何 >U+00FF 字符（CJK/全角等）→ 必是正确 UTF-8，原样返回；
 *   ② 纯 ASCII → 无需修复，原样返回；
 *   ③ 含高位字节（U+0080-U+00FF，mojibake 形态；C1 控制符段是 UTF-8 连续字节的
 *     正常误读形态，不算非法）→ latin1→utf8 回转，解码出 U+FFFD（非法序列）或
 *     控制符则判非 mojibake，原样保留不硬修。
 */
export function normalizeMultipartFilename(raw: string): string {
  if (!raw) return raw;
  // ① 含多字节字符 → 已是正确 UTF-8（busboy 非扩展参数输出恒为 ≤U+00FF 单字节字符）
  if (/[^\u0000-ÿ]/.test(raw)) return raw;
  // ② 纯 ASCII → latin1 与 utf8 同形，无事可做
  if (!/[\u0080-ÿ]/.test(raw)) return raw;
  // ③ 高位字节 → 尝试还原
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  if (
    decoded.includes('�') ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decoded)
  ) {
    return raw; // 非合法 UTF-8 字节序列——不是本病理，保留原样
  }
  return decoded;
}

/** 该名字是否会被归一化改变（存量修复脚本的判定口径，与运行时同一把尺子） */
export function needsMultipartFilenameFix(name: string): boolean {
  return !!name && normalizeMultipartFilename(name) !== name;
}
