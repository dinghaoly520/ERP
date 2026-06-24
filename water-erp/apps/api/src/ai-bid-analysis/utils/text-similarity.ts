// apps/api/src/ai-bid-analysis/utils/text-similarity.ts

/**
 * 生成 n-gram 序列
 * 适用于中文文档的字符级相似度计算
 */
function generateNgrams(text: string, n: number): string[] {
  const ngrams: string[] = [];
  // 清理文本：移除多余空白，保留中文字符和数字
  const cleaned = text.replace(/\s+/g, '').trim();
  for (let i = 0; i <= cleaned.length - n; i++) {
    ngrams.push(cleaned.substring(i, i + n));
  }
  return ngrams;
}

/**
 * 计算 Jaccard 相似度（基于 n-gram）
 * 适用于中文文档的相似度检测
 */
export function calculateTextSimilarity(text1: string, text2: string, n: number = 3): number {
  const ngrams1 = new Set(generateNgrams(text1, n));
  const ngrams2 = new Set(generateNgrams(text2, n));

  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

  const intersection = new Set([...ngrams1].filter(g => ngrams2.has(g)));
  const union = new Set([...ngrams1, ...ngrams2]);

  return intersection.size / union.size;
}

/**
 * 计算余弦相似度（基于字符频率）
 * 适用于检测改写或重排的文档
 */
export function calculateCosineSimilarity(text1: string, text2: string): number {
  // 统计字符频率
  const freq1 = new Map<string, number>();
  const freq2 = new Map<string, number>();

  // 清理并统计
  const clean1 = text1.replace(/\s+/g, '');
  const clean2 = text2.replace(/\s+/g, '');

  for (const char of clean1) {
    freq1.set(char, (freq1.get(char) || 0) + 1);
  }
  for (const char of clean2) {
    freq2.set(char, (freq2.get(char) || 0) + 1);
  }

  // 计算点积
  let dotProduct = 0;
  const allChars = new Set([...freq1.keys(), ...freq2.keys()]);
  for (const char of allChars) {
    dotProduct += (freq1.get(char) || 0) * (freq2.get(char) || 0);
  }

  // 计算模长
  const norm1 = Math.sqrt([...freq1.values()].reduce((a, b) => a + b * b, 0));
  const norm2 = Math.sqrt([...freq2.values()].reduce((a, b) => a + b * b, 0));

  if (norm1 === 0 || norm2 === 0) return 0;

  return dotProduct / (norm1 * norm2);
}

/**
 * 计算最长公共子序列（LCS）相似度
 * 适用于检测复制粘贴的段落
 */
export function calculateLCSSimilarity(text1: string, text2: string): number {
  const s1 = text1.replace(/\s+/g, '');
  const s2 = text2.replace(/\s+/g, '');

  const m = s1.length;
  const n = s2.length;

  if (m === 0 || n === 0) {
    return 0;
  }

  let previous = new Uint16Array(n + 1);
  let current = new Uint16Array(n + 1);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        current[j] = previous[j - 1] + 1;
      } else {
        current[j] = Math.max(previous[j], current[j - 1]);
      }
    }

    [previous, current] = [current, previous];
    current.fill(0);
  }

  const lcsLength = previous[n];
  return (2 * lcsLength) / (m + n); // 归一化到 0-1
}

/**
 * 综合相似度计算
 * 结合多种算法，提供更准确的相似度评估
 */
export function calculateComprehensiveSimilarity(text1: string, text2: string): {
  jaccard: number;
  cosine: number;
  lcs: number;
  overall: number;
} {
  const jaccard = calculateTextSimilarity(text1, text2, 3); // 3-gram Jaccard
  const cosine = calculateCosineSimilarity(text1, text2);
  const lcs = calculateLCSSimilarity(text1, text2);

  // 加权综合（LCS 权重最高，因为最能反映直接复制）
  const overall = jaccard * 0.25 + cosine * 0.25 + lcs * 0.5;

  return { jaccard, cosine, lcs, overall };
}

/**
 * 查找相似段落
 * 使用滑动窗口查找文档中的相似片段
 */
export function findSimilarSegments(
  text1: string,
  text2: string,
  minLen = 50,
  similarityThreshold = 0.8,
): string[] {
  const segments: string[] = [];

  // 按句子分割（支持中英文标点）
  const sentences1 = text1.split(/[。！？.!?\n]+/).filter(s => s.trim().length >= minLen);
  const sentences2 = text2.split(/[。！？.!?\n]+/).filter(s => s.trim().length >= minLen);

  for (const s1 of sentences1) {
    for (const s2 of sentences2) {
      const similarity = calculateComprehensiveSimilarity(s1, s2);
      if (similarity.overall > similarityThreshold) {
        segments.push(s1.trim());
        break; // 避免重复添加
      }
    }
  }

  return segments;
}

/**
 * 文档相似度分析
 * 返回详细的相似度报告
 */
export function calculateDocumentSimilarity(
  doc1: { text: string; name?: string },
  doc2: { text: string; name?: string },
): {
  overallSimilarity: number;
  jaccardSimilarity: number;
  cosineSimilarity: number;
  lcsSimilarity: number;
  similarSegments: string[];
  riskLevel: 'low' | 'medium' | 'high';
} {
  const similarity = calculateComprehensiveSimilarity(doc1.text, doc2.text);
  const similarSegments = findSimilarSegments(doc1.text, doc2.text);

  // 确定风险等级
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (similarity.overall > 0.9 || similarity.lcs > 0.95) {
    riskLevel = 'high';
  } else if (similarity.overall > 0.7 || similarity.lcs > 0.8) {
    riskLevel = 'medium';
  }

  return {
    overallSimilarity: similarity.overall,
    jaccardSimilarity: similarity.jaccard,
    cosineSimilarity: similarity.cosine,
    lcsSimilarity: similarity.lcs,
    similarSegments,
    riskLevel,
  };
}

/**
 * 批量文档相似度检测
 * 检测多份文档之间的相似度
 */
export function detectDocumentSimilarities(
  documents: Array<{ id: string; name: string; text: string }>,
): Array<{
  doc1Id: string;
  doc1Name: string;
  doc2Id: string;
  doc2Name: string;
  similarity: number;
  riskLevel: 'low' | 'medium' | 'high';
  similarSegments: string[];
}> {
  const results: Array<{
    doc1Id: string;
    doc1Name: string;
    doc2Id: string;
    doc2Name: string;
    similarity: number;
    riskLevel: 'low' | 'medium' | 'high';
    similarSegments: string[];
  }> = [];

  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      const doc1 = documents[i];
      const doc2 = documents[j];

      const similarity = calculateDocumentSimilarity(
        { text: doc1.text, name: doc1.name },
        { text: doc2.text, name: doc2.name },
      );

      // 只记录中高风险的结果
      if (similarity.riskLevel !== 'low') {
        results.push({
          doc1Id: doc1.id,
          doc1Name: doc1.name,
          doc2Id: doc2.id,
          doc2Name: doc2.name,
          similarity: similarity.overallSimilarity,
          riskLevel: similarity.riskLevel,
          similarSegments: similarity.similarSegments,
        });
      }
    }
  }

  // 按相似度降序排序
  return results.sort((a, b) => b.similarity - a.similarity);
}