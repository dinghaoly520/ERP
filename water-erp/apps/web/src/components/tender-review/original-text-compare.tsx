'use client';

import { useState } from 'react';

interface OriginalTextCompareProps {
  documentExcerpt?: string;
  documentFileName?: string;
  documentLocation?: {
    clauseNumber: string;
    sectionName: string;
    excerpt: string;
  };
  kbExcerpt?: string;
  knowledgeBaseReferences?: Array<{
    fileName: string;
    clauseContent: string;
    score: number;
  }>;
}

const TRUNCATE_LENGTH = 200;

export default function OriginalTextCompare({
  documentExcerpt,
  documentFileName,
  documentLocation,
  kbExcerpt,
  knowledgeBaseReferences,
}: OriginalTextCompareProps) {
  const [docExpanded, setDocExpanded] = useState(false);
  const [kbExpanded, setKbExpanded] = useState(false);

  const docText = documentExcerpt || documentLocation?.excerpt || '';
  const kbText = kbExcerpt || knowledgeBaseReferences?.[0]?.clauseContent || '';
  const docSource = (() => {
    if (documentLocation) {
      const parts = [documentLocation.sectionName, documentLocation.clauseNumber].filter(Boolean);
      if (parts.length > 0) return parts.join(' · ');
    }
    return documentFileName || '被审文件';
  })();
  const kbSource = knowledgeBaseReferences?.[0]?.fileName || '对应条款';

  if (!docText && !kbText) return null;

  return (
    <div>
      <div className="text-xs font-semibold text-[var(--muted-foreground)] mb-2 flex items-center gap-1.5">
        📄 原文对照
      </div>
      <div className="flex flex-col gap-3">
        {docText && (
          <div className="rounded-xl bg-[rgba(96,139,239,0.04)] border-l-[3px] border-[rgba(96,139,239,1)] p-3">
            <div className="text-[11px] font-semibold text-[rgba(96,139,239,1)] mb-1.5">
              📍 被审文件 · {docSource}
            </div>
            <div className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              &ldquo;{docExpanded ? docText : docText.slice(0, TRUNCATE_LENGTH) + (docText.length > TRUNCATE_LENGTH ? '...' : '')}&rdquo;
            </div>
            {docText.length > TRUNCATE_LENGTH && (
              <button
                onClick={() => setDocExpanded(!docExpanded)}
                className="text-[11px] text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)] mt-1.5"
              >
                {docExpanded ? '收起 ▴' : '展开完整原文 ▾'}
              </button>
            )}
          </div>
        )}
        {kbText && (
          <div className="rounded-xl bg-[rgba(92,181,150,0.04)] border-l-[3px] border-[rgba(92,181,150,1)] p-3">
            <div className="text-[11px] font-semibold text-[rgba(92,181,150,1)] mb-1.5">
              📖 对应条款 · {kbSource}
            </div>
            <div className="text-xs text-[var(--muted-foreground)] leading-relaxed">
              &ldquo;{kbExpanded ? kbText : kbText.slice(0, TRUNCATE_LENGTH) + (kbText.length > TRUNCATE_LENGTH ? '...' : '')}&rdquo;
            </div>
            {kbText.length > TRUNCATE_LENGTH && (
              <button
                onClick={() => setKbExpanded(!kbExpanded)}
                className="text-[11px] text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)] mt-1.5"
              >
                {kbExpanded ? '收起 ▴' : '展开完整原文 ▾'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
