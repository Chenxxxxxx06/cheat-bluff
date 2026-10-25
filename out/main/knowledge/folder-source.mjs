import { createHash } from "node:crypto";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, extname, isAbsolute, posix, relative, resolve } from "node:path";
import { analyzeSourceFile } from "./code-source.mjs";
import { extractUploadedDocument } from "./extractors.mjs";

const MAX_FILES = 180;
const MAX_DISCOVERED_FILES = 2_000;
const MAX_DIRECTORIES = 500;
const MAX_DIRECTORY_ENTRIES = 4_000;
const MAX_DEPTH = 12;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 160 * 1024 * 1024;
const MAX_FILE_CHARACTERS = 240_000;
const MAX_TOTAL_CHARACTERS = 2_500_000;
const MAX_SKIPPED_EXAMPLES = 40;
export const FOLDER_FILE_SENTINEL_PREFIX = "<!-- CHEATER_INTERNAL_FOLDER_FILE:";
const FOLDER_FILE_SENTINEL_SUFFIX = " -->";
const nodeRequire = createRequire(import.meta.url);
let windowsFileAttributeLibrary = null;
let getWindowsFileAttributes = null;
let windowsFilePathLibrary = null;
let windowsRuntimeLibrary = null;
let getWindowsOsFileHandle = null;
let getWindowsFinalPathName = null;

const BINARY_DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".pptx", ".xlsx"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif"]);
const TEXT_DOCUMENT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json", ".jsonl", ".xml", ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".properties", ".log", ".rst", ".adoc", ".tex",
]);
const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte", ".py", ".java", ".kt", ".kts",
  ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift", ".scala",
  ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".sql", ".graphql", ".gql", ".html", ".css",
  ".scss", ".less", ".xml", ".yaml", ".yml", ".toml", ".ini",
]);
const CODE_FILENAMES = new Set([
  "dockerfile", "makefile", "rakefile", "gemfile", "procfile", "jenkinsfile", "package.json", "tsconfig.json",
  "pyproject.toml", "requirements.txt", "go.mod", "go.sum", "cargo.toml", "pom.xml", "build.gradle",
  "docker-compose.yml", "docker-compose.yaml", ".env.example",
]);
const SKIPPED_DIRECTORIES = new Set([
  ".git", ".svn", ".hg", ".idea", ".vscode", ".obsidian", "node_modules", "vendor", "dist", "build",
  "coverage", ".next", ".nuxt", ".cache", "target", "bin", "obj", "__pycache__", ".venv", "venv",
  "site-packages", "deriveddata", "pods",
]);

