import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import * as JSZip from 'jszip';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { ExportTenderWriteDto, ExportAnnouncementDto, ExportNotificationLetterDto } from './tender-write.dto';
import {
  buildCompetitiveNegotiationReplacementPlan,
  buildSingleSourceReplacementPlan,
  buildInquiryPurchaseReplacementPlan,
  buildInternalBiddingReplacementPlan,
  buildInvitedBiddingAnnouncementPlan,
  buildInternalBiddingAnnouncementPlan,
  buildSingleSourceAnnouncementPlan,
  buildFailedBidAnnouncementPlan,
  buildWinningBidAnnouncementPlan,
  buildNotificationLetterPlan,
  COMPETITIVE_NEGOTIATION_TEMPLATE_FILE,
  SINGLE_SOURCE_TEMPLATE_FILE,
  INQUIRY_PURCHASE_TEMPLATE_FILE,
  INTERNAL_BIDDING_TEMPLATE_FILE,
  INVITED_BIDDING_TEMPLATE_FILE,
  INVITED_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE,
  INTERNAL_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE,
  SINGLE_SOURCE_ANNOUNCEMENT_TEMPLATE_FILE,
  FAILED_BID_ANNOUNCEMENT_TEMPLATE_FILE,
  WINNING_BID_ANNOUNCEMENT_TEMPLATE_FILE,
  NOTIFICATION_LETTER_TEMPLATE_FILE,
  renderTemplateXml,
  type AnnouncementCategory,
} from './tender-write.template';
import type {
  CompetitiveNegotiationAnswers,
  InquiryPurchaseAnswers,
  SingleSourceAnswers,
  InternalBiddingAnswers,
} from './tender-write.types';
import { AiService } from '../ai/ai.service';
import { parseUploadedFile } from './import-autofill.file-parser';
import {
  buildImportAutofillSystemPrompt,
  buildImportAutofillUserPrompt,
  parseAiImportResponse,
  getFieldDefsForDocumentType,
} from './import-autofill.prompt';
import type {
  ImportAutofillResult,
  ImportAutofillFileResult,
} from './import-autofill.types';

@Injectable()
export class TenderWriteService {
  private readonly logger = new Logger(TenderWriteService.name);

  constructor(private readonly aiService: AiService) {}

  private resolveTemplatePath(
    documentType: ExportTenderWriteDto['documentType'],
  ) {
    if (documentType === 'SINGLE_SOURCE') {
      return path.resolve(process.cwd(), SINGLE_SOURCE_TEMPLATE_FILE);
    }
    if (documentType === 'INQUIRY_PURCHASE') {
      return path.resolve(process.cwd(), INQUIRY_PURCHASE_TEMPLATE_FILE);
    }
    if (documentType === 'INTERNAL_BIDDING') {
      return path.resolve(process.cwd(), INTERNAL_BIDDING_TEMPLATE_FILE);
    }
    if (documentType === 'INVITED_BIDDING') {
      return path.resolve(process.cwd(), INVITED_BIDDING_TEMPLATE_FILE);
    }
    return path.resolve(process.cwd(), COMPETITIVE_NEGOTIATION_TEMPLATE_FILE);
  }

  private resolveDownloadFileName(
    documentType: ExportTenderWriteDto['documentType'],
    projectName: string,
  ) {
    const trimmedName = projectName.trim();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    let typeLabel: string;
    if (documentType === 'SINGLE_SOURCE') {
      typeLabel = '单源直接采购文件';
    } else if (documentType === 'INQUIRY_PURCHASE') {
      typeLabel = '询价采购文件';
    } else if (documentType === 'INTERNAL_BIDDING') {
      typeLabel = '内部竞标（竞价）采购文件';
    } else if (documentType === 'INVITED_BIDDING') {
      typeLabel = '邀请招标采购文件';
    } else {
      typeLabel = '竞争性谈判采购文件';
    }

    if (trimmedName) {
      return `${trimmedName}-${typeLabel}-${dateStr}.docx`;
    }

    return `${typeLabel}-${dateStr}.docx`;
  }

