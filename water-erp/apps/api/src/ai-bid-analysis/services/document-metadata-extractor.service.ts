import { Injectable, Logger } from '@nestjs/common';
import JSZip from 'jszip';
import pdfParse from 'pdf-parse';
import type { BidderDocumentMetadata } from '../types';

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTag(xml: string, tagName: string) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<[^>]*:?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/[^>]*:?${escaped}>`, 'i'));
  return match?.[1] ? decodeXml(match[1]) : undefined;
}

function normalizeDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

@Injectable()
export class DocumentMetadataExtractorService {
  private readonly logger = new Logger(DocumentMetadataExtractorService.name);

  async extract(buffer: Buffer, fileName?: string | null): Promise<BidderDocumentMetadata> {
    const ext = fileName?.toLowerCase().split('.').pop();

    try {
      if (ext === 'docx') {
        return this.extractDocx(buffer);
      }
      if (ext === 'pdf') {
        return this.extractPdf(buffer);
      }
    } catch (error) {
      this.logger.warn(`Failed to extract metadata from ${fileName ?? 'unknown file'}: ${String(error).slice(0, 160)}`);
    }

    return {};
  }

  private async extractDocx(buffer: Buffer): Promise<BidderDocumentMetadata> {
    const zip = await JSZip.loadAsync(buffer);
    const coreXml = await zip.file('docProps/core.xml')?.async('string');
    const appXml = await zip.file('docProps/app.xml')?.async('string');

    const author = coreXml ? extractTag(coreXml, 'creator') : undefined;
    const createdAt = coreXml ? normalizeDate(extractTag(coreXml, 'created')) : undefined;
    const modifiedAt = coreXml ? normalizeDate(extractTag(coreXml, 'modified')) : undefined;
    const creator = appXml ? extractTag(appXml, 'Application') : undefined;
    const pageCountText = appXml ? extractTag(appXml, 'Pages') : undefined;
    const pageCount = pageCountText ? Number.parseInt(pageCountText, 10) : undefined;

    return {
      ...(author ? { author } : {}),
      ...(creator ? { creator } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(Number.isFinite(pageCount) ? { pageCount } : {}),
    };
  }

  private async extractPdf(buffer: Buffer): Promise<BidderDocumentMetadata> {
    const result = await pdfParse(buffer);
    const info = (result.info ?? {}) as Record<string, unknown>;
    const createdAt = typeof info.CreationDate === 'string' ? this.normalizePdfDate(info.CreationDate) : undefined;
    const modifiedAt = typeof info.ModDate === 'string' ? this.normalizePdfDate(info.ModDate) : undefined;

    return {
      ...(typeof info.Author === 'string' && info.Author.trim() ? { author: info.Author.trim() } : {}),
      ...(typeof info.Creator === 'string' && info.Creator.trim() ? { creator: info.Creator.trim() } : {}),
      ...(typeof info.Producer === 'string' && info.Producer.trim() ? { producer: info.Producer.trim() } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(result.numpages ? { pageCount: result.numpages } : {}),
      raw: info,
    };
  }

  private normalizePdfDate(value: string) {
    const match = value.match(/^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (!match) return value;
    const [, year, month, day, hour, minute, second] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  }
}
