import { createHash } from "node:crypto";
import { extname, posix } from "node:path";

const MAX_FILES = 180;
const MAX_FILE_CHARACTERS = 80_000;
const MAX_TOTAL_CHARACTERS = 2_500_000;
const FETCH_CONCURRENCY = 6;
const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte", ".py", ".java", ".kt", ".kts", ".go", ".rs",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift", ".scala", ".sh", ".ps1", ".sql", ".graphql",
  ".html", ".css", ".scss", ".less", ".xml", ".yaml", ".yml", ".toml", ".ini", ".env.example", ".md", ".txt",
]);
const CONFIG_NAMES = new Set([
  "package.json", "cargo.toml", "go.mod", "pom.xml", "build.gradle", "dockerfile", "docker-compose.yml", "makefile",
  "requirements.txt", "pyproject.toml", "tsconfig.json", "vite.config.js", "vite.config.ts", "next.config.js", "readme.md",
]);
const SKIPPED_PATH = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.git|\.next|target|__pycache__|\.venv|venv)(?:\/|$)/i;

export function normalizeCodeFiles(files) {
  if (!Array.isArray(files)) throw new TypeError("代码来源必须包含 files 数组。");
  let total = 0;
  const normalized = [];
  for (const input of files) {
    if (normalized.length >= MAX_FILES) break;
    const path = normalizeRepositoryPath(input?.path ?? input?.name);
    if (!path || SKIPPED_PATH.test(path) || !isSupportedCodePath(path)) continue;
    const content = String(input?.content ?? "").replace(/\u0000/g, "");
    if (!content.trim() || content.length > MAX_FILE_CHARACTERS) continue;
    total += content.length;
    if (total > MAX_TOTAL_CHARACTERS) break;
    normalized.push({ path, content });
  }
  if (!normalized.length) throw new Error("代码来源中没有可解析的文本文件。");
  return normalized;
}

export function buildCodeEvidenceDocument({ name = "代码仓库", files, repositoryUrl = null, commit = null }) {
  const normalized = normalizeCodeFiles(files);
  const blocks = [
    `# 项目与代码证据库：${String(name).slice(0, 200)}`,
    repositoryUrl ? `仓库：${repositoryUrl}` : "",
    commit ? `版本：${commit}` : "",
    "说明：以下内容由本地代码解析器转换为可检索文本；结论必须回溯到文件与符号证据。",
  ].filter(Boolean);
  for (const file of normalized) {
    const analysis = analyzeSourceFile(file.path, file.content);
    blocks.push([
      `## 文件：${file.path}`,
      `证据 ID：${analysis.evidenceId}`,
      `语言：${analysis.language}`,
      analysis.imports.length ? `依赖/导入：${analysis.imports.join("、")}` : "",
      analysis.symbols.length ? `符号：${analysis.symbols.join("、")}` : "",
      analysis.tests.length ? `测试证据：${analysis.tests.join("、")}` : "",
      "```" + analysis.fence,
      file.content,
      "```",
    ].filter(Boolean).join("\n"));
  }
  return {
    title: String(name).slice(0, 200),
    text: blocks.join("\n\n"),
    sourceType: "code",
    mediaType: "text/x-code-repository",
    metadata: {
      repositoryUrl,
      commit,
      fileCount: normalized.length,
      paths: normalized.map((file) => file.path),
      sourceHash: createHash("sha256").update(normalized.map((file) => `${file.path}\0${file.content}`).join("\0")).digest("hex"),
    },
  };
}

export async function fetchGitHubRepository(input, options = {}) {
  const parsed = parseGitHubRepositoryUrl(input.url);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 GitHub 获取。 ");
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Cheater-Desktop-Knowledge-Importer",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
  };
  const repository = await fetchJson(fetchImpl, `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, headers);
  const ref = String(input.ref ?? repository.default_branch ?? "main").slice(0, 200);
  const tree = await fetchJson(fetchImpl, `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, headers);
  if (tree.truncated) throw new Error("GitHub 仓库目录过大，API 返回了截断结果；请指定更小的代码来源。");
  const entries = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.size <= MAX_FILE_CHARACTERS * 4)
    .filter((entry) => isAllowedGitHubBlobUrl(entry.url, parsed))
    .filter((entry) => isSupportedCodePath(entry.path) && !SKIPPED_PATH.test(entry.path))
    .slice(0, MAX_FILES);
  const files = await mapConcurrent(entries, FETCH_CONCURRENCY, async (entry) => {
    const response = await fetchImpl(entry.url, { headers: { ...headers, Accept: "application/vnd.github.raw+json" } });
    if (!response.ok) throw new Error(`GitHub 文件获取失败（HTTP ${response.status}）：${entry.path}`);
    const content = await response.text();
    return { path: entry.path, content };
  });
  return buildCodeEvidenceDocument({
    name: `${parsed.owner}/${parsed.repo}`,
    files,
    repositoryUrl: parsed.canonicalUrl,
    commit: tree.sha ?? ref,
  });
}

