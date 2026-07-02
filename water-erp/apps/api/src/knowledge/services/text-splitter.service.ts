import { Injectable } from '@nestjs/common';

export interface TextChunk {
  content: string;
  startOffset: number;
  metadata: Record<string, unknown>;
}

export interface SplitOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

@Injectable()
export class TextSplitterService {
  split(text: string, options: SplitOptions = {}): TextChunk[] {
    const {
      chunkSize = 1000,
      chunkOverlap = 100,
      separators = ['\n\n', '\n', ' ', ''],
    } = options;

    if (text.length <= chunkSize) {
      return [{ content: text, startOffset: 0, metadata: {} }];
    }

    const rawChunks = this.recursiveSplit(text, separators, chunkSize);
    return this.mergeChunks(rawChunks, chunkSize, chunkOverlap);
  }

  private recursiveSplit(
    text: string,
    separators: string[],
    chunkSize: number,
  ): string[] {
    if (text.length <= chunkSize) {
      return [text];
    }

    if (separators.length === 0) {
      return this.splitByChar(text, chunkSize);
    }

    const [separator, ...restSeparators] = separators;

    // If separator is empty string, split by character
    if (separator === '') {
      return this.splitByChar(text, chunkSize);
    }

    const parts = text.split(separator);

    const result: string[] = [];
    let current = '';

    for (const part of parts) {
      const candidate = current ? current + separator + part : part;

      if (candidate.length <= chunkSize) {
        current = candidate;
      } else {
        if (current) {
          result.push(
            ...this.recursiveSplit(current, restSeparators, chunkSize),
          );
          current = '';
        }

        if (part.length <= chunkSize) {
          current = part;
        } else {
          result.push(...this.recursiveSplit(part, restSeparators, chunkSize));
        }
      }
    }

    if (current) {
      result.push(...this.recursiveSplit(current, restSeparators, chunkSize));
    }

    return result;
  }

  private splitByChar(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private mergeChunks(
    chunks: string[],
    chunkSize: number,
    chunkOverlap: number,
  ): TextChunk[] {
    if (chunks.length === 0) return [];

    const result: TextChunk[] = [];
    let offset = 0;

    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) {
        offset += chunk.length;
        continue;
      }

      result.push({
        content: trimmed,
        startOffset: offset,
        metadata: {},
      });
      offset += chunk.length;
    }

    // Add overlap by prepending tail of previous chunk
    for (let i = result.length - 1; i > 0; i--) {
      const prev = result[i - 1].content;
      const overlapText = prev.slice(-chunkOverlap);
      if (overlapText && overlapText.length < result[i].content.length) {
        result[i].content = overlapText + result[i].content;
      }
    }

    return result;
  }
}
