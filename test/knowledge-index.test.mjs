import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { extractUploadedDocument } from "../out/main/knowledge/extractors.mjs";
import { KnowledgeIndex, chunkText } from "../out/main/knowledge/knowledge-index.mjs";
import { analyzeCandidateMaterial, analyzeJobDescription } from "../out/main/knowledge/material-analysis.mjs";
import { buildCodeEvidenceDocument, fetchGitHubRepository, parseGitHubRepositoryUrl } from "../out/main/knowledge/code-source.mjs";
import { FOLDER_FILE_SENTINEL_PREFIX, buildFolderEvidenceDocument, scanKnowledgeFolder } from "../out/main/knowledge/folder-source.mjs";

const execFileAsync = promisify(execFile);

test("knowledge index chunks documents and performs hybrid retrieval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-knowledge-test-"));
  const aiService = {
    async embed(texts) {
      return {
        model: "text-embedding-v4",
        vectors: texts.map((text) => text.includes("限流") ? [1, 0.2, 0.1] : [0.2, 1, 0.1]),
      };
    },
  };
  const index = await new KnowledgeIndex({ filePath: join(directory, "index.json"), aiService }).initialize();
  const document = {
    id: "document-1",
    knowledgeBaseId: "knowledge-1",
    assetId: "asset-1",
    filename: "project.md",
    contentType: "text/markdown",
  };
  const result = await index.indexDocument({
    document,
    asset: { id: "asset-1" },
    bytes: Buffer.from("# 网关项目\n\n我实现了令牌桶限流，并通过压测验证吞吐量。", "utf8"),
  });
  const search = await index.search("项目里如何实现限流？", ["knowledge-1"], 5);
  assert.equal(result.retrievalMode, "hybrid");
  assert.equal(search.retrievalMode, "hybrid");
  assert.equal(search.citations[0].documentName, "project.md");
  assert.match(search.citations[0].snippet, /令牌桶限流/);
  assert.ok(chunkText("段落一\n\n段落二", "测试").length > 0);

  const reopened = await new KnowledgeIndex({ filePath: join(directory, "index.json"), aiService }).initialize();
  const reopenedSearch = await reopened.search("令牌桶限流", ["knowledge-1"], 5);
  assert.equal(reopenedSearch.citations[0].documentId, "document-1");
  await reopened.removeDocument("document-1");
  assert.deepEqual((await reopened.search("令牌桶限流", ["knowledge-1"], 5)).citations, []);
});

test("a failed index persist rolls back memory and does not poison later writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-index-rollback-"));
  const blockedTarget = join(directory, "index-target");
  await mkdir(blockedTarget);
  const aiService = {
    async embed(texts) {
      return { model: "test", vectors: texts.map(() => [1, 0.2]) };
    },
  };
  const index = new KnowledgeIndex({ filePath: blockedTarget, aiService });
  await assert.rejects(index.indexTextDocument({
    document: { id: "failed-doc", knowledgeBaseId: "kb-rollback", filename: "failed.md" },
    text: "FAILED_ONLY_FACT should never remain searchable",
    sourceType: "text",
  }));
  assert.deepEqual(index.searchFast("FAILED_ONLY_FACT", ["kb-rollback"], 3).citations, []);

  index.filePath = join(directory, "recovered-index.json");
  await index.indexTextDocument({
    document: { id: "recovered-doc", knowledgeBaseId: "kb-rollback", filename: "recovered.md" },
    text: "RECOVERED_FACT proves the write queue can continue",
    sourceType: "text",
  });
  assert.equal(index.searchFast("RECOVERED_FACT", ["kb-rollback"], 3).citations[0].documentId, "recovered-doc");
});

