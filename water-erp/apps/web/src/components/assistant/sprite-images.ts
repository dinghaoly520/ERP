/** 水叮当表情映射 — 中文名 → 英文文件名前缀 */
export type SpriteExpression = "normal" | "happy" | "excited" | "serious" | "pitiful" | "laugh" | "thinking" | "staring";

export const DINGDANG_IMAGES: Record<SpriteExpression, string> = {
  normal: "normal",
  happy: "happy",
  excited: "excited",
  serious: "serious",
  pitiful: "pitiful",
  laugh: "laugh",
  thinking: "thinking",
  staring: "staring",
};

/** 根据回复内容推断合适的表情 */
export function inferExpression(
  content: string,
  hasChart: boolean,
  hasKnowledge: boolean,
  hasError: boolean,
): SpriteExpression {
  if (hasError) return "pitiful";
  if (hasChart) return "excited";
  if (hasKnowledge) return "serious";
  if (!content) return "normal";

  // 检测正面情绪关键词
  const positiveWords = /好|棒|赞|成功|完成|不错|可以|漂亮|厉害|优秀|恭喜|庆祝/;
  const questionWords = /为什么|怎么|如何|是什么|什么是|什么意思/;
  const seriousWords = /法规|合规|审查|风险|警告|注意|必须|禁止|要求|标准/;

  if (seriousWords.test(content)) return "serious";
  if (positiveWords.test(content)) return "happy";
  if (questionWords.test(content)) return "staring";

  return "normal";
}