export async function scanKnowledgeFolder(directoryPath, options = {}) {
  const fileLimit = Math.min(1000, Math.max(1, options.maxFiles ?? MAX_FILES));
  const characterLimit = Math.min(12_000_000, Math.max(1, options.maxCharacters ?? MAX_TOTAL_CHARACTERS));
  const requestedPath = String(directoryPath ?? "").trim();
  if (!requestedPath) throw new Error("请选择一个本地文件夹。");
  const root = resolve(requestedPath);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("请选择一个普通本地文件夹。");
  let canonicalRoot;
  try {
    canonicalRoot = normalizeCanonicalPath(await realpath(root));
  } catch {
    throw new Error("无法验证所选文件夹的真实路径，已停止扫描以保护隐私。");
  }

  const candidates = [];
  const skipped = [];
  const skippedReasons = {};
  let discoveredFileCount = 0;
  let visitedDirectoryCount = 0;
  let limitReached = false;

  const noteSkipped = (path, reason) => {
    skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    if (skipped.length < MAX_SKIPPED_EXAMPLES) skipped.push({ path, reason });
  };

  const walk = async (directory, depth) => {
    options.signal?.throwIfAborted();
    if (discoveredFileCount >= MAX_DISCOVERED_FILES) {
      limitReached = true;
      return;
    }
    if (depth > MAX_DEPTH) {
      noteSkipped(normalizeRelativePath(root, directory) || basename(directory), "目录层级过深");
      return;
    }
    if (visitedDirectoryCount >= MAX_DIRECTORIES) {
      noteSkipped(normalizeRelativePath(root, directory) || basename(directory), "目录数量超过限制");
      limitReached = true;
      return;
    }
    visitedDirectoryCount += 1;
    const entries = [];
    try {
      const directoryHandle = await opendir(directory);
      for await (const entry of directoryHandle) {
        if (entries.length >= MAX_DIRECTORY_ENTRIES) {
          noteSkipped(normalizeRelativePath(root, directory) || basename(directory), "单个目录条目超过限制");
          limitReached = true;
          break;
        }
        entries.push(entry);
      }
    } catch {
      noteSkipped(normalizeRelativePath(root, directory) || basename(directory), "目录不可读取");
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
    for (const entry of entries) {
      if (discoveredFileCount >= MAX_DISCOVERED_FILES) {
        limitReached = true;
        break;
      }
      const absolutePath = resolve(directory, entry.name);
      const relativePath = normalizeRelativePath(root, absolutePath);
      if (!relativePath) continue;
      if (entry.isSymbolicLink()) {
        noteSkipped(relativePath, "已跳过符号链接");
        continue;
      }
      const unsafeWindowsAttribute = windowsUnsafeAttributeReason(absolutePath);
      if (unsafeWindowsAttribute) {
        noteSkipped(relativePath, unsafeWindowsAttribute);
        continue;
      }
      if (entry.isDirectory()) {
        const lowerName = entry.name.toLowerCase();
        if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(lowerName)) {
          noteSkipped(relativePath, "已忽略的目录");
          continue;
        }
        try {
          const directoryStats = await lstat(absolutePath);
          if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
            noteSkipped(relativePath, "已跳过目录链接");
            continue;
          }
        } catch {
          noteSkipped(relativePath, "目录已不可用");
          continue;
        }
        await walk(absolutePath, depth + 1);
        continue;
      }
      if (entry.name.startsWith(".")) {
        noteSkipped(relativePath, "已忽略的隐藏文件");
        continue;
      }
      if (!entry.isFile()) {
        noteSkipped(relativePath, "不是普通文件");
        continue;
      }
      if (discoveredFileCount >= MAX_DISCOVERED_FILES) {
        noteSkipped(relativePath, "扫描文件数量超过限制");
        limitReached = true;
        break;
      }
      discoveredFileCount += 1;
      const kind = classifyKnowledgeFile(relativePath);
      if (!kind) {
        noteSkipped(relativePath, "不支持的格式");
        continue;
      }
      candidates.push({ absolutePath, relativePath, kind });
    }
  };

  await walk(root, 0);

  const files = [];
  let totalInputBytes = 0;
  let totalCharacters = 0;
  let truncatedFileCount = 0;
  for (const candidate of candidates) {
    options.signal?.throwIfAborted();
    if (files.length >= fileLimit) {
      limitReached = true;
      break;
    }
    let initialStats;
    try {
      initialStats = await lstat(candidate.absolutePath, { bigint: true });
    } catch {
      noteSkipped(candidate.relativePath, "文件已不可用");
      continue;
    }
    if (!initialStats.isFile() || initialStats.isSymbolicLink()) {
      noteSkipped(candidate.relativePath, "文件在扫描期间发生变化");
      continue;
    }
    const byteLimit = candidate.kind === "document" || candidate.kind === "image"
      ? MAX_BINARY_FILE_BYTES
      : MAX_TEXT_FILE_BYTES;
    if (initialStats.size <= 0n) {
      noteSkipped(candidate.relativePath, "空文件");
      continue;
    }
    if (initialStats.size > BigInt(byteLimit)) {
      noteSkipped(candidate.relativePath, "文件过大");
      continue;
    }
    let fileHandle = null;
    try {
      fileHandle = await open(candidate.absolutePath, "r");
      const openedStats = await fileHandle.stat({ bigint: true });
      if (!openedStats.isFile()
        || openedStats.dev !== initialStats.dev
        || openedStats.ino !== initialStats.ino) {
        throw new Error("文件在扫描期间被替换或变成链接");
      }
      let openedCanonicalPath;
      try {
        openedCanonicalPath = normalizeCanonicalPath(await canonicalPathForOpenedFile(fileHandle, candidate.absolutePath));
      } catch {
        throw new Error("无法验证已打开文件仍位于所选目录");
      }
      if (!isPathWithinCanonicalRoot(canonicalRoot, openedCanonicalPath)) {
        throw new Error("已打开文件超出所选目录，已跳过");
      }
      if (openedStats.size <= 0n) throw new Error("空文件");
      if (openedStats.size > BigInt(byteLimit)) throw new Error("文件在扫描期间增大并超过限制");
      const openedSize = Number(openedStats.size);
      if (totalInputBytes + openedSize > MAX_TOTAL_INPUT_BYTES) {
        noteSkipped(candidate.relativePath, "文件夹总容量超过限制");
        limitReached = true;
        continue;
      }
      totalInputBytes += openedSize;
      const bytes = await readBoundedFile(fileHandle, openedSize);
      const rawHash = createHash("sha256").update(bytes).digest("hex");
      const cached = options.cachedFiles?.get(candidate.relativePath);
      const extracted = cached?.rawHash === rawHash && cached.content
        ? { text: cached.content, mediaType: cached.mediaType }
        : await extractCandidate(bytes, candidate, options.ocr);
      let content = extracted.text.replace(/\u0000/g, "").trim();
      if (!content) throw new Error("没有可检索文字");
      let truncated = Boolean(cached?.rawHash === rawHash && cached.truncated);
      if (content.length > MAX_FILE_CHARACTERS) {
        content = content.slice(0, MAX_FILE_CHARACTERS);
        truncated = true;
      }
      const remainingCharacters = characterLimit - totalCharacters;
      if (remainingCharacters <= 0) {
        noteSkipped(candidate.relativePath, "可索引文字总量超过限制");
        limitReached = true;
        continue;
      }
      if (content.length > remainingCharacters) {
        content = content.slice(0, remainingCharacters);
        truncated = true;
        limitReached = true;
      }
      totalCharacters += content.length;
      if (truncated) truncatedFileCount += 1;
      const importedFile = {
        path: candidate.relativePath,
        content,
        kind: candidate.kind === "code" ? "code" : "document",
        mediaType: extracted.mediaType,
        sizeBytes: bytes.byteLength,
        truncated,
        rawHash,
      };
      await options.onFile?.(importedFile, { processed: files.length + 1, total: candidates.length });
      files.push(importedFile);
    } catch (error) {
      noteSkipped(candidate.relativePath, cleanScanError(error));
    } finally {
      await fileHandle?.close().catch(() => undefined);
    }
  }

  options.signal?.throwIfAborted();

  if (!files.length) {
    const detail = Object.entries(skippedReasons).map(([reason, count]) => `${reason} ${count} 个`).join("、");
    throw new Error(`文件夹中没有可导入内容${detail ? `（${detail}）` : ""}。`);
  }

  return {
    name: basename(root).slice(0, 200) || "本地文件夹",
    folderIdentity: createHash("sha256").update(process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot).digest("hex"),
    files,
    summary: {
      discoveredFileCount,
      importedFileCount: files.length,
      skippedFileCount: Object.values(skippedReasons).reduce((sum, count) => sum + count, 0),
      truncatedFileCount,
      codeFileCount: files.filter((file) => file.kind === "code").length,
      documentFileCount: files.filter((file) => file.kind !== "code").length,
      totalInputBytes,
      totalCharacters,
      limitReached,
      skippedReasons,
    },
    skipped,
  };
}