test("pending replacement recovery commits acknowledged metadata and discards deleted documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-index-replacement-recovery-"));
  const filePath = join(directory, "index.json");
  const aiService = {
    async embed(texts) {
      return { model: "test", vectors: texts.map(() => [1, 0.2]) };
    },
  };
  const document = { id: "replacement-doc", knowledgeBaseId: "kb-replacement", filename: "facts.md" };
  const index = await new KnowledgeIndex({ filePath, aiService }).initialize();
  await index.indexTextDocument({ document, text: "RECOVERY_OLD_FACT", sourceType: "folder" });
  const staged = await index.beginDocumentReplacement({
    document,
    text: "RECOVERY_COMMITTED_FACT",
    sourceType: "folder",
  });
  assert.match(index.searchFast("RECOVERY_OLD_FACT", ["kb-replacement"], 3).citations[0]?.snippet ?? "", /RECOVERY_OLD_FACT/);
  assert.deepEqual(index.searchFast("RECOVERY_COMMITTED_FACT", ["kb-replacement"], 3).citations, []);

  const committedRestart = await new KnowledgeIndex({ filePath, aiService }).initialize();
  const committed = await committedRestart.recoverPendingDocumentReplacements(({ replacementToken }) =>
    replacementToken === staged.replacementToken ? "commit" : "rollback");
  assert.deepEqual(committed, { committed: 1, rolledBack: 0, discarded: 0 });
  assert.match(committedRestart.searchFast("RECOVERY_COMMITTED_FACT", ["kb-replacement"], 3).citations[0]?.snippet ?? "", /RECOVERY_COMMITTED_FACT/);
  assert.deepEqual(committedRestart.searchFast("RECOVERY_OLD_FACT", ["kb-replacement"], 3).citations, []);

  await committedRestart.beginDocumentReplacement({
    document,
    text: "RECOVERY_DELETED_FACT",
    sourceType: "folder",
  });
  const deletedRestart = await new KnowledgeIndex({ filePath, aiService }).initialize();
  const discarded = await deletedRestart.recoverPendingDocumentReplacements(() => "discard");
  assert.deepEqual(discarded, { committed: 0, rolledBack: 0, discarded: 1 });
  assert.deepEqual(deletedRestart.searchFast("RECOVERY_DELETED_FACT", ["kb-replacement"], 3).citations, []);
  assert.deepEqual(deletedRestart.searchFast("RECOVERY_COMMITTED_FACT", ["kb-replacement"], 3).citations, []);
});

test("fast retrieval is purely local while deep retrieval may call the embedding provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-fast-search-test-"));
  let embedCalls = 0;
  let deepEmbedOptions = null;
  const aiService = {
    async embed(texts, options) {
      embedCalls += 1;
      if (options) deepEmbedOptions = options;
      return { model: "test", vectors: texts.map(() => [1, 0.25]) };
    },
  };
  const index = await new KnowledgeIndex({ filePath: join(directory, "index.json"), aiService }).initialize();
  await index.indexTextDocument({
    document: { id: "doc-fast", knowledgeBaseId: "kb-fast", filename: "gateway.md" },
    text: "支付网关使用令牌桶限流，并通过集成测试验证故障降级。",
    sourceType: "text",
  });
  const afterIndex = embedCalls;
  const fast = index.searchFast("令牌桶限流", ["kb-fast"], 3);
  assert.equal(embedCalls, afterIndex, "searchFast must never call online embeddings");
  assert.equal(fast.retrievalMode, "lexical");
  assert.match(fast.citations[0].snippet, /令牌桶/);
  assert.ok(fast.citations[0].evidenceId);
  const controller = new AbortController();
  await index.searchDeep("令牌桶限流", ["kb-fast"], 3, { signal: controller.signal, timeoutMs: 321 });
  assert.equal(embedCalls, afterIndex + 1);
  assert.equal(deepEmbedOptions.timeoutMs, 321);
  assert.equal(deepEmbedOptions.signal, controller.signal);
});