  async exportDocument(dto: ExportTenderWriteDto) {
    const templatePath = this.resolveTemplatePath(dto.documentType);
    const exists = await fs
      .access(templatePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new NotFoundException(`Template not found: ${templatePath}`);
    }

    const originalBuffer = await fs.readFile(templatePath);
    const zip = await JSZip.loadAsync(originalBuffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    if (!documentXml) {
      throw new NotFoundException(
        'Invalid DOCX template: missing word/document.xml',
      );
    }

    let updatedXml: string;

    if (dto.documentType === 'SINGLE_SOURCE') {
      updatedXml = renderTemplateXml(
        documentXml,
        buildSingleSourceReplacementPlan(dto.answers as SingleSourceAnswers),
      );
    } else if (dto.documentType === 'INQUIRY_PURCHASE') {
      updatedXml = renderTemplateXml(
        documentXml,
        buildInquiryPurchaseReplacementPlan(
          dto.answers as InquiryPurchaseAnswers,
        ),
      );
    } else if (
      dto.documentType === 'INTERNAL_BIDDING' ||
      dto.documentType === 'INVITED_BIDDING'
    ) {
      updatedXml = renderTemplateXml(
        documentXml,
        buildInternalBiddingReplacementPlan(
          dto.answers as InternalBiddingAnswers,
        ),
      );
    } else {
      updatedXml = renderTemplateXml(
        documentXml,
        buildCompetitiveNegotiationReplacementPlan(
          dto.answers as CompetitiveNegotiationAnswers,
        ),
      );
    }

    zip.file('word/document.xml', updatedXml);

    return {
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
      fileName: this.resolveDownloadFileName(
        dto.documentType,
        (dto.answers.projectName as string) ?? '',
      ),
    };
  }

  async importAutofill(
    documentType: string,
    files: Array<{ buffer: Buffer; originalname: string }>,
  ): Promise<ImportAutofillResult> {
    const { fields: fieldDefs, label: documentTypeLabel } =
      getFieldDefsForDocumentType(documentType);
    const allowedKeys = new Set(fieldDefs.map((f) => f.key));

    // 1. Parse each file independently
    const fileResults: ImportAutofillFileResult[] = [];
    const parsedTexts: { name: string; text: string }[] = [];

    for (const file of files) {
      try {
        const parsed = await parseUploadedFile(file.buffer, file.originalname);
        fileResults.push({
          name: file.originalname,
          type: file.originalname.split('.').pop()?.toLowerCase() ?? '',
          status: 'parsed',
        });
        parsedTexts.push(parsed);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : `文件"${file.originalname}"解析失败。`;
        const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
        fileResults.push({
          name: file.originalname,
          type: ext,
          status: ext === 'doc' ? 'unsupported' : 'failed',
          message: msg,
        });
      }
    }

    // 2. If no files parsed, return early
    if (parsedTexts.length === 0) {
      return {
        documentType: documentType as ImportAutofillResult['documentType'],
        files: fileResults,
        fields: fieldDefs.map((f) => ({
          key: f.key,
          label: f.label,
          sectionKey: f.sectionKey,
          sectionTitle: f.sectionTitle,
          status: 'not_found' as const,
          value: '',
          confidence: 0,
        })),
      };
    }

    // 3. Call DeepSeek
    const systemPrompt = buildImportAutofillSystemPrompt(
      documentTypeLabel,
      fieldDefs,
    );
    const userPrompt = buildImportAutofillUserPrompt(parsedTexts);

    let rawJson: string;
    try {
      rawJson = await this.aiService.chatJson(systemPrompt, userPrompt, 0.2);
    } catch (err) {
      throw new BadRequestException(
        `AI 分析失败：${err instanceof Error ? err.message : '请稍后重试。'}`,
      );
    }

    // 4. Parse and validate AI response
    this.logger.log(`AI raw response (first 500 chars): ${rawJson.slice(0, 500)}`);
    const fieldResults = parseAiImportResponse(rawJson, allowedKeys, fieldDefs);
    this.logger.log(`Parsed ${fieldResults.length} fields: ${fieldResults.filter(f => f.status !== 'not_found').length} recognized/low_confidence`);

    return {
      documentType: documentType as ImportAutofillResult['documentType'],
      files: fileResults,
      fields: fieldResults,
    };
  }

  async exportAnnouncement(dto: ExportAnnouncementDto) {
    const { tenderType, category, draft } = dto;

    let templatePath: string;
    let replacementPlan: ReturnType<typeof buildFailedBidAnnouncementPlan>;
    let typeLabel: string;

    if (category === 'procurement_document') {
      if (tenderType === 'SINGLE_SOURCE') {
        templatePath = path.resolve(
          process.cwd(),
          SINGLE_SOURCE_ANNOUNCEMENT_TEMPLATE_FILE,
        );
        replacementPlan = buildSingleSourceAnnouncementPlan(
          draft as Record<string, string>,
        );
        typeLabel = '单源直接采购公告';
      } else if (tenderType === 'INTERNAL_BIDDING') {
        templatePath = path.resolve(
          process.cwd(),
          INTERNAL_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE,
        );
        replacementPlan = buildInternalBiddingAnnouncementPlan(
          draft as Record<string, string>,
        );
        typeLabel = '内部竞标（竞价）公告';
      } else {
        templatePath = path.resolve(
          process.cwd(),
          INVITED_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE,
        );
        replacementPlan = buildInvitedBiddingAnnouncementPlan(
          draft as Record<string, string>,
        );
        typeLabel = '邀请招标公告';
      }
    } else if (category === 'failed_bid') {
      templatePath = path.resolve(
        process.cwd(),
        FAILED_BID_ANNOUNCEMENT_TEMPLATE_FILE,
      );
      replacementPlan = buildFailedBidAnnouncementPlan(
        draft as Record<string, string>,
      );
      typeLabel = '流标公告';
    } else if (category === 'winning_bid') {
      templatePath = path.resolve(
        process.cwd(),
        WINNING_BID_ANNOUNCEMENT_TEMPLATE_FILE,
      );
      replacementPlan = buildWinningBidAnnouncementPlan(
        draft as Record<string, string>,
      );
      typeLabel = '中标公告';
    } else {
      throw new BadRequestException(`Unknown announcement category: ${category}`);
    }

    const exists = await fs
      .access(templatePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new NotFoundException(`Template not found: ${templatePath}`);
    }

    const originalBuffer = await fs.readFile(templatePath);
    const zip = await JSZip.loadAsync(originalBuffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    if (!documentXml) {
      throw new NotFoundException(
        'Invalid DOCX template: missing word/document.xml',
      );
    }

    // For winning_bid, dynamically adjust the bidder table rows
    let xmlToRender = documentXml;
    if (category === 'winning_bid') {
      xmlToRender = this.adjustWinningBidTableRows(xmlToRender, draft as Record<string, string>);
    }

    const updatedXml = renderTemplateXml(xmlToRender, replacementPlan);
    zip.file('word/document.xml', updatedXml);

    const projectName = (draft as Record<string, string>).projectName?.trim();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = projectName
      ? `${projectName}-${typeLabel}-${dateStr}.docx`
      : `${typeLabel}-${dateStr}.docx`;

    return {
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
      fileName,
    };
  }

  /**
   * Dynamically adjust the bidder table rows in the winning bid DOCX template.
   * - Template has 3 data rows (第一名, 第二名, 第三名).
   * - If fewer bidders: remove extra empty rows.
   * - If more bidders: clone the 3rd row and inject additional rows.
   */
  private adjustWinningBidTableRows(
    xml: string,
    draft: Record<string, string>,
  ): string {
    // Count bidders
    let bidderCount = 0;
    for (let i = 1; i <= 20; i++) {
      const name = draft[`bidder${i}Name`] ?? '';
      const price = draft[`bidder${i}Price`] ?? '';
      if (name.trim() || price.trim()) {
        bidderCount = i;
      }
    }

    if (bidderCount <= 3 && bidderCount > 0) {
      // No structural changes needed — placeholders will be filled/emptied by replacement plan
      // But if fewer than 3, we should delete empty rows to avoid blank rows
      if (bidderCount < 3) {
        // Delete rows for missing bidders (from 3rd row down to bidderCount+1)
        for (let i = 3; i > bidderCount; i--) {
          xml = this.deleteBidderRow(xml, i);
        }
      }
      return xml;
    }

    if (bidderCount > 3) {
      // Get the 3rd row XML as a template for cloning
      const thirdRowXml = this.extractBidderRow(xml, 3);
      if (!thirdRowXml) return xml;

      // Insert additional rows after the 3rd row
      const rankLabels = ['第一名', '第二名', '第三名', '第四名', '第五名', '第六名', '第七名', '第八名', '第九名', '第十名'];
      const insertAfter = this.findBidderRowEnd(xml, 3);
      if (insertAfter === -1) return xml;

      const additionalRows: string[] = [];
      for (let i = 4; i <= bidderCount; i++) {
        const rank = rankLabels[i - 1] ?? `第${i}名`;
        const row = thirdRowXml
          .replace('第三名', rank)
          .replace('{{投标单位3}}', `{{投标单位${i}}}`)
          .replace('{{报价3}}', `{{报价${i}}}`);
        additionalRows.push(row);
      }

      return xml.substring(0, insertAfter) + additionalRows.join('') + xml.substring(insertAfter);
    }

    return xml;
  }

  /** Extract the full <w:tr>...</w:tr> for the Nth bidder data row (1-indexed) */
  private extractBidderRow(xml: string, rowIdx: number): string | null {
    // The bidder rows contain {{投标单位N}} placeholders
    const placeholder = `{{投标单位${rowIdx}}}`;
    const placeholderPos = xml.indexOf(placeholder);
    if (placeholderPos === -1) return null;

    // Find the <w:tr> containing this placeholder
    let trStart = -1;
    for (let i = placeholderPos; i >= 0; i--) {
      if (xml.substring(i, i + 4) === '<w:tr' && (xml[i + 4] === ' ' || xml[i + 4] === '>')) {
        trStart = i;
        break;
      }
    }
    if (trStart === -1) return null;

    const trEnd = xml.indexOf('</w:tr>', trStart);
    if (trEnd === -1) return null;

    return xml.substring(trStart, trEnd + 6);
  }

  /** Find the end position (after </w:tr>) of the Nth bidder row */
  private findBidderRowEnd(xml: string, rowIdx: number): number {
    const placeholder = `{{投标单位${rowIdx}}}`;
    const placeholderPos = xml.indexOf(placeholder);
    if (placeholderPos === -1) return -1;

    let trStart = -1;
    for (let i = placeholderPos; i >= 0; i--) {
      if (xml.substring(i, i + 4) === '<w:tr' && (xml[i + 4] === ' ' || xml[i + 4] === '>')) {
        trStart = i;
        break;
      }
    }
    if (trStart === -1) return -1;

    const trEnd = xml.indexOf('</w:tr>', trStart);
    if (trEnd === -1) return -1;

    return trEnd + 6;
  }

  /** Delete the Nth bidder data row from the XML */
  private deleteBidderRow(xml: string, rowIdx: number): string {
    const placeholder = `{{投标单位${rowIdx}}}`;
    const placeholderPos = xml.indexOf(placeholder);
    if (placeholderPos === -1) return xml;

    let trStart = -1;
    for (let i = placeholderPos; i >= 0; i--) {
      if (xml.substring(i, i + 4) === '<w:tr' && (xml[i + 4] === ' ' || xml[i + 4] === '>')) {
        trStart = i;
        break;
      }
    }
    if (trStart === -1) return xml;

    const trEnd = xml.indexOf('</w:tr>', trStart);
    if (trEnd === -1) return xml;

    return xml.substring(0, trStart) + xml.substring(trEnd + 6);
  }

  /**
   * Parses the "投标情况" table and extracts bidder names + prices.
   * Returns an array of { name, price } objects.
   */
  async importWinningBidFromBuffer(
    fileBuffer: Buffer,
    originalName?: string,
  ): Promise<Array<{ name: string; price: string }>> {
    const safeName = originalName || 'unknown.pdf';
    const ext = path.extname(safeName).toLowerCase();
    if (ext !== '.pdf') {
      throw new BadRequestException('请上传 PDF 格式的定标审批表文件。');
    }

    const pdfData = await pdfParse(fileBuffer);
    const text = pdfData.text;

    if (!text || text.length < 20) {
      throw new BadRequestException(
        '定标审批表文件未提取到足够文本内容，可能为扫描件。',
      );
    }

    return this.parseWinningBidFromText(text);
  }

  /**
   * Parse bidder names and review prices (评审报价) from the PDF text.
   * Supports two PDF text layouts:
   *   Format A (multi-line): "1\n公司名\n投标报价评审报价"
   *   Format B (single-line): "1公司名投标报价评审报价"
   * Extracts the second price (评审报价), not the first (投标报价).
   */
  private parseWinningBidFromText(
    text: string,
  ): Array<{ name: string; price: string }> {
    const result: Array<{ name: string; price: string }> = [];

    // Try two section patterns to find the bid table:
    // Pattern A: "投标情况" header (older format)
    // Pattern B: "投标人名称投标报价" table header (newer format)
    let sectionMatch = text.match(
      /投标情况\s*([\s\S]*?)(?=评标委员会意见|附件|$)/,
    );
    if (!sectionMatch) {
      // Fallback: find from "投标人名称" table header
      sectionMatch = text.match(
        /投标人名称[^]*?\n([\s\S]*?)(?=评标委员会意见|附件|流转意见|$)/,
      );
    }
    if (!sectionMatch) {
      this.logger.warn('未在PDF中找到投标情况表格');
      return result;
    }

    const section = sectionMatch[1];

    // Split into lines, strip empty ones
    const lines = section
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // ── Format B: single-line entries ──
    // "1四川雏雁…140120.00136400.00"
    // Pattern: row number + non-digit chars (name) + two concatenated prices
    const singleLinePattern =
      /^(\d)([^\d]+?)(\d+\.\d{2})(\d+\.\d{2})$/;

    // ── Format A: multi-line (number on its own line) ──
    let i = 0;
    while (i < lines.length) {
      // Try Format B first: entire entry on one line
      const singleMatch = lines[i].match(singleLinePattern);
      if (singleMatch) {
        const name = singleMatch[2].trim();
        // Group 4 = second price = 评审报价
        const reviewPrice = singleMatch[4];
        if (name && reviewPrice) {
          result.push({ name, price: reviewPrice });
        }
        i++;
        continue;
      }

      // Format A: standalone row number on its own line
      if (/^\d+$/.test(lines[i])) {
        i++;
        // Collect company name lines (non-price lines)
        const nameParts: string[] = [];
        while (
          i < lines.length &&
          !/^\d+[\d.]+$/.test(lines[i]) &&
          !singleLinePattern.test(lines[i])
        ) {
          nameParts.push(lines[i]);
          i++;
        }
        const name = nameParts.join('').trim();

        // Collect price line
        if (i < lines.length && /^\d+[\d.]+$/.test(lines[i])) {
          const priceLine = lines[i];
          i++;

          // Extract the second price (评审报价) from concatenated format
          // "233600.00229000.00" → first=233600.00, second=229000.00
          const twoPricesMatch = priceLine.match(
            /(\d+\.\d{2})(\d+\.\d{2})$/,
          );
          const reviewPrice = twoPricesMatch
            ? twoPricesMatch[2]
            : '';

          if (name && reviewPrice) {
            result.push({ name, price: reviewPrice });
          }
        }
      } else {
        i++;
      }
    }

    this.logger.log(
      `Parsed ${result.length} bidders from PDF: ${result.map((b) => b.name + '=' + b.price).join(', ')}`,
    );

    return result;
  }

  /**
   * Extract notification letter fields from a 定标审批表 PDF.
   * Returns projectName, winnerName, winnerPrice.
   */
  async extractNotificationDataFromBuffer(
    fileBuffer: Buffer,
    originalName?: string,
  ): Promise<{
    projectName: string;
    winnerName: string;
    winnerPrice: string;
    department: string;
    controlPrice: string;
    extractedText: string;
  }> {
    const safeName = originalName || 'unknown.pdf';
    const ext = path.extname(safeName).toLowerCase();
    if (ext !== '.pdf') {
      throw new BadRequestException('请上传 PDF 格式的定标审批表文件。');
    }

    const pdfData = await pdfParse(fileBuffer);
    const text = pdfData.text;

    if (!text || text.length < 20) {
      throw new BadRequestException(
        '定标审批表文件未提取到足够文本内容，可能为扫描件。',
      );
    }

    // Extract bidders using existing logic
    const bidders = this.parseWinningBidFromText(text);
    const winnerName = bidders.length > 0 ? bidders[0].name : '';
    const winnerPrice = bidders.length > 0 ? bidders[0].price : '';

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    // --- Extract project name ---
    let projectName = '';

    // Pattern 1: Old format — "申请采购事项名称" label, value on the next line
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].includes('申请采购事项名称')) {
        projectName = lines[i + 1].trim();
        break;
      }
    }