export function buildFolderEvidenceDocument(input = {}) {
  const name = cleanName(input.name, "本地文件夹");
  const files = normalizeFolderFiles(input.files);
  const folderIdentity = /^[a-f0-9]{64}$/i.test(String(input.folderIdentity ?? ""))
    ? String(input.folderIdentity).toLowerCase()
    : null;
  const blocks = [
    `# 文件夹知识库：${name}`,
    "说明：以下内容来自用户主动选择的本地文件夹；相对路径和证据 ID 用于回答时回溯来源。",
  ];
  for (const file of files) {
    const details = [`证据 ID：FOLDER:${file.path}`, `类型：${file.kind === "code" ? "代码" : "文档"}`];
    if (file.kind === "code") {
      const analysis = analyzeSourceFile(file.path, file.content);
      if (analysis.language) details.push(`语言：${analysis.language}`);
      if (analysis.imports.length) details.push(`依赖/导入：${analysis.imports.join("、")}`);
      if (analysis.symbols.length) details.push(`符号：${analysis.symbols.join("、")}`);
      if (analysis.tests.length) details.push(`测试证据：${analysis.tests.join("、")}`);
    }
    if (file.truncated) details.push("提示：该文件正文因安全上限被截断。");
    const sentinel = `${FOLDER_FILE_SENTINEL_PREFIX}${Buffer.from(file.path, "utf8").toString("base64url")}${FOLDER_FILE_SENTINEL_SUFFIX}`;
    const safeContent = file.content.replaceAll(FOLDER_FILE_SENTINEL_PREFIX, "&lt;!-- CHEATER_INTERNAL_FOLDER_FILE:");
    blocks.push(`${sentinel}\n## 文件：${file.path}\n\n${details.join("\n")}\n\n${safeContent}`);
  }
  const summary = input.scanSummary && typeof input.scanSummary === "object" ? input.scanSummary : {};
  return {
    title: `${name}（文件夹）`,
    text: blocks.join("\n\n"),
    sourceType: "folder",
    mediaType: "text/x-knowledge-folder",
    metadata: {
      origin: "local-folder",
      ...(folderIdentity ? { folderIdentity } : {}),
      fileCount: files.length,
      codeFileCount: files.filter((file) => file.kind === "code").length,
      documentFileCount: files.filter((file) => file.kind !== "code").length,
      skippedCount: toSafeInteger(summary.skippedFileCount),
      truncatedFileCount: files.filter((file) => file.truncated).length,
      paths: files.map((file) => file.path),
      sourceHash: createHash("sha256").update(files.map((file) => `${file.path}\0${file.content}`).join("\0")).digest("hex"),
    },
  };
}