test("mixed embedding models keep an exact lexical hit ahead of partial semantic coverage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-mixed-embedding-models-"));
  let model = "old-model";
  const aiService = {
    async embed(texts) {
      return { model, vectors: texts.map(() => [1, 0.2]) };
    },
  };
  const index = await new KnowledgeIndex({ filePath: join(directory, "index.json"), aiService }).initialize();
  await index.indexTextDocument({
    document: { id: "old-exact", knowledgeBaseId: "kb-mixed", filename: "old.md" },
    text: "UNIQUE_LEXICAL_FACT 精确事实来自旧向量模型。",
    sourceType: "text",
  });
  model = "current-model";
  await index.indexTextDocument({
    document: { id: "current-unrelated", knowledgeBaseId: "kb-mixed", filename: "current.md" },
    text: Array.from({ length: 5 }, (_, item) => `无关背景 ${item} ${"普通材料".repeat(320)}`).join("\n\n"),
    sourceType: "text",
  });
  const result = await index.searchDeep("UNIQUE_LEXICAL_FACT", ["kb-mixed"], 3);
  assert.equal(result.citations[0].documentId, "old-exact");
});

test("JD, resume and code sources become evidence-addressable searchable text", () => {
  const jd = analyzeJobDescription([
    "高级后端工程师",
    "岗位职责",
    "负责支付网关和高并发服务设计",
    "任职要求",
    "5 年以上 Java 或 Go 开发经验",
    "熟悉 Redis、Kafka 与 Kubernetes",
    "加分项",
    "有金融支付经验优先",
  ].join("\n"), "jd-1");
  assert.equal(jd.roleFamily, "后端工程");
  assert.equal(jd.seniority, "高级");
  assert.ok(jd.mustHaveSkills.some((item) => /Redis/.test(item.text)));
  assert.match(jd.mustHaveSkills[0].evidenceId, /^JD:L/);

  const resume = analyzeCandidateMaterial("# 项目经历\n支付网关：使用 Go 实现限流，压测提升 30%。", "resume-1");
  assert.ok(resume.facts.some((item) => /支付网关/.test(item.text)));
  assert.ok(resume.facts.some((item) => item.metrics.includes("30%")));

  const code = buildCodeEvidenceDocument({
    name: "gateway",
    repositoryUrl: "https://github.com/example/gateway",
    commit: "abc123",
    files: [
      { path: "src/limiter.ts", content: "import Redis from 'ioredis';\nexport class TokenBucket {\n  take() { return true; }\n}" },
      { path: "test/limiter.test.ts", content: "test('rejects burst traffic', () => {});" },
      { path: "node_modules/ignored.js", content: "doNotIndex();" },
    ],
  });
  assert.equal(code.sourceType, "code");
  assert.equal(code.metadata.fileCount, 2);
  assert.match(code.text, /CODE:src\/limiter\.ts/);
  assert.match(code.text, /TokenBucket/);
  assert.doesNotMatch(code.text, /doNotIndex/);
  assert.deepEqual(parseGitHubRepositoryUrl("https://github.com/example/gateway.git"), {
    owner: "example",
    repo: "gateway",
    canonicalUrl: "https://github.com/example/gateway",
  });
  assert.throws(() => parseGitHubRepositoryUrl("https://evil.example/example/gateway"), /只允许/);
});

test("long single-line resume facts are segmented instead of silently losing the tail", () => {
  const longFact = `支付平台项目：${"负责网关、限流、缓存和消息队列；".repeat(50)}最终将核心接口延迟降低 35%。`;
  const analysis = analyzeCandidateMaterial(`项目经历\n${longFact}`, "resume-long");
  const projectFacts = analysis.facts.filter((item) => item.category === "project");
  assert.ok(projectFacts.length >= 2);
  assert.match(projectFacts.map((item) => item.text).join(""), /延迟降低 35%/);
  assert.equal(new Set(projectFacts.map((item) => item.evidenceId)).size, projectFacts.length);
});

