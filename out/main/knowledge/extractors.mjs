import { load } from "cheerio";
import { strFromU8, unzipSync } from "fflate";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OFFICE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif"]);
const IMAGE_MIME_EXTENSIONS = new Map([
  ["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/bmp", ".bmp"],
  ["image/webp", ".webp"], ["image/gif", ".gif"],
]);
const UNSUPPORTED_BINARY_EXTENSIONS = new Set([".doc", ".ppt", ".xls", ".xlsm", ".epub", ".mobi", ".rtf"]);
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PAGES = 100;
const MAX_OFFICE_XML_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 1_000;
const MAX_EXTRACTED_CHARACTERS = 25_000_000;
const MIN_PDF_PAGE_TEXT_CHARACTERS = 20;

export async function extractUploadedDocument(bytes, filename, contentType = "application/octet-stream", options = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("知识库文件为空或超过 30 MB 限制。");
  }
  const extension = extensionOf(filename);
  const normalizedContentType = String(contentType || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  let text;
  let mediaType = normalizedContentType;
  if (extension === ".pdf" || normalizedContentType === "application/pdf") {
    const pdf = await extractPdf(new Uint8Array(bytes));
    text = pdf.text;
    const mostlyScanned = pdf.extractedCharacters < Math.max(20, pdf.pages * 8);
    if (mostlyScanned || pdf.pagesNeedingOcr.length > 0) {
      if (!options.ocr) throw new Error("扫描版 PDF 需要本地 PaddleOCR 组件。");
      try {
        const ocrText = await options.ocr.recognizePdf(bytes, mostlyScanned ? {} : { pages: pdf.pagesNeedingOcr });
        text = mostlyScanned
          ? ocrText
          : mergePdfOcrPages(pdf, ocrText);
      } catch (error) {
        if (mostlyScanned) throw error;
        console.warn("[knowledge] Partial PDF OCR failed; preserving searchable text pages:", error?.message ?? String(error));
        const pageList = pdf.pagesNeedingOcr.join("、");
        text = `${pdf.text}\n\n[OCR 未完成]\n第 ${pageList} 页包含扫描内容；已保留其余文本页，请修复本地 OCR 组件后重新导入。`;
      }
    }
    mediaType = "application/pdf";
  } else if (OFFICE_EXTENSIONS.has(extension)) {
    text = extractOffice(new Uint8Array(bytes), extension);
    mediaType = "application/vnd.openxmlformats-officedocument";
  } else if (IMAGE_EXTENSIONS.has(extension) || normalizedContentType.startsWith("image/")) {
    if (!options.ocr?.recognizeImage) throw new Error("图片知识文档需要本地 PaddleOCR 组件。");
    let ocrExtension = IMAGE_MIME_EXTENSIONS.get(normalizedContentType)
      ?? (IMAGE_EXTENSIONS.has(extension) ? extension : null);
    if (!ocrExtension) throw new Error("图片知识文档仅支持 PNG、JPEG、BMP、WebP 或 GIF。");
    const preparedImage = await prepareImageForOcr(bytes, ocrExtension);
    const ocrBytes = preparedImage.bytes;
    ocrExtension = preparedImage.extension;
    text = await options.ocr.recognizeImage(ocrBytes, ocrExtension);
    mediaType = normalizedContentType.startsWith("image/") ? normalizedContentType : "image/*";
  } else if (UNSUPPORTED_BINARY_EXTENSIONS.has(extension)) {
    throw new Error(`暂不支持旧版或封装型二进制格式 ${extension}；请另存为 PDF、DOCX、PPTX、XLSX 或纯文本后重试。`);
  } else {
    const decoded = decodePlainText(bytes);
    text = extension === ".html" || extension === ".htm" || normalizedContentType === "text/html"
      ? extractHtml(decoded)
      : decoded;
  }
  const normalized = text.replace(/\u0000/g, "").trim();
  if (normalized.length > MAX_EXTRACTED_CHARACTERS) throw new Error("提取后的文本超过安全索引限制。");
  if (!normalized) throw new Error("没有从文件中提取到可检索文本。");
  return { title: String(filename || "未命名文档"), text: normalized, mediaType };
}

async function prepareImageForOcr(bytes, extension) {
  let pipeline;
  let metadata;
  try {
    pipeline = sharp(bytes, { animated: false, failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS });
    metadata = await pipeline.metadata();
  } catch {
    throw new Error("图片损坏、格式不受支持或解码像素超过安全限制。");
  }
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const pages = Math.max(1, Number(metadata.pages) || 1);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0
    || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || pages > MAX_IMAGE_PAGES
    || width * height * pages > MAX_IMAGE_PIXELS) {
    throw new Error("图片尺寸或动画帧数超过 OCR 安全限制（最多约 2000 万像素）。");
  }
  if (extension === ".gif") {
    return { bytes: await pipeline.png().toBuffer(), extension: ".png" };
  }
  return { bytes, extension };
}

