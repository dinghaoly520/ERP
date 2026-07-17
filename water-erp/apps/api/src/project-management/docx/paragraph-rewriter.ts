import { extractParagraphAtoms, Atom } from './paragraph-runs';
import { lcsAlign } from './lcs';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type OutputItem =
  | { kind: 'textrun'; rpr: string; text: string }
  | { kind: 'anchor'; rpr: string; raw: string };

/**
 * 把段落 inner 重写为新文字。
 * - fullText 与 newText 相同时返回原 inner（字节保真）。
 * - 否则：用 LCS 对齐 oldText/newText；keep 的字符沿用其原属 run 的 rPr；
 *   ins 的字符继承"最近一个 keep 的 rPr"（无则取首个 text atom 的 rPr）。
 *   anchor（图片/分页）按其原在 oldText 中的字符位置原序穿插，仅触发一次。
 *   相邻同 rPr 的字符合并到一个 <w:r>，减少碎片。
 */
export function rewriteParagraphInner(pInner: string, newText: string): string {
  const { atoms, fullText } = extractParagraphAtoms(pInner);
  if (fullText === newText) return pInner;

  // 每个 old 字符所属 text atom 的 rPr
  const oldCharRpr: string[] = [];
  const firstTextAtom = atoms.find((a) => a.kind === 'text') as
    | { kind: 'text'; rPrXml: string }
    | undefined;
  const initialRpr = firstTextAtom?.rPrXml ?? '';

  // anchor 在 oldText 中的位置：anchor 出现在已累计 oldN 个字符处 → oldIdx = oldN
  const anchorList: Array<{ oldIdx: number; rpr: string; raw: string }> = [];
  let oldN = 0;
  for (const a of atoms) {
    if (a.kind === 'anchor') {
      anchorList.push({ oldIdx: oldN, rpr: a.rPrXml, raw: a.raw });
    } else {
      for (const _ch of Array.from(a.text)) oldCharRpr.push(a.rPrXml);
      oldN += Array.from(a.text).length;
    }
  }

  const ops = lcsAlign(fullText, newText);

  const output: OutputItem[] = [];
  let bufText = '';
  let bufRpr = initialRpr;
  let lastRpr = initialRpr;
  let oldSeen = 0;
  let anchorPtr = 0;

  const flushText = () => {
    if (bufText) {
      output.push({ kind: 'textrun', rpr: bufRpr, text: bufText });
      bufText = '';
    }
  };
  const emitDueAnchors = () => {
    while (anchorPtr < anchorList.length && anchorList[anchorPtr].oldIdx === oldSeen) {
      flushText();
      output.push({ kind: 'anchor', rpr: anchorList[anchorPtr].rpr, raw: anchorList[anchorPtr].raw });
      anchorPtr++;
    }
  };
  const appendChar = (ch: string, rpr: string) => {
    if (!bufText) bufRpr = rpr;
    else if (bufRpr !== rpr) {
      flushText();
      bufRpr = rpr;
    }
    bufText += ch;
  };

  for (const op of ops) {
    emitDueAnchors();
    if (op.op === 'keep') {
      const rpr = oldCharRpr[op.a] ?? lastRpr;
      appendChar(op.ch, rpr);
      lastRpr = rpr;
      oldSeen++;
    } else if (op.op === 'del') {
      oldSeen++;
    } else {
      appendChar(op.ch, lastRpr);
    }
  }
  emitDueAnchors(); // 尾部 anchor（oldIdx === fullText.length）
  flushText();

  return output
    .map((it) =>
      it.kind === 'textrun'
        ? `<w:r>${it.rpr}<w:t xml:space="preserve">${escapeXml(it.text)}</w:t></w:r>`
        : `<w:r>${it.rpr}${it.raw}</w:r>`,
    )
    .join('');
}