test("GitHub repository import is host-locked and converts API blobs into code evidence", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers });
    if (String(url).endsWith("/repos/example/gateway")) {
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("/git/trees/main")) {
      return new Response(JSON.stringify({ sha: "tree123", truncated: false, tree: [
        { type: "blob", path: "src/index.ts", size: 40, url: "https://api.github.com/repos/example/gateway/git/blobs/1" },
        { type: "blob", path: "dist/ignored.js", size: 20, url: "https://api.github.com/repos/example/gateway/git/blobs/2" },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/git/blobs/1")) return new Response("export function health() { return true; }", { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const source = await fetchGitHubRepository({ url: "https://github.com/example/gateway", token: "temporary-secret" }, { fetchImpl });
  assert.equal(source.metadata.repositoryUrl, "https://github.com/example/gateway");
  assert.equal(source.metadata.commit, "tree123");
  assert.equal(source.metadata.fileCount, 1);
  assert.match(source.text, /health/);
  assert.doesNotMatch(JSON.stringify(source), /temporary-secret/);
  assert.ok(calls.every((call) => call.url.startsWith("https://api.github.com/")));
  assert.ok(calls.every((call) => call.headers.Authorization === "Bearer temporary-secret"));
});

test("local folders are safely scanned and converted into path-addressable evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-folder-source-"));
  await mkdir(join(directory, "notes"), { recursive: true });
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "ignored"), { recursive: true });
  await writeFile(join(directory, "notes", "project.md"), "# 支付项目\n\n使用令牌桶处理突发流量。", "utf8");
  await writeFile(join(directory, "notes", "safe.html"), "<main>可检索的架构说明</main><script>doNotExecute()</script>", "utf8");
  await writeFile(join(directory, "src", "limiter.ts"), "export class TokenBucket { take() { return true; } }", "utf8");
  await writeFile(join(directory, "node_modules", "ignored", "secret.js"), "doNotIndex();", "utf8");
  await writeFile(join(directory, ".env"), "DASHSCOPE_API_KEY=must-not-import", "utf8");
  if (process.platform === "win32") {
    const windowsHiddenPath = join(directory, "private-hidden.ini");
    await writeFile(windowsHiddenPath, "SECRET_HIDDEN_VALUE=must-not-import", "utf8");
    await execFileAsync("attrib", ["+H", windowsHiddenPath]);
  }
  await writeFile(join(directory, "image.bin"), Buffer.from([0, 1, 2, 3]));

  const scan = await scanKnowledgeFolder(directory);
  assert.match(scan.folderIdentity, /^[a-f0-9]{64}$/);
  assert.equal(scan.summary.importedFileCount, 3);
  assert.equal(scan.summary.codeFileCount, 1);
  assert.ok(scan.summary.skippedFileCount >= 3);
  assert.deepEqual(scan.files.map((file) => file.path), ["notes/project.md", "notes/safe.html", "src/limiter.ts"]);
  assert.ok(scan.files.every((file) => !file.path.includes("node_modules")));
  assert.ok(scan.files.every((file) => file.path !== ".env"));
  if (process.platform === "win32") assert.ok(scan.files.every((file) => file.path !== "private-hidden.ini"));

  const source = buildFolderEvidenceDocument({ name: "面试资料", files: scan.files, scanSummary: scan.summary });
  assert.equal(source.sourceType, "folder");
  assert.equal(source.metadata.fileCount, 3);
  assert.equal(source.metadata.codeFileCount, 1);
  assert.match(source.text, /FOLDER:notes\/project\.md/);
  assert.match(source.text, /FOLDER:src\/limiter\.ts/);
  assert.match(source.text, /TokenBucket/);
  assert.doesNotMatch(source.text, /doNotIndex/);
  assert.doesNotMatch(source.text, /doNotExecute/);
  assert.doesNotMatch(source.text, /must-not-import/);
  if (process.platform === "win32") assert.doesNotMatch(source.text, /SECRET_HIDDEN_VALUE/);
  assert.throws(() => buildFolderEvidenceDocument({ files: [{ path: "../escape.md", content: "越界" }] }), /没有可解析/);
  for (const path of ["/etc/passwd", "C:\\Users\\person\\resume.md", "\\\\server\\share\\notes.md"]) {
    assert.throws(() => buildFolderEvidenceDocument({ files: [{ path, content: "越界" }] }), /没有可解析/);
  }
});