function normalizeFolderFiles(value) {
  if (!Array.isArray(value)) throw new TypeError("文件夹知识来源必须包含 files 数组。");
  const normalized = [];
  let totalCharacters = 0;
  for (const input of value) {
    if (normalized.length >= MAX_FILES) break;
    const path = normalizeSubmittedPath(input?.path);
    if (!path || isSkippedSubmittedPath(path)) continue;
    const content = String(input?.content ?? "").replace(/\u0000/g, "").trim();
    if (!content || content.length > MAX_FILE_CHARACTERS) continue;
    if (totalCharacters + content.length > MAX_TOTAL_CHARACTERS) break;
    totalCharacters += content.length;
    normalized.push({
      path,
      content,
      kind: input?.kind === "code" ? "code" : "document",
      truncated: input?.truncated === true,
    });
  }
  if (!normalized.length) throw new Error("文件夹知识来源中没有可解析的文本文件。");
  return normalized;
}

async function extractCandidate(bytes, candidate, ocr) {
  const extension = extname(candidate.relativePath).toLowerCase();
  if (candidate.kind === "code") {
    return { text: decodeUtf8(bytes), mediaType: "text/x-source-code" };
  }
  if (candidate.kind === "text") {
    if (extension === ".html" || extension === ".htm") {
      return extractUploadedDocument(Buffer.from(bytes), candidate.relativePath, mediaTypeFor(extension), { ocr });
    }
    return { text: decodeUtf8(bytes), mediaType: mediaTypeFor(extension) };
  }
  if (candidate.kind === "image") {
    return extractUploadedDocument(Buffer.from(bytes), candidate.relativePath, mediaTypeFor(extension), { ocr });
  }
  return extractUploadedDocument(Buffer.from(bytes), candidate.relativePath, mediaTypeFor(extension), { ocr });
}

async function readBoundedFile(fileHandle, length) {
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_BINARY_FILE_BYTES) {
    throw new Error("文件大小无效或超过限制");
  }
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await fileHandle.read(buffer, offset, length - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  if (!offset) throw new Error("文件在读取期间变为空");
  return offset === length ? buffer : buffer.subarray(0, offset);
}

function classifyKnowledgeFile(path) {
  const extension = extname(path).toLowerCase();
  const filename = posix.basename(path).toLowerCase();
  if (BINARY_DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === ".html" || extension === ".htm") return "text";
  if (CODE_EXTENSIONS.has(extension) || CODE_FILENAMES.has(filename)) return "code";
  if (TEXT_DOCUMENT_EXTENSIONS.has(extension)) return "text";
  return null;
}

function decodeUtf8(bytes) {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const controlCount = [...decoded].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  }).length;
  if (controlCount > Math.max(8, decoded.length * 0.01)) throw new Error("文件不是有效的 UTF-8 文本");
  return decoded;
}

function normalizeRelativePath(root, absolutePath) {
  const value = relative(root, absolutePath).replaceAll("\\", "/");
  if (!value || value === "." || value.startsWith("../") || posix.isAbsolute(value)) return "";
  const normalized = posix.normalize(value);
  return normalized.length <= 500 ? normalized : "";
}

function normalizeSubmittedPath(value) {
  const path = String(value ?? "").replaceAll("\\", "/");
  if (!path || path.includes("\0") || path.length > 500) return "";
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) return "";
  const normalized = posix.normalize(path);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) return "";
  return normalized;
}

