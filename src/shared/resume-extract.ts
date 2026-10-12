// Resume file -> plain text, on device. PDF text comes from pdf.js (loaded only when a
// PDF is chosen); DOCX is a zip of XML, read with the browser's built-in inflate.
// Nothing leaves the extension page.

const decoder = new TextDecoder();

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, dec, hex, name) =>
    name ? (ENTITIES[name.toLowerCase()] ?? "") : String.fromCodePoint(dec ? +dec : parseInt(hex, 16)),
  );

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Reads the named entries from a zip using its central directory (sizes in local
// headers can be zero for streamed archives).
export async function readZipEntries(
  buf: ArrayBuffer,
  want: (name: string) => boolean,
): Promise<Record<string, Uint8Array>> {
  const view = new DataView(buf),
    bytes = new Uint8Array(buf),
    out: Record<string, Uint8Array> = {};
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file is not a valid DOCX.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true),
      size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true),
      extraLen = view.getUint16(p + 30, true),
      commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    out[name] = method === 0 ? data : method === 8 ? await inflateRaw(data) : new Uint8Array();
  }
  return out;
}

export function docxXmlToText(xml: string): string {
  return decodeXml(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, " \t ")
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]*>/g, ""),
  );
}

async function docxText(buf: ArrayBuffer): Promise<string> {
  const files = await readZipEntries(buf, (n) => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(n));
  const part = (re: RegExp) =>
    Object.keys(files)
      .filter((n) => re.test(n))
      .sort()
      .map((n) => docxXmlToText(decoder.decode(files[n])));
  // Contact details often live in the page header, so it goes first.
  return [...part(/header/), ...part(/document/), ...part(/footer/)].join("\n");
}

type PdfItem = { str: string; transform: number[]; hasEOL?: boolean };

// Joins pdf.js text runs into lines: same baseline = same line, left to right.
export function pdfItemsToText(pages: PdfItem[][]): string {
  const lines: string[] = [];
  for (const items of pages) {
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of items) {
      if (!it.str.trim()) continue;
      const x = it.transform[4] ?? 0,
        y = it.transform[5] ?? 0;
      const row = rows.find((r) => Math.abs(r.y - y) < 3);
      if (row) row.parts.push({ x, s: it.str });
      else rows.push({ y, parts: [{ x, s: it.str }] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.parts.sort((a, b) => a.x - b.x);
      let line = "";
      for (const part of row.parts) line += (line && !/\s$/.test(line) && !/^\s/.test(part.s) ? " " : "") + part.s;
      lines.push(line);
    }
  }
  return lines.join("\n");
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false } as Parameters<
    typeof pdfjs.getDocument
  >[0]).promise;
  const pages: PdfItem[][] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push((content.items as unknown[]).filter((it): it is PdfItem => typeof (it as PdfItem).str === "string"));
  }
  await doc.destroy();
  return pdfItemsToText(pages);
}

export async function extractResumeText(file: Blob & { name?: string }): Promise<string> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, 4);
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (!isPdf && !isZip) throw new Error("Avid can read PDF and DOCX resumes. Older .doc files are not supported.");
  const text = isPdf ? await pdfText(buf) : await docxText(buf);
  if (!text.trim())
    throw new Error("No text found. This looks like a scanned image. Fill your details in by hand instead.");
  return text;
}

(globalThis as any).AvidAutofill = Object.assign((globalThis as any).AvidAutofill || {}, { extractResumeText });