test("invalid early folder candidates do not consume the successful import limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-folder-candidate-limit-"));
  await Promise.all(Array.from({ length: 180 }, (_, index) =>
    writeFile(join(directory, `${String(index).padStart(3, "0")}.txt`), "")));
  await writeFile(join(directory, "zzz-valid.md"), "VALID_AFTER_EMPTY_CANDIDATES 可检索事实", "utf8");

  const scan = await scanKnowledgeFolder(directory);

  assert.deepEqual(scan.files.map((file) => file.path), ["zzz-valid.md"]);
  assert.match(scan.files[0].content, /VALID_AFTER_EMPTY_CANDIDATES/);
  assert.equal(scan.summary.discoveredFileCount, 181);
  assert.equal(scan.summary.skippedReasons["空文件"], 180);
});

test("folder scanning rejects a discovered directory replaced by an external directory link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-folder-boundary-race-"));
  const outside = await mkdtemp(join(tmpdir(), "cheater-folder-boundary-outside-"));
  const victim = join(directory, "victim");
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await mkdir(victim);
  await writeFile(join(directory, "000-hold.png"), tinyPng);
  await writeFile(join(victim, "marker.md"), "ORIGINAL_MARKER 可导入内容", "utf8");
  await writeFile(join(outside, "marker.md"), "EXTERNAL_BOUNDARY_MARKER 绝不能导入", "utf8");

  let releaseOcr;
  let announceOcrStarted;
  const ocrStarted = new Promise((resolveStarted) => { announceOcrStarted = resolveStarted; });
  const continueOcr = new Promise((resolveOcr) => { releaseOcr = resolveOcr; });
  const scanPromise = scanKnowledgeFolder(directory, {
    ocr: {
      async recognizeImage() {
        announceOcrStarted();
        await continueOcr;
        return "受控扫描占位内容";
      },
    },
  });

  await ocrStarted;
  await rm(victim, { recursive: true });
  await symlink(outside, victim, process.platform === "win32" ? "junction" : "dir");
  releaseOcr();

  const scan = await scanPromise;
  assert.deepEqual(scan.files.map((file) => file.path), ["000-hold.png"]);
  assert.doesNotMatch(JSON.stringify(scan), /EXTERNAL_BOUNDARY_MARKER/);
  assert.equal(scan.summary.skippedReasons["已打开文件超出所选目录，已跳过"], 1);
});

test("folder chunks retain the relative path of the file that produced them", () => {
  const source = buildFolderEvidenceDocument({
    name: "路径证据",
    files: [
      { path: "one.txt", content: `ONE_TOKEN ${"甲".repeat(850)}` },
      { path: "two.txt", content: `TWO_TOKEN ${"乙".repeat(850)}` },
      { path: "three.txt", content: `THREE_TOKEN ${"丙".repeat(850)}` },
    ],
  });
  const chunks = chunkText(source.text, source.title);
  assert.match(chunks.find((chunk) => chunk.content.includes("ONE_TOKEN"))?.title ?? "", /one\.txt/);
  assert.match(chunks.find((chunk) => chunk.content.includes("TWO_TOKEN"))?.title ?? "", /two\.txt/);
  assert.match(chunks.find((chunk) => chunk.content.includes("THREE_TOKEN"))?.title ?? "", /three\.txt/);
});

