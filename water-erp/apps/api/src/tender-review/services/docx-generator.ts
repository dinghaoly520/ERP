import * as JSZip from 'jszip';
import { Document, Paragraph, TextRun, Packer } from 'docx';

interface DocxPart {
  type: 'normal' | 'deleted' | 'inserted';
  text: string;
}

interface RunSegment {
  start: number;
  end: number;
  text: string;
  propertiesXml: string;
  runXml: string;
}

function parseHtmlToParts(html: string): DocxPart[] {
  const parts: DocxPart[] = [];
  const regex =
    /(<del[^>]*>([\s\S]*?)<\/del>)|(<ins[^>]*>([\s\S]*?)<\/ins>)|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    if (match[1]) {
      parts.push({ type: 'deleted', text: match[2] });
    } else if (match[3]) {
      parts.push({ type: 'inserted', text: match[4] });
    } else if (match[5]) {
      parts.push({ type: 'normal', text: match[5] });
    }
  }

  return parts;
}

export async function generateDocxFromContent(
  content: string,
  documentName: string,
): Promise<Buffer> {
  const lines = content.split('\n');
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    const parts = parseHtmlToParts(line);
    const runs: TextRun[] = [];

    for (const part of parts) {
      if (part.type === 'deleted') {
        runs.push(
          new TextRun({
            text: part.text,
            strike: true,
            color: '999999',
          }),
        );
      } else if (part.type === 'inserted') {
        runs.push(
          new TextRun({
            text: part.text,
            color: 'FF0000',
            bold: true,
          }),
        );
      } else {
        runs.push(new TextRun({ text: part.text }));
      }
    }

    paragraphs.push(
      new Paragraph({ children: runs.length > 0 ? runs : [new TextRun('')] }),
    );
  }

  const doc = new Document({
    sections: [{ children: paragraphs }],
  });

  return Packer.toBuffer(doc);
}