export function parseGitHubRepositoryUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("GitHub 仓库地址无效。");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") throw new Error("只允许导入 https://github.com 上的仓库。");
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner ?? "") || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo ?? "")) {
    throw new Error("GitHub 仓库地址必须是 https://github.com/<owner>/<repo>。");
  }
  return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
}

export function analyzeSourceFile(path, content) {
  const language = languageForPath(path);
  const imports = [];
  const symbols = [];
  const tests = [];
  const importPattern = /(?:^|\n)\s*(?:import\s+(?:[^;\n]+?\s+from\s+)?|from\s+|require\s*\(|use\s+|#include\s*[<"])([A-Za-z0-9_@./:+-]+)/g;
  for (const match of content.matchAll(importPattern)) addLimited(imports, cleanSymbol(match[1]), 24);
  const symbolPatterns = [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|struct|trait|def|fn)\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)\s*(?:public|private|protected|static|final|const|let|var)?\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^\n]*\)\s*=>/g,
  ];
  for (const pattern of symbolPatterns) for (const match of content.matchAll(pattern)) addLimited(symbols, match[1], 40);
  for (const match of content.matchAll(/(?:^|\n)\s*(?:describe|it|test|suite)\s*\(\s*["'`]([^"'`\n]+)/g)) addLimited(tests, match[1], 20);
  return {
    evidenceId: `CODE:${path}`,
    language,
    fence: fenceForLanguage(language),
    imports,
    symbols,
    tests,
  };
}

function isAllowedGitHubBlobUrl(value, repository) {
  try {
    const url = new URL(String(value));
    const prefix = `/repos/${repository.owner}/${repository.repo}/git/blobs/`.toLowerCase();
    return url.protocol === "https:" && url.hostname === "api.github.com" && url.pathname.toLowerCase().startsWith(prefix);
  } catch {
    return false;
  }
}

function isSupportedCodePath(path) {
  const lower = path.toLowerCase();
  return CODE_EXTENSIONS.has(extname(lower)) || CONFIG_NAMES.has(posix.basename(lower));
}

function normalizeRepositoryPath(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || normalized.length > 500) return "";
  return posix.normalize(normalized);
}

function languageForPath(path) {
  const extension = extname(path).toLowerCase();
  return ({
    ".js": "JavaScript", ".jsx": "JavaScript JSX", ".mjs": "JavaScript", ".cjs": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript TSX",
    ".py": "Python", ".java": "Java", ".kt": "Kotlin", ".go": "Go", ".rs": "Rust", ".c": "C", ".h": "C/C++ Header",
    ".cc": "C++", ".cpp": "C++", ".hpp": "C++ Header", ".cs": "C#", ".php": "PHP", ".rb": "Ruby", ".swift": "Swift",
    ".scala": "Scala", ".sh": "Shell", ".ps1": "PowerShell", ".sql": "SQL", ".vue": "Vue", ".svelte": "Svelte",
    ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML", ".md": "Markdown",
  })[extension] ?? "Text / Config";
}

function fenceForLanguage(language) {
  return language.toLowerCase().replace(/[^a-z0-9+#-]/g, "").replace("javascriptjsx", "jsx").replace("typescripttsx", "tsx");
}

function cleanSymbol(value) {
  return String(value ?? "").replace(/[)'">].*$/, "").slice(0, 120);
}

function addLimited(items, value, limit) {
  if (value && items.length < limit && !items.includes(value)) items.push(value);
}

async function fetchJson(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const detail = String(await response.text()).slice(0, 240);
    throw new Error(`GitHub API 请求失败（HTTP ${response.status}）：${detail || "请检查仓库权限或访问频率"}`);
  }
  return response.json();
}

async function mapConcurrent(items, concurrency, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return result;
}