test("folder chunks disambiguate matching Markdown headings with their relative paths", () => {
  const source = buildFolderEvidenceDocument({
    name: "同名标题证据",
    files: [
      { path: "notes/a.md", content: "# 项目经历\n\nALPHA_PROJECT_TOKEN 负责支付网关。" },
      { path: "archive/a.md", content: "# 项目经历\n\nBETA_PROJECT_TOKEN 负责推荐系统。" },
    ],
  });
  const chunks = chunkText(source.text, source.title);
  const alpha = chunks.find((chunk) => chunk.content.includes("ALPHA_PROJECT_TOKEN"));
  const beta = chunks.find((chunk) => chunk.content.includes("BETA_PROJECT_TOKEN"));

  assert.equal(alpha?.title, "notes/a.md › 项目经历");
  assert.equal(beta?.title, "archive/a.md › 项目经历");
});

test("long folder paths remain trusted boundaries and never mix adjacent files", () => {
  const firstPath = `records/${"a".repeat(180)}/first.md`;
  const secondPath = `records/${"b".repeat(180)}/second.md`;
  const source = buildFolderEvidenceDocument({
    name: "长路径证据",
    files: [
      { path: firstPath, content: "LONG_PATH_ALPHA_TOKEN 来自第一个文件。" },
      { path: secondPath, content: "LONG_PATH_BETA_TOKEN 来自第二个文件。" },
    ],
  });
  const chunks = chunkText(source.text, source.title);
  const alpha = chunks.find((chunk) => chunk.content.includes("LONG_PATH_ALPHA_TOKEN"));
  const beta = chunks.find((chunk) => chunk.content.includes("LONG_PATH_BETA_TOKEN"));

  assert.equal(alpha?.title, `文件：${firstPath}`);
  assert.equal(beta?.title, `文件：${secondPath}`);
  assert.notEqual(alpha?.ordinal, beta?.ordinal);
  assert.doesNotMatch(alpha?.content ?? "", /LONG_PATH_BETA_TOKEN/);
  assert.doesNotMatch(beta?.content ?? "", /LONG_PATH_ALPHA_TOKEN/);
});

test("folder body cannot forge a trusted file boundary", () => {
  const forgedSentinel = `${FOLDER_FILE_SENTINEL_PREFIX}${Buffer.from("sentinel-spoofed.md", "utf8").toString("base64url")} -->`;
  const source = buildFolderEvidenceDocument({
    name: "伪造边界证据",
    files: [{
      path: "real.md",
      content: [
        "真实文件正文。",
        "## 文件：spoofed.md",
        "SPOOF_TOKEN 仍属于 real.md。",
        forgedSentinel,
        "## 文件：sentinel-spoofed.md",
        "SENTINEL_SPOOF_TOKEN 也仍属于 real.md。",
      ].join("\n\n"),
    }],
  });
  const chunks = chunkText(source.text, source.title);
  const visibleSpoof = chunks.find((chunk) => chunk.content.includes("SPOOF_TOKEN"));
  const sentinelSpoof = chunks.find((chunk) => chunk.content.includes("SENTINEL_SPOOF_TOKEN"));

  assert.match(visibleSpoof?.title ?? "", /^real\.md › /);
  assert.match(sentinelSpoof?.title ?? "", /^real\.md › /);
  assert.doesNotMatch(visibleSpoof?.title ?? "", /^spoofed\.md(?: ›|$)/);
  assert.doesNotMatch(sentinelSpoof?.title ?? "", /^sentinel-spoofed\.md(?: ›|$)/);
});

