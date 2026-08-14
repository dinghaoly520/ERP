/**
 * DOCX 段落 XML 文本工具（纯函数，无 Nest 依赖）。
 *
 * 从 project-management.service.ts 抽离（2026-08 审计 P1：拆上帝服务）。
 * 对 <w:p> 段落的 XML 做转义/解码/纯文本提取/文本回写：
 *  - decodeXmlText              解码 XML 实体（&amp; 等）
 *  - extractPlainText           从 <w:p> XML 提取纯文本（<w:br/> → \n）
 *  - applyTextToParagraphXml    将新文本写回 <w:p> XML（按比例分配 + 保留换行）
 * 内部 helper（不导出）：escapeXmlText / distributeTextIntoTNodes
 */

  /** 对 XML 文本内容进行转义（在 <w:t> 节点中放置）。 */
  function escapeXmlText(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 解码 XML 实体（&amp; &lt; &gt; &quot; &apos;），修复原先被 .replace(/&\w+;/g,'') 删光的 bug。 */
  export function decodeXmlText(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&\w+;/g, '');
  }

  /** 从 <w:p> XML 中提取纯文本。保持与 getAttachmentParagraphs 一致的 <w:br/> → \n 转换，确保两次解析产生相同的非空段落集合。 */
  export function extractPlainText(xml: string): string {
    const withLineBreaks = xml.replace(/<w:br[^>]*\/?>/g, '\n');
    return decodeXmlText(withLineBreaks.replace(/<[^>]+>/g, '')).trim();
  }


  /** 将新文本写入 <w:p> XML，保留所有 <w:r>/<w:rPr> 结构与格式。
   *  文字按比例分配到各 <w:t> 节点，\n 转换为 <w:br/> 保留换行。 */
  export function applyTextToParagraphXml(paragraphXml: string, newText: string): string {
    // 多行文本：第一行按比例分配到现有 <w:t>，后续行追加 <w:r><w:br/></w:r> + <w:r><w:t>...</w:t></w:r>
    const lines = newText.split('\n');
    let result = distributeTextIntoTNodes(paragraphXml, lines[0]);

    for (let i = 1; i < lines.length; i++) {
      const insertPos = result.lastIndexOf('</w:p>');
      if (insertPos === -1) break;
      const escaped = escapeXmlText(lines[i]);
      result = result.slice(0, insertPos) +
        `<w:r><w:br/></w:r><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>` +
        result.slice(insertPos);
    }
    return result;
  }

  /** 在 <w:p> XML 的现有 <w:t> 节点中按比例分配单行文字，保留 <w:r> 格式。 */
  function distributeTextIntoTNodes(paragraphXml: string, text: string): string {
    const tNodes: Array<{ start: number; end: number; text: string }> = [];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRegex.exec(paragraphXml)) !== null) {
      tNodes.push({ start: tm.index, end: tm.index + tm[0].length, text: tm[1] });
    }

    if (tNodes.length === 0) return paragraphXml;

    const totalOldLen = tNodes.reduce((s, n) => s + n.text.length, 0);
    const localEdits: Array<{ start: number; end: number; replacement: string }> = [];
    let remaining = text;

    for (let i = 0; i < tNodes.length; i++) {
      const node = tNodes[i];
      let slice: string;
      if (totalOldLen === 0) {
        slice = i === 0 ? remaining : '';
      } else {
        const proportion = node.text.length / totalOldLen;
        const charCount = i === tNodes.length - 1
          ? remaining.length
          : Math.max(0, Math.round(text.length * proportion));
        slice = remaining.slice(0, Math.min(charCount, remaining.length));
        remaining = remaining.slice(slice.length);
      }
      localEdits.push({
        start: node.start,
        end: node.end,
        replacement: `<w:t xml:space="preserve">${escapeXmlText(slice)}</w:t>`,
      });
    }

    let result = paragraphXml;
    for (const edit of localEdits.reverse()) {
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    }
    return result;
  }
