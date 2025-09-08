// types/pdf-parse.d.ts

declare module "pdf-parse" {
  export interface PDFParseResult {
    text?: string;
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }

  export type PdfParse = (
    data: Buffer | Uint8Array,
    options?: { max?: number } | undefined
  ) => Promise<PDFParseResult>;

  const pdfParse: PdfParse;
  export default pdfParse;
}

declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse, { PdfParse, PDFParseResult } from "pdf-parse";
  export type { PdfParse, PDFParseResult };
  export default pdfParse;
}