test("folder retrieval diversity uses trusted sourcePath instead of section titles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-folder-source-diversity-"));
  const aiService = {
    async embed(texts) {
      return { model: "test", vectors: texts.map(() => [1, 0.25]) };
    },
  };
  const source = buildFolderEvidenceDocument({
    name: "跨文件检索",
    files: [
      {
        path: "a.md",
        content: Array.from({ length: 7 }, (_, index) => `# A 章节 ${index + 1}\n\nSHARED_LIMIT_TOKEN A-${index + 1} 的详细证据。`).join("\n\n"),
      },
      { path: "b.md", content: "# B 章节\n\nSHARED_LIMIT_TOKEN B 文件的唯一证据。" },
    ],
  });
  const index = await new KnowledgeIndex({ filePath: join(directory, "index.json"), aiService }).initialize();
  await index.indexTextDocument({
    document: { id: "folder-diversity", knowledgeBaseId: "kb-folder-diversity", filename: source.title },
    text: source.text,
    title: source.title,
    sourceType: source.sourceType,
    metadata: source.metadata,
  });
  const result = index.searchFast("SHARED_LIMIT_TOKEN", ["kb-folder-diversity"], 6);

  assert.ok(result.citations.some((citation) => citation.sourcePath === "b.md"));
  assert.ok(result.citations.filter((citation) => citation.sourcePath === "a.md").length <= 3);
});

test("legacy persisted folder chunks without sourcePath remain searchable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-folder-legacy-index-"));
  const indexPath = join(directory, "index.json");
  await writeFile(indexPath, `${JSON.stringify({
    version: 1,
    documents: {
      "legacy-folder-document": {
        documentId: "legacy-folder-document",
        knowledgeBaseId: "legacy-folder-kb",
        documentName: "旧文件夹（文件夹）",
        sourceType: "folder",
        chunks: [{
          id: "legacy-folder-document:legacy:0",
          knowledgeBaseId: "legacy-folder-kb",
          documentId: "legacy-folder-document",
          documentName: "旧文件夹（文件夹）",
          title: "文件：legacy.md",
          content: "LEGACY_FOLDER_TOKEN 旧索引仍然可检索。",
          ordinal: 0,
          sourceType: "folder",
          embedding: null,
          embeddingModel: null,
        }],
      },
    },
  })}\n`, "utf8");
  const index = await new KnowledgeIndex({
    filePath: indexPath,
    aiService: { async embed() { throw new Error("not used"); } },
  }).initialize();
  const result = index.searchFast("LEGACY_FOLDER_TOKEN", ["legacy-folder-kb"], 3);

  assert.equal(result.citations[0].documentId, "legacy-folder-document");
  assert.equal(result.citations[0].sourcePath, null);
});

test("large folder sources cap semantic work while keeping every chunk locally searchable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-folder-embedding-cap-"));
  let embeddedInputs = 0;
  const aiService = {
    async embed(texts) {
      embeddedInputs += texts.length;
      return { model: "test", vectors: texts.map(() => [1, 0.25]) };
    },
  };
  const files = Array.from({ length: 130 }, (_, index) => ({
    path: `notes/topic-${String(index).padStart(3, "0")}.md`,
    kind: "document",
    content: `${index === 129 ? "最后一个文件的独特结论" : `主题 ${index}`}\n${"背景材料".repeat(360)}`,
  }));
  const source = buildFolderEvidenceDocument({ name: "批量资料", files });
  const index = await new KnowledgeIndex({ filePath: join(directory, "index.json"), aiService }).initialize();
  const result = await index.indexTextDocument({
    document: { id: "folder-large", knowledgeBaseId: "kb-folder-large", filename: source.title },
    text: source.text,
    title: source.title,
    sourceType: source.sourceType,
    metadata: source.metadata,
  });
  assert.ok(result.chunkCount > 120);
  assert.equal(result.embeddedChunkCount, 120);
  assert.equal(embeddedInputs, 120);
  const fast = index.searchFast("最后一个文件 独特结论", ["kb-folder-large"], 3);
  assert.ok(fast.citations.length > 0);
  assert.match(`${fast.citations[0].title}\n${fast.citations[0].snippet}`, /topic-129|最后一个文件/);
  const deep = await index.searchDeep("最后一个文件 独特结论", ["kb-folder-large"], 3);
  assert.match(`${deep.citations[0].title}\n${deep.citations[0].snippet}`, /topic-129|最后一个文件/);
  assert.equal(embeddedInputs, 121);
});