function isSkippedSubmittedPath(path) {
  return path.split("/").some((part) => part.startsWith(".") || SKIPPED_DIRECTORIES.has(part.toLowerCase()));
}

function windowsUnsafeAttributeReason(path) {
  if (process.platform !== "win32") return null;
  if (!getWindowsFileAttributes) {
    try {
      windowsFileAttributeLibrary = nodeRequire("koffi").load("kernel32.dll");
      getWindowsFileAttributes = windowsFileAttributeLibrary.func("uint32 GetFileAttributesW(str16 path)");
    } catch {
      throw new Error("无法检查 Windows 文件隐藏属性，已停止扫描以保护隐私。");
    }
  }
  const attributes = Number(getWindowsFileAttributes(path)) >>> 0;
  if (attributes === 0xffffffff) return "Windows 文件属性不可读取";
  if (attributes & 0x400) return "已跳过 Windows 重解析点";
  if (attributes & (0x2 | 0x4)) return "已忽略的 Windows 隐藏或系统内容";
  return null;
}

async function canonicalPathForOpenedFile(fileHandle, fallbackPath) {
  if (process.platform === "win32") return windowsFinalPathForFileDescriptor(fileHandle.fd);
  if (process.platform === "linux") return realpath(`/proc/self/fd/${fileHandle.fd}`);
  // Other supported desktop platforms do not expose a portable fd-to-path API.
  // Keep the same fail-closed boundary check using realpath plus the already-checked
  // device/inode identity of the opened handle.
  return realpath(fallbackPath);
}

function windowsFinalPathForFileDescriptor(fileDescriptor) {
  if (!getWindowsOsFileHandle || !getWindowsFinalPathName) {
    try {
      const koffi = nodeRequire("koffi");
      // Node/Electron file descriptors belong to libuv's descriptor table, not
      // necessarily to the process CRT. Resolve the export from the already
      // loaded process image; loading electron.exe again can invoke its entry
      // point and terminate an Electron-as-Node process.
      windowsRuntimeLibrary = koffi.load(null);
      windowsFilePathLibrary = koffi.load("kernel32.dll");
      getWindowsOsFileHandle = windowsRuntimeLibrary.func("intptr uv_get_osfhandle(int fd)");
      getWindowsFinalPathName = windowsFilePathLibrary.func(
        "uint32 __stdcall GetFinalPathNameByHandleW(intptr handle, _Out_ char16_t *path, uint32 length, uint32 flags)",
      );
    } catch {
      throw new Error("Windows 文件句柄路径验证不可用");
    }
  }
  const osFileHandle = getWindowsOsFileHandle(fileDescriptor);
  if (Number(osFileHandle) === -1) throw new Error("Windows 文件句柄无效");
  const maximumCharacters = 32_768;
  const output = Buffer.alloc(maximumCharacters * 2);
  const length = Number(getWindowsFinalPathName(osFileHandle, output, maximumCharacters, 0));
  if (!Number.isSafeInteger(length) || length <= 0 || length >= maximumCharacters) {
    throw new Error("Windows 无法解析已打开文件的最终路径");
  }
  return output.toString("utf16le", 0, length * 2);
}

function normalizeCanonicalPath(value) {
  let path = String(value ?? "");
  if (process.platform === "win32") {
    if (path.startsWith("\\\\?\\UNC\\")) path = `\\\\${path.slice(8)}`;
    else if (path.startsWith("\\\\?\\")) path = path.slice(4);
  }
  return resolve(path);
}

function isPathWithinCanonicalRoot(canonicalRoot, candidatePath) {
  const difference = relative(canonicalRoot, candidatePath);
  if (!difference || difference === "." || difference === ".." || isAbsolute(difference)) return false;
  return !difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function mediaTypeFor(extension) {
  return ({
    ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".html": "text/html", ".htm": "text/html",
    ".md": "text/markdown", ".markdown": "text/markdown", ".json": "application/json", ".xml": "application/xml",
    ".yaml": "application/yaml", ".yml": "application/yaml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".bmp": "image/bmp", ".webp": "image/webp",
    ".gif": "image/gif",
  })[extension] ?? "text/plain";
}

function cleanScanError(error) {
  return String(error?.message ?? error ?? "处理失败").replace(/\s+/g, " ").trim().slice(0, 160) || "处理失败";
}

function cleanName(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;
}

function toSafeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