function extractOffice(buffer, extension) {
  const matchesContent = (name) => {
    if (extension === ".docx") return /^word\/(?:document|header\d*|footer\d*|comments)\.xml$/i.test(name);
    if (extension === ".pptx") return /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i.test(name);
    if (extension === ".xlsx") return /^xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml$/i.test(name);
    return false;
  };
  let selectedExpandedBytes = 0;
  const archive = unzipSync(buffer, {
    filter: (file) => {
      if (!matchesContent(file.name)) return false;
      selectedExpandedBytes += file.originalSize;
      if (selectedExpandedBytes > MAX_OFFICE_XML_BYTES) throw new Error("Office 文档解压后的文本超过安全限制。");
      return true;
    },
  });
  return Object.keys(archive)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((name) => decodeXml(strFromU8(archive[name])))
    .filter(Boolean)
    .join("\n\n");
}

function decodeXml(value) {
  const structured = String(value)
    .replace(/<(?:w:br|w:tab|a:br)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/(?:w:p|a:p|row|si|comment)>/gi, "$&\n");
  const $ = load(structured, { xmlMode: true });
  $("script,style").remove();
  return $.root().text().replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractHtml(value) {
  const $ = load(value);
  $("script,style,noscript,svg,nav,footer").remove();
  return $("body").text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const imageOperations = new Set([
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageXObjectRepeat,
    pdfjs.OPS.paintSolidColorImageMask,
  ].filter(Number.isInteger));
  const standardFontDataUrl = `${fileURLToPath(new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)).replaceAll("\\", "/")}/`;
  const loadingTask = pdfjs.getDocument({ data: buffer, useWorkerFetch: false, standardFontDataUrl });
  const document = await loadingTask.promise;
  if (document.numPages > MAX_PDF_PAGES) {
    await loadingTask.destroy();
    throw new Error(`PDF 超过 ${MAX_PDF_PAGES} 页限制。`);
  }
  const pages = [];
  const pageTexts = [];
  const pagesNeedingOcr = [];
  let extractedCharacters = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = formatPdfTextItems(content.items);
      const visibleCharacters = pageText.replace(/\s/g, "").length;
      if (visibleCharacters < MIN_PDF_PAGE_TEXT_CHARACTERS) {
        const operators = await page.getOperatorList();
        if (operators.fnArray.some((operation) => imageOperations.has(operation))) {
          pagesNeedingOcr.push(pageNumber);
        }
      }
      extractedCharacters += pageText.length;
      if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) throw new Error("PDF 文本超过安全索引限制。");
      pageTexts.push(pageText);
      pages.push(`[第 ${pageNumber} 页]\n${pageText}`);
    }
  } finally {
    await loadingTask.destroy();
  }
  return {
    text: pages.join("\n\n"),
    pageTexts,
    pagesNeedingOcr,
    extractedCharacters,
    pages: document.numPages,
  };
}

function mergePdfOcrPages(pdf, ocrText) {
  const ocrPages = parseNumberedPdfPages(ocrText);
  if (pdf.pagesNeedingOcr.every((pageNumber) => ocrPages.has(pageNumber))) {
    const replacements = new Set(pdf.pagesNeedingOcr);
    return pdf.pageTexts.map((pageText, index) => {
      const pageNumber = index + 1;
      const selectedText = replacements.has(pageNumber) ? ocrPages.get(pageNumber) : pageText;
      return `[第 ${pageNumber} 页]\n${selectedText}`;
    }).join("\n\n");
  }
  return `${pdf.text}\n\n[OCR 补充]\n${String(ocrText).trim()}`;
}

function parseNumberedPdfPages(value) {
  const text = String(value ?? "");
  const marker = /^\[第\s*(\d+)\s*页\]\s*$/gm;
  const matches = [...text.matchAll(marker)];
  const pages = new Map();
  matches.forEach((match, index) => {
    const pageNumber = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    if (Number.isSafeInteger(pageNumber) && pageNumber > 0) {
      pages.set(pageNumber, text.slice(start, end).trim());
    }
  });
  return pages;
}

function formatPdfTextItems(items) {
  const lines = [];
  let current = "";
  let previousY = null;
  const push = () => {
    const value = current.replace(/[ \t]+/g, " ").trim();
    if (value) lines.push(value);
    current = "";
  };
  for (const item of items) {
    if (!("str" in item) || !item.str) continue;
    const y = Number(item.transform?.[5]);
    if (previousY !== null && Number.isFinite(y) && Math.abs(y - previousY) > 2) push();
    current += `${current ? " " : ""}${item.str}`;
    if (item.hasEOL) {
      push();
      previousY = null;
    } else if (Number.isFinite(y)) {
      previousY = y;
    }
  }
  push();
  return lines.join("\n");
}

function decodePlainText(bytes) {
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("文件不是有效的 UTF-8 文本，也不是当前支持的文档格式。");
  }
  const controlCount = [...decoded].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  }).length;
  if (controlCount > Math.max(8, decoded.length * 0.01)) {
    throw new Error("文件包含大量二进制控制字符，无法作为文本知识解析。");
  }
  return decoded;
}

function extensionOf(filename) {
  const match = String(filename ?? "").toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}