export async function modifyDocxBuffer(
  originalBuffer: Buffer,
  originalText: string,
  replacementText: string,
  operation: 'replace' | 'insert' | 'delete',
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(originalBuffer);

  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }

  const settingsXml = await zip.file('word/settings.xml')?.async('string');
  const xmlOriginal = escapeXml(originalText);
  const xmlReplacement = escapeXml(replacementText || '');

  let modified = docXml;

  if (operation === 'replace' || operation === 'delete') {
    modified = replaceTextAcrossRuns(
      modified,
      originalText,
      (props) =>
        buildDelMarkup(xmlOriginal, props) +
        (operation === 'replace' ? buildInsMarkup(xmlReplacement, props) : ''),
    );
  }

  if (operation === 'insert' && replacementText) {
    const insMarkup = buildInsMarkup(xmlReplacement);
    const lastPara = modified.lastIndexOf('</w:p>');
    if (lastPara >= 0) {
      modified =
        modified.slice(0, lastPara) + insMarkup + modified.slice(lastPara);
    }
  }

  zip.file('word/document.xml', modified);
  if (settingsXml) {
    zip.file('word/settings.xml', ensureTrackRevisions(settingsXml));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function addDocxCommentBuffer(
  originalBuffer: Buffer,
  commentText: string,
  anchorText?: string,
  author = '审查系统',
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(originalBuffer);

  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }

  const contentTypesXml = await zip
    .file('[Content_Types].xml')
    ?.async('string');
  const documentRelsXml = await zip
    .file('word/_rels/document.xml.rels')
    ?.async('string');

  if (!contentTypesXml || !documentRelsXml) {
    throw new Error('Invalid DOCX: missing package metadata for comments');
  }

  const commentsXml =
    (await zip.file('word/comments.xml')?.async('string')) ??
    createCommentsXml();
  const commentId = getNextCommentId(commentsXml);
  const updatedCommentsXml = appendComment(
    commentsXml,
    commentId,
    commentText,
    author,
  );
  const updatedDocumentXml = anchorText
    ? insertCommentAroundText(docXml, anchorText, commentId)
    : appendCommentToLastParagraph(docXml, commentId);

  zip.file('word/document.xml', updatedDocumentXml);
  zip.file('word/comments.xml', updatedCommentsXml);
  zip.file('[Content_Types].xml', ensureCommentsContentType(contentTypesXml));
  zip.file(
    'word/_rels/document.xml.rels',
    ensureCommentsRelationship(documentRelsXml),
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function extractRunSegments(paragraphXml: string): RunSegment[] {
  const runPattern = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  const textPattern = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  const segments: RunSegment[] = [];
  let match: RegExpExecArray | null;

  while ((match = runPattern.exec(paragraphXml)) !== null) {
    const runXml = match[0];
    const texts = [...runXml.matchAll(textPattern)].map(([, text]) =>
      decodeXml(text),
    );
    const visibleText = texts.join('');
    if (!visibleText) continue;

    const propertiesXml = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
    segments.push({
      start: match.index,
      end: match.index + runXml.length,
      text: visibleText,
      propertiesXml,
      runXml,
    });
  }

  return segments;
}

function buildTextRun(text: string, propertiesXml = ''): string {
  if (!text) return '';
  return `<w:r>${propertiesXml}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function replaceTextAcrossRuns(
  documentXml: string,
  originalText: string,
  replacement: string | ((propertiesXml: string) => string),
): string {
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g;
  let paragraphMatch: RegExpExecArray | null;

  while ((paragraphMatch = paragraphPattern.exec(documentXml)) !== null) {
    const paragraphXml = paragraphMatch[0];
    const runs = extractRunSegments(paragraphXml);
    if (runs.length === 0) continue;

    const paragraphText = runs.map((run) => run.text).join('');
    const startIndex = paragraphText.indexOf(originalText);
    if (startIndex < 0) continue;

    const endIndex = startIndex + originalText.length;
    let firstRunIndex = -1;
    let lastRunIndex = -1;
    let firstRunTextStart = 0;
    let lastRunTextStart = 0;
    let cursor = 0;

    runs.forEach((run, index) => {
      const runStart = cursor;
      const runEnd = runStart + run.text.length;
      const overlaps = startIndex < runEnd && endIndex > runStart;

      if (overlaps && firstRunIndex === -1) {
        firstRunIndex = index;
        firstRunTextStart = runStart;
      }
      if (overlaps) {
        lastRunIndex = index;
        lastRunTextStart = runStart;
      }

      cursor = runEnd;
    });

    if (firstRunIndex < 0 || lastRunIndex < 0) continue;

    const firstRun = runs[firstRunIndex];
    const lastRun = runs[lastRunIndex];
    const prefix = firstRun.text.slice(0, startIndex - firstRunTextStart);
    const suffix = lastRun.text.slice(endIndex - lastRunTextStart);
    const replacementXml =
      typeof replacement === 'function'
        ? replacement(firstRun.propertiesXml)
        : replacement;
    const replacementBlock =
      buildTextRun(prefix, firstRun.propertiesXml) +
      replacementXml +
      buildTextRun(suffix, lastRun.propertiesXml);

    const nextParagraph =
      paragraphXml.slice(0, firstRun.start) +
      replacementBlock +
      paragraphXml.slice(lastRun.end);

    return (
      documentXml.slice(0, paragraphMatch.index) +
      nextParagraph +
      documentXml.slice(paragraphMatch.index + paragraphXml.length)
    );
  }

  return documentXml;
}

function ensureTrackRevisions(settingsXml: string): string {
  if (settingsXml.includes('<w:trackRevisions')) {
    return settingsXml;
  }

  return settingsXml.replace(
    '</w:settings>',
    '<w:trackRevisions/></w:settings>',
  );
}

function createCommentsXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:comments>'
  );
}

function getNextCommentId(commentsXml: string): number {
  const ids = [...commentsXml.matchAll(/<w:comment\b[^>]*w:id="(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  return ids.length > 0 ? Math.max(...ids) + 1 : 0;
}

function appendComment(
  commentsXml: string,
  commentId: number,
  commentText: string,
  author: string,
): string {
  const escapedAuthor = escapeXml(author);
  const escapedText = escapeXml(commentText);
  const markup =
    `<w:comment w:id="${commentId}" w:author="${escapedAuthor}" w:date="${new Date().toISOString()}">` +
    '<w:p><w:r><w:t xml:space="preserve">' +
    escapedText +
    '</w:t></w:r></w:p></w:comment>';

  if (commentsXml.includes('</w:comments>')) {
    return commentsXml.replace('</w:comments>', `${markup}</w:comments>`);
  }

  return commentsXml.replace(
    /<w:comments\b([^>]*)\/>/,
    `<w:comments$1>${markup}</w:comments>`,
  );
}

function ensureCommentsContentType(contentTypesXml: string): string {
  if (contentTypesXml.includes('/word/comments.xml')) {
    return contentTypesXml;
  }

  const override =
    '<Override PartName="/word/comments.xml" ' +
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>';
  return contentTypesXml.replace('</Types>', `${override}</Types>`);
}

function ensureCommentsRelationship(documentRelsXml: string): string {
  if (documentRelsXml.includes('relationships/comments')) {
    return documentRelsXml;
  }

  const ids = [...documentRelsXml.matchAll(/Id="rId(\d+)"/g)].map((match) =>
    Number(match[1]),
  );
  const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  const relationship =
    `<Relationship Id="rId${nextId}" ` +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" ' +
    'Target="comments.xml"/>';

  return documentRelsXml.replace(
    '</Relationships>',
    `${relationship}</Relationships>`,
  );
}

function insertCommentAroundText(
  documentXml: string,
  anchorText: string,
  commentId: number,
): string {
  // Pass 1: paragraph-by-paragraph match (precise, preserves run structure)
  const paragraphResult = tryInsertInParagraph(
    documentXml,
    anchorText,
    commentId,
  );
  if (paragraphResult) return paragraphResult;

  // Pass 2: global XML-level fuzzy search (handles cross-paragraph, table, textbox)
  const globalResult = tryInsertGlobalFuzzy(documentXml, anchorText, commentId);
  if (globalResult) return globalResult;

  // Pass 3: final fallback — attach to last paragraph
  return appendCommentToLastParagraph(documentXml, commentId);
}

/** Pass 1: search within individual paragraphs, preserving run structure */
function tryInsertInParagraph(
  documentXml: string,
  anchorText: string,
  commentId: number,
): string | undefined {
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/g;
  let paragraphMatch: RegExpExecArray | null;

  while ((paragraphMatch = paragraphPattern.exec(documentXml)) !== null) {
    const paragraphXml = paragraphMatch[0];
    const runs = extractRunSegments(paragraphXml);
    if (runs.length === 0) continue;

    const paragraphText = runs.map((run) => run.text).join('');
    let startIndex = paragraphText.indexOf(anchorText);
    let matchLength = anchorText.length;

    if (startIndex < 0) {
      const fuzzy = fuzzyIndexOf(paragraphText, anchorText);
      if (fuzzy) {
        startIndex = fuzzy.start;
        matchLength = fuzzy.length;
      }
    }

    if (startIndex < 0) continue;

    const endIndex = startIndex + matchLength;
    let firstRunIndex = -1;
    let lastRunIndex = -1;
    let firstRunTextStart = 0;
    let lastRunTextStart = 0;
    let cursor = 0;

    runs.forEach((run, index) => {
      const runStart = cursor;
      const runEnd = runStart + run.text.length;
      const overlaps = startIndex < runEnd && endIndex > runStart;

      if (overlaps && firstRunIndex === -1) {
        firstRunIndex = index;
        firstRunTextStart = runStart;
      }
      if (overlaps) {
        lastRunIndex = index;
        lastRunTextStart = runStart;
      }

      cursor = runEnd;
    });

    if (firstRunIndex < 0 || lastRunIndex < 0) continue;

    const firstRun = runs[firstRunIndex];
    const lastRun = runs[lastRunIndex];
    const prefix = firstRun.text.slice(0, startIndex - firstRunTextStart);
    const suffix = lastRun.text.slice(endIndex - lastRunTextStart);
    const selectedFirst = firstRun.text.slice(
      startIndex - firstRunTextStart,
      firstRunIndex === lastRunIndex ? endIndex - firstRunTextStart : undefined,
    );
    const selectedLast =
      firstRunIndex === lastRunIndex
        ? ''
        : lastRun.text.slice(0, endIndex - lastRunTextStart);
    const middleRuns = runs
      .slice(firstRunIndex + 1, lastRunIndex)
      .map((run) => run.runXml)
      .join('');

    const commentWrapped = [
      buildTextRun(prefix, firstRun.propertiesXml),
      `<w:commentRangeStart w:id="${commentId}"/>`,
      buildTextRun(selectedFirst, firstRun.propertiesXml),
      middleRuns,
      firstRunIndex === lastRunIndex
        ? ''
        : buildTextRun(selectedLast, lastRun.propertiesXml),
      `<w:commentRangeEnd w:id="${commentId}"/>`,
      buildCommentReferenceRun(commentId),
      buildTextRun(suffix, lastRun.propertiesXml),
    ].join('');

    const nextParagraph =
      paragraphXml.slice(0, firstRun.start) +
      commentWrapped +
      paragraphXml.slice(lastRun.end);

    return (
      documentXml.slice(0, paragraphMatch.index) +
      nextParagraph +
      documentXml.slice(paragraphMatch.index + paragraphXml.length)
    );
  }

  return undefined;
}

/**
 * Pass 2: cross-run fuzzy search using <w:r> text segments.
 * Searches across paragraph boundaries (tables, textboxes, etc.) while
 * preserving direct correspondence between matched text and XML positions.
 */
function tryInsertGlobalFuzzy(
  documentXml: string,
  anchorText: string,
  commentId: number,
): string | undefined {
  // Extract all visible <w:r> text segments with their XML positions.
  // Skip runs that mammoth would not extract: deleted text, field codes,
  // field instructions, and bookmark anchors.
  const runPattern = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  const textPattern = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;

  // Pre-compute <w:del> ranges for deleted-text detection
  const delPattern = /<w:del\b[^>]*>[\s\S]*?<\/w:del>/g;
  const delRanges: Array<{ start: number; end: number }> = [];
  let delMatch: RegExpExecArray | null;
  while ((delMatch = delPattern.exec(documentXml)) !== null) {
    delRanges.push({
      start: delMatch.index,
      end: delMatch.index + delMatch[0].length,
    });
  }
  const isDeleted = (pos: number) =>
    delRanges.some((r) => pos > r.start && pos < r.end);

  const runs: Array<{
    xmlStart: number;
    xmlEnd: number;
    text: string;
    runXml: string;
  }> = [];
  let runMatch: RegExpExecArray | null;

  while ((runMatch = runPattern.exec(documentXml)) !== null) {
    // Skip runs inside <w:del> (deleted/tracked-change text)
    if (isDeleted(runMatch.index)) continue;

    const runXml = runMatch[0];

    // Skip field code runs (<w:fldChar>, <w:instrText>)
    if (/<w:fldChar\b/.test(runXml) || /<w:instrText\b/.test(runXml)) continue;

    const texts = [...runXml.matchAll(textPattern)].map(([, t]) =>
      decodeXml(t),
    );
    const visibleText = texts.join('');
    if (!visibleText) continue;
    runs.push({
      xmlStart: runMatch.index,
      xmlEnd: runMatch.index + runXml.length,
      text: visibleText,
      runXml,
    });
  }

  // Concatenate all run texts and find match using fuzzy search
  const allText = runs.map((r) => r.text).join('');
  const match = fuzzyIndexOf(allText, anchorText);
  if (!match) return undefined;

  // Map match position to run indices
  let cursor = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < runs.length; i++) {
    const runStart = cursor;
    const runEnd = runStart + runs[i].text.length;
    if (match.start < runEnd && match.start + match.length > runStart) {
      if (firstIdx < 0) firstIdx = i;
      lastIdx = i;
    }
    cursor = runEnd;
  }
  if (firstIdx < 0) return undefined;

  // Build replacement: split first/last runs at match boundaries and wrap
  // the matched portion with comment range markers
  const replacements: Array<{ start: number; end: number; xml: string }> = [];

  if (firstIdx === lastIdx) {
    // Match within a single run
    const run = runs[firstIdx];
    let pos = 0;
    for (let i = 0; i < firstIdx; i++) pos += runs[i].text.length;
    const localStart = match.start - pos;
    const localEnd = localStart + match.length;
    const prefix = run.text.slice(0, localStart);
    const selected = run.text.slice(localStart, localEnd);
    const suffix = run.text.slice(localEnd);
    const props = run.runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';

    const wrapped =
      buildTextRun(prefix, props) +
      `<w:commentRangeStart w:id="${commentId}"/>` +
      buildTextRun(selected, props) +
      `<w:commentRangeEnd w:id="${commentId}"/>` +
      buildCommentReferenceRun(commentId) +
      buildTextRun(suffix, props);

    replacements.push({ start: run.xmlStart, end: run.xmlEnd, xml: wrapped });
  } else {
    // Match spans multiple runs: split first and last, wrap middle entirely
    const firstRun = runs[firstIdx];
    const lastRun = runs[lastIdx];

    let firstPos = 0;
    for (let i = 0; i < firstIdx; i++) firstPos += runs[i].text.length;
    const firstLocalStart = match.start - firstPos;

    let lastPos = 0;
    for (let i = 0; i < lastIdx; i++) lastPos += runs[i].text.length;
    const lastLocalEnd = match.start + match.length - lastPos;

    const firstProps =
      firstRun.runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
    const lastProps =
      lastRun.runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';

    // First run: prefix + matched portion with comment start
    const firstPrefix = firstRun.text.slice(0, firstLocalStart);
    const firstSelected = firstRun.text.slice(firstLocalStart);
    const firstWrapped =
      buildTextRun(firstPrefix, firstProps) +
      `<w:commentRangeStart w:id="${commentId}"/>` +
      buildTextRun(firstSelected, firstProps);
    replacements.push({
      start: firstRun.xmlStart,
      end: firstRun.xmlEnd,
      xml: firstWrapped,
    });

    // Middle runs: wrap entirely
    for (let i = firstIdx + 1; i < lastIdx; i++) {
      const midRun = runs[i];
      const midProps =
        midRun.runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
      replacements.push({
        start: midRun.xmlStart,
        end: midRun.xmlEnd,
        xml: buildTextRun(midRun.text, midProps),
      });
    }

    // Last run: matched portion with comment end + suffix
    const lastSelected = lastRun.text.slice(0, lastLocalEnd);
    const lastSuffix = lastRun.text.slice(lastLocalEnd);
    const lastWrapped =
      buildTextRun(lastSelected, lastProps) +
      `<w:commentRangeEnd w:id="${commentId}"/>` +
      buildCommentReferenceRun(commentId) +
      buildTextRun(lastSuffix, lastProps);
    replacements.push({
      start: lastRun.xmlStart,
      end: lastRun.xmlEnd,
      xml: lastWrapped,
    });
  }

  // Apply replacements in reverse order to preserve positions
  let result = documentXml;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.xml + result.slice(r.end);
  }
  return result;
}

function appendCommentToLastParagraph(
  documentXml: string,
  commentId: number,
): string {
  const lastParaEnd = documentXml.lastIndexOf('</w:p>');
  if (lastParaEnd < 0) return documentXml;

  const marker =
    `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">（审查批注）</w:t></w:r>` +
    `<w:commentRangeStart w:id="${commentId}"/>` +
    `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>` +
    `<w:commentRangeEnd w:id="${commentId}"/>` +
    buildCommentReferenceRun(commentId);

  return (
    documentXml.slice(0, lastParaEnd) + marker + documentXml.slice(lastParaEnd)
  );
}

/**
 * Whitespace-tolerant indexOf. Skips whitespace in both strings during
 * matching, but stops at non-whitespace boundaries in the text that don't
 * correspond to the search. Returns precise start/length in the original text.
 */
function fuzzyIndexOf(
  text: string,
  search: string,
): { start: number; length: number } | undefined {
  let searchPos = 0;
  let matchStart = -1;

  for (let i = 0; i < text.length && searchPos < search.length; i++) {
    if (/\s/.test(text[i])) continue; // skip whitespace in text
    if (/\s/.test(search[searchPos])) {
      searchPos++; // skip whitespace in search
      if (searchPos >= search.length) break;
      i--; // re-check this text char against next search char
      continue;
    }
    if (text[i] === search[searchPos]) {
      if (searchPos === 0) matchStart = i;
      searchPos++;
    } else {
      searchPos = 0;
      matchStart = -1;
    }
  }

  if (searchPos < search.length || matchStart < 0) return undefined;

  // Walk forward from matchStart to find the end in original text coordinates.
  // Stop at any non-whitespace char in text that isn't the next search char.
  let origEnd = matchStart;
  let sp = 0;
  while (origEnd < text.length && sp < search.length) {
    if (/\s/.test(text[origEnd])) {
      origEnd++; // include whitespace between matched words
      continue;
    }
    if (/\s/.test(search[sp])) {
      sp++;
      continue;
    }
    if (text[origEnd] === search[sp]) {
      origEnd++;
      sp++;
    } else {
      break; // non-matching non-whitespace char — stop here
    }
  }

  return { start: matchStart, length: origEnd - matchStart };
}

function buildCommentReferenceRun(commentId: number): string {
  return `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${commentId}"/></w:r>`;
}

function buildDelMarkup(xmlText: string, propertiesXml = ''): string {
  const revisionId = Date.now().toString();
  return (
    `<w:del w:id="${revisionId}" w:author="审查系统" w:date="${new Date().toISOString()}">` +
    `<w:r>${propertiesXml}<w:delText xml:space="preserve">${xmlText}</w:delText></w:r></w:del>`
  );
}

function buildInsMarkup(xmlText: string, propertiesXml = ''): string {
  const revisionId = Date.now().toString();
  return (
    `<w:ins w:id="${revisionId}" w:author="审查系统" w:date="${new Date().toISOString()}">` +
    `<w:r>${propertiesXml}<w:t xml:space="preserve">${xmlText}</w:t></w:r></w:ins>`
  );
}
