import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  PageBreak,
} from 'docx';
import JSZip = require('jszip');

export interface FixtureOpts {
  paragraphs?: Array<{ text: string; bold?: boolean; italic?: boolean }>;
  heading?: { text: string; level: (typeof HeadingLevel)[keyof typeof HeadingLevel] };
  table?: string[][];
  pageBreakBetween?: boolean;
}

export async function buildFixtureDocx(opts: FixtureOpts = {}): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];

  if (opts.heading) {
    children.push(
      new Paragraph({ text: opts.heading.text, heading: opts.heading.level }),
    );
  }

  for (const p of opts.paragraphs ?? []) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: p.text, bold: p.bold, italics: p.italic }),
        ],
      }),
    );
  }

  if (opts.table) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: opts.table.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun(cell)] }),
                    ],
                  }),
              ),
            }),
        ),
      }),
    );
  }

  if (opts.pageBreakBetween) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc) as unknown as Promise<Buffer>;
}

export async function readDocumentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('fixture missing word/document.xml');
  return f.async('string');
}