    // Pattern 2: New format — project name appears before standalone "是"/"否"
    if (!projectName) {
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^(是|否)$/.test(lines[i + 1])) {
          const candidate = lines[i];
          if (
            candidate.length >= 4 &&
            !/^(序号|定标|申请|是否|需求|日期|所属|拟采|经办|附件|备注|采购控制)/.test(
              candidate,
            )
          ) {
            projectName = candidate;
            break;
          }
        }
      }
    }

    // --- Extract 控制价 ---
    let controlPrice = '';
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].includes('采购控制价')) {
        const next = lines[i + 1].trim();
        if (/^\d+[\d.]*$/.test(next)) {
          controlPrice = next;
        }
        break;
      }
    }

    // --- Extract 需求部门 ---
    // The department is 1-2 lines right before the line containing "公开招标"
    let department = '';
    const methodLineIdx = lines.findIndex((l) => l.startsWith('公开招标'));
    if (methodLineIdx > 0) {
      let dept = lines[methodLineIdx - 1];
      // If previous line also looks like a department continuation (contains "/" or partial), join
      if (methodLineIdx >= 2 && lines[methodLineIdx - 2].includes('/')) {
        dept = lines[methodLineIdx - 2] + dept;
      }
      department = dept;
    }

    this.logger.log(
      `Extracted notification data: projectName="${projectName}", winnerName="${winnerName}", winnerPrice="${winnerPrice}", department="${department}", controlPrice="${controlPrice}"`,
    );

    return { projectName, winnerName, winnerPrice, department, controlPrice, extractedText: text };
  }

  /**
   * Generate a 中标通知书 DOCX from the notification letter template.
   */
  async exportNotificationLetter(dto: ExportNotificationLetterDto) {
    const templatePath = path.resolve(
      process.cwd(),
      NOTIFICATION_LETTER_TEMPLATE_FILE,
    );

    const exists = await fs
      .access(templatePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new NotFoundException(`Template not found: ${templatePath}`);
    }

    const originalBuffer = await fs.readFile(templatePath);
    const zip = await JSZip.loadAsync(originalBuffer);
    const documentXml = await zip.file('word/document.xml')?.async('string');

    if (!documentXml) {
      throw new NotFoundException(
        'Invalid DOCX template: missing word/document.xml',
      );
    }

    const replacementPlan = buildNotificationLetterPlan(dto);
    const updatedXml = renderTemplateXml(documentXml, replacementPlan);
    zip.file('word/document.xml', updatedXml);

    const dateStr = new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    const fileName = dto.projectName?.trim()
      ? `${dto.projectName.trim()}-中标通知书-${dateStr}.docx`
      : `中标通知书-${dateStr}.docx`;

    return {
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
      fileName,
    };
  }

  /**
   * Generate 中标通知书台账 Excel by appending a row to the template.
   */
  async exportNotificationLedger(dto: ExportNotificationLetterDto) {
    const templatePath = path.resolve(
      process.cwd(),
      '模板文件/中标通知书台账.xlsx',
    );

    const exists = await fs
      .access(templatePath)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new NotFoundException(`Template not found: ${templatePath}`);
    }

    const workbook = XLSX.read(readFileSync(templatePath), { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
    });

    // Find the first empty row (after header row 1 and existing data rows)
    let insertRow = 2; // data starts at row index 2 (0-based)
    for (let i = 2; i < data.length; i++) {
      const row = data[i];
      // Check if row has any non-empty cell in the first 11 columns
      const hasData = row
        .slice(0, 11)
        .some((cell) => cell !== '' && cell !== null && cell !== undefined);
      if (!hasData) {
        insertRow = i;
        break;
      }
      insertRow = i + 1;
    }

    // Format date: "2026.6.10" style from signatureDate (supports YYYY-MM-DD and YYYY年M月D日)
    let formattedDate = '';
    if (dto.signatureDate) {
      // Try Chinese format: "2026年6月10日"
      const chineseMatch = dto.signatureDate.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (chineseMatch) {
        formattedDate = `${chineseMatch[1]}.${parseInt(chineseMatch[2], 10)}.${parseInt(chineseMatch[3], 10)}`;
      } else {
        const d = new Date(dto.signatureDate);
        if (!isNaN(d.getTime())) {
          formattedDate = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
        }
      }
    }

    // Auto-increment 序号
    const seqNo = insertRow - 1; // row 2 = seq 1, row 3 = seq 2, etc.

    // Build the row: 序号,时间,类别,项目,项目名称,中标公司,需求部门,控制价,中标价（元）,采购方式,备注
    const newRow: unknown[] = [
      seqNo,
      formattedDate,
      dto.category || '',
      dto.project || '',
      dto.projectName || '',
      dto.winnerName || '',
      dto.department || '',
      dto.controlPrice ? parseFloat(dto.controlPrice) : '',
      dto.winnerPrice ? parseFloat(dto.winnerPrice) : '',
      dto.procurementMethod || '',
      dto.remark || '',
    ];

    data[insertRow] = newRow;

    // Rebuild worksheet from data
    const newWorksheet = XLSX.utils.aoa_to_sheet(data);

    // Copy column widths from original if available
    if (worksheet['!cols']) {
      newWorksheet['!cols'] = worksheet['!cols'];
    }

    workbook.Sheets[sheetName] = newWorksheet;

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const dateStr = new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    const fileName = `中标通知书台账-${dateStr}.xlsx`;

    return { buffer, fileName };
  }

  /** Read ledger Excel and return data rows as JSON */
  async getNotificationLedger() {
    const templatePath = path.resolve(
      process.cwd(),
      '模板文件/中标通知书台账.xlsx',
    );

    if (!existsSync(templatePath)) {
      // Return empty ledger with default structure
      return [];
    }

    const workbook = XLSX.read(readFileSync(templatePath), { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
    });

    // Return only data rows (skip title row 0 and header row 1)
    const rows = data
      .slice(2)
      .filter((row) =>
        row.slice(0, 11).some((cell) => cell !== '' && cell !== null && cell !== undefined),
      );

    return rows;
  }

  /** Update ledger with edited rows and return the Excel buffer */
  async updateAndExportNotificationLedger(rows: unknown[][]) {
    const templatePath = path.resolve(
      process.cwd(),
      '模板文件/中标通知书台账.xlsx',
    );

    if (!existsSync(templatePath)) {
      throw new NotFoundException(`Template not found: ${templatePath}`);
    }

    const workbook = XLSX.read(readFileSync(templatePath), { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Preserve title row (0) and header row (1)
    const titleRow: unknown[] = ['中标通知书台账', ...Array(13).fill('')];
    const headerRow: unknown[] = [
      '序号', '时间', '类别', '项目', '项目名称', '中标公司',
      '需求部门', '控制价', '中标价（元）', '采购方式', '备注',
      '', '', '',
    ];

    const newData = [titleRow, headerRow, ...rows];
    const newWorksheet = XLSX.utils.aoa_to_sheet(newData);

    if (worksheet['!cols']) {
      newWorksheet['!cols'] = worksheet['!cols'];
    }

    workbook.Sheets[sheetName] = newWorksheet;

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `中标通知书台账-${dateStr}.xlsx`;

    return { buffer, fileName };
  }
}