test("knowledge extractors read HTML and Office XML without executing embedded content", async () => {
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const html = await extractUploadedDocument(
    Buffer.from("<html><body><h1>项目经验</h1><script>危险文本</script><p>支付网关</p></body></html>"),
    "profile.html",
    "text/html",
  );
  assert.match(html.text, /支付网关/);
  assert.doesNotMatch(html.text, /危险文本/);

  const docx = Buffer.from(zipSync({
    "word/document.xml": strToU8("<?xml version=\"1.0\"?><w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>令牌桶限流项目</w:t></w:r></w:p></w:body></w:document>"),
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types />"),
  }));
  const office = await extractUploadedDocument(
    docx,
    "resume.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.match(office.text, /令牌桶限流项目/);

  const pdf = await extractUploadedDocument(makeMinimalPdf("PDF searchable project"), "project.pdf", "application/pdf");
  assert.match(pdf.text, /PDF searchable project/);

  const image = await extractUploadedDocument(tinyPng, "whiteboard.png", "image/png", {
    ocr: { async recognizeImage() { return "系统设计白板：缓存与消息队列"; } },
  });
  assert.match(image.text, /系统设计白板/);
  let inferredExtension = null;
  await extractUploadedDocument(tinyPng, "clipboard", "image/png; charset=binary", {
    ocr: { async recognizeImage(_bytes, extension) { inferredExtension = extension; return "无扩展名图片"; } },
  });
  assert.equal(inferredExtension, ".png");
  let convertedGif = null;
  await extractUploadedDocument(
    Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
    "diagram.gif",
    "image/gif",
    { ocr: { async recognizeImage(bytes, extension) { convertedGif = { bytes, extension }; return "GIF 图示"; } } },
  );
  assert.equal(convertedGif.extension, ".png");
  assert.equal(convertedGif.bytes.subarray(1, 4).toString("ascii"), "PNG");
  await assert.rejects(
    extractUploadedDocument(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), "legacy.doc", "application/msword"),
    /暂不支持旧版/,
  );
});

test("knowledge extractor OCRs image-only pages inside an otherwise searchable PDF", async () => {
  let ocrCalls = 0;
  let ocrOptions = null;
  const extracted = await extractUploadedDocument(
    makeHybridPdf("Searchable first-page evidence"),
    "hybrid.pdf",
    "application/pdf",
    {
      ocr: {
        async recognizePdf(_bytes, options) {
          ocrCalls += 1;
          ocrOptions = options;
          return "[第 1 页]\nOCR duplicate that should not replace the text layer\n\n[第 2 页]\n扫描页的唯一项目结论";
        },
      },
    },
  );

  assert.equal(ocrCalls, 1);
  assert.deepEqual(ocrOptions, { pages: [2] });
  assert.match(extracted.text, /Searchable first-page evidence/);
  assert.match(extracted.text, /扫描页的唯一项目结论/);
  assert.doesNotMatch(extracted.text, /OCR duplicate that should not replace/);

  const partial = await extractUploadedDocument(
    makeHybridPdf("Searchable text survives OCR failure"),
    "hybrid-ocr-failure.pdf",
    "application/pdf",
    { ocr: { async recognizePdf() { throw new Error("forced OCR failure"); } } },
  );
  assert.match(partial.text, /Searchable text survives OCR failure/);
  assert.match(partial.text, /\[OCR 未完成\]/);
  assert.match(partial.text, /第 2 页包含扫描内容/);
});

function makeMinimalPdf(text) {
  const stream = `BT /F1 16 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

function makeHybridPdf(text) {
  const textStream = `BT /F1 16 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const imageStream = "q 500 0 0 700 50 50 cm /Im1 Do Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 8 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${Buffer.byteLength(textStream)} >>\nstream\n${textStream}\nendstream`,
    `<< /Length ${Buffer.byteLength(imageStream)} >>\nstream\n${imageStream}\nendstream`,
    "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n00>\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}
