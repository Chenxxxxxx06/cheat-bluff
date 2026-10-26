import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { startReplicaApiServer } from "../out/main/local-api/server.mjs";
import { KnowledgeIndex } from "../out/main/knowledge/knowledge-index.mjs";

test("Chinese material-to-knowledge-to-card chain parses real bodies and preserves conversation context", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-feature-chain-"));
  const aiCalls = [];
  const aiService = {
    async embed(texts) {
      return { model: "test-embedding", vectors: texts.map(() => [1, 0.2, 0.1]) };
    },
    async complete(request) {
      aiCalls.push(request);
      const system = request.messages?.[0]?.content ?? "";
      if (system.includes("面试官 Agent")) return JSON.stringify({
        questions: [{ question: "你如何实现支付网关限流？", intent: "验证项目深度", evidenceIds: ["RESUME:L2-L2"] }],
      });
      if (system.includes("候选人 Agent")) return JSON.stringify({
        cards: [{ question: "你如何实现支付网关限流？", answer: "我使用 Go 实现了令牌桶限流。", evidenceIds: ["RESUME:L2-L2"], keywords: ["Go", "令牌桶"] }],
      });
      if (system.includes("追问 Agent")) return JSON.stringify({
        reviews: [{ question: "你如何实现支付网关限流？", followUps: ["如何验证？"], weaknesses: [] }],
      });
      if (system.includes("审核 Agent")) return JSON.stringify({
        audits: [{ question: "你如何实现支付网关限流？", verdict: "pass", safeAnswer: "我使用 Go 实现令牌桶限流，并通过压测验证。", evidenceIds: ["RESUME:L2-L2"], reason: "证据充分" }],
      });
      return "已基于真实材料完成中文准备。";
    },
  };
  const api = await startReplicaApiServer({ port: 0, authToken: "test", dataDirectory, aiService });
  context.after(async () => api.close());
  const base = `http://${api.host}:${api.port}`;
  const workspace = (await jsonRequest(`${base}/api/workspaces`, { method: "POST", body: {} })).workspace;

  const resumeDocx = Buffer.from(zipSync({
    "word/document.xml": strToU8("<?xml version=\"1.0\"?><w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>项目经历</w:t></w:r></w:p><w:p><w:r><w:t>支付网关：使用 Go 实现令牌桶限流，并通过压测验证。</w:t></w:r></w:p></w:body></w:document>"),
    "[Content_Types].xml": strToU8("<?xml version=\"1.0\"?><Types />"),
  }));
  const jdPdf = makeMinimalPdf("Senior Backend Engineer Responsibilities payment gateway Requirements Go Redis Kubernetes 5 years");
  const resume = await uploadWorkspaceFile(base, workspace.id, "resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", resumeDocx);
  const jd = await uploadWorkspaceFile(base, workspace.id, "job-description.pdf", "application/pdf", jdPdf);
  assert.equal(resume.extraction.status, "ready");
  assert.equal(jd.extraction.status, "ready");

  const firstRequestId = randomUUID();
  await jsonRequest(`${base}/api/workspaces/${workspace.id}/agent-turns`, {
    method: "POST",
    body: {
      clientRequestId: firstRequestId,
      message: "这两份文件用于中文面试，请读取正文并分析岗位。",
      attachmentAssetIds: [resume.assetId, jd.assetId],
    },
    expectedStatus: 202,
  });
  await readAgentEvents(`${base}/api/workspaces/${workspace.id}/agent-turns/${firstRequestId}/events`);
  const material = await jsonRequest(`${base}/api/workspaces/${workspace.id}/material`);
  assert.match(material.hydrated.resume.rawContent, /支付网关/);
  assert.match(material.hydrated.jobDescription.rawContent, /Senior Backend Engineer/);
  assert.equal(material.hydrated.resume.extraction.status, "ready");
  assert.equal(material.hydrated.jobDescription.extraction.status, "ready");
  assert.equal(material.hydrated.materialReadiness.ready, true);
  assert.ok(material.hydrated.candidateProfile.facts.length > 0);
  assert.ok(material.hydrated.jobProfile.sourceHash);
  const preparation = await jsonRequest(`${base}/api/workspaces/${workspace.id}/preparation`);
  assert.equal(preparation.snapshot.materialReadiness.ready, true);

  const secondRequestId = randomUUID();
  await jsonRequest(`${base}/api/workspaces/${workspace.id}/agent-turns`, {
    method: "POST",
    body: { clientRequestId: secondRequestId, message: "它出现流量突增时怎么办？" },
    expectedStatus: 202,
  });
  await readAgentEvents(`${base}/api/workspaces/${workspace.id}/agent-turns/${secondRequestId}/events`);
  const regularCalls = aiCalls.filter((call) => call.messages?.[0]?.content?.includes("面试准备助手"));
  assert.equal(regularCalls.length, 2);
  assert.match(regularCalls[1].messages[0].content, /必须使用简体中文/);
  assert.ok(regularCalls[1].messages.some((message) => message.role === "user" && message.content.includes("读取正文并分析岗位")), "the previous turn must be included for pronoun resolution");

  const knowledgeBase = (await jsonRequest(`${base}/api/knowledgeBases`, {
    method: "POST",
    body: { name: "项目代码" },
  })).knowledgeBase;
  await jsonRequest(`${base}/api/workspaces/${workspace.id}/preparation/intents`, {
    method: "POST",
    body: { expectedRevision: preparation.snapshot.revision, intent: { kind: "select_personal_knowledge_base", knowledgeBaseId: knowledgeBase.id } },
  });
  const source = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: {
      type: "code",
      name: "gateway-repo",
      repositoryUrl: "https://github.com/example/gateway",
      commit: "abc123",
      files: [
        { path: "src/limiter.ts", content: "export class TokenBucket { take() { return true; } }" },
        { path: "test/limiter.test.ts", content: "test('burst traffic', () => {});" },
      ],
    },
  });
  assert.equal(source.document.status, "ready");
  assert.equal(source.document.sourceType, "code");
  assert.equal(source.index.sourceType, "code");
  assert.equal(source.document.metadata.fileCount, 2);

  const folderPayload = {
    type: "folder",
    name: "本地面试资料",
    folderIdentity: "a".repeat(64),
    scanSummary: { skippedFileCount: 1 },
    files: [
      { path: "notes/architecture.md", kind: "document", content: "支付网关使用 Redis 缓存和 Kafka 消息队列。" },
      { path: "src/health.ts", kind: "code", content: "export function health() { return true; }" },
    ],
  };
  const folderSource = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: folderPayload,
  });
  assert.equal(folderSource.document.status, "ready");
  assert.equal(folderSource.document.sourceType, "folder");
  assert.equal(folderSource.document.metadata.fileCount, 2);
  assert.equal(folderSource.document.metadata.skippedCount, 1);
  assert.equal(folderSource.index.sourceType, "folder");
  const repeatedFolder = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: folderPayload,
  });
  assert.equal(repeatedFolder.document.id, folderSource.document.id);
  assert.equal(repeatedFolder.index.reused, true);
  const updatedFolder = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: {
      ...folderPayload,
      files: folderPayload.files.map((file, index) => index === 0
        ? { ...file, content: `${file.content}\n新增事实：熔断后进入降级队列。` }
        : file),
    },
  });
  assert.equal(updatedFolder.document.id, folderSource.document.id);
  assert.equal(updatedFolder.index.updated, true);
  assert.notEqual(updatedFolder.document.metadata.sourceHash, folderSource.document.metadata.sourceHash);
  const knowledgeDocuments = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/documents`);
  assert.equal(knowledgeDocuments.documents.length, 2, "an unchanged folder must not create a duplicate document");

  const cardResult = await jsonRequest(`${base}/api/workspaces/${workspace.id}/interview-cards`, {
    method: "POST",
    body: { count: 1, focus: "支付网关限流" },
  });
  assert.equal(cardResult.summary.verified, 1);
  assert.equal(cardResult.cards[0].source, "agent_generated_not_fact");
  assert.deepEqual(cardResult.cards[0].evidenceIds, ["RESUME:L2-L2"]);
});

test("a failed folder metadata commit restores the previous durable and in-memory index", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-folder-store-rollback-"));
  const aiService = {
    async embed(texts) { return { model: "test", vectors: texts.map(() => [1, 0.2]) }; },
    async complete() { return "unused"; },
  };
  const knowledgeIndex = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  const api = await startReplicaApiServer({ port: 0, authToken: "test", dataDirectory, aiService, knowledgeIndex });
  context.after(async () => api.close());
  const base = `http://${api.host}:${api.port}`;
  const knowledgeBase = (await jsonRequest(`${base}/api/knowledge-bases`, {
    method: "POST",
    body: { name: "替换回滚测试" },
  })).knowledgeBase;
  const originalPayload = {
    type: "folder",
    name: "transaction-folder",
    folderIdentity: "d".repeat(64),
    files: [{ path: "facts/version.md", kind: "document", content: "DURABLE_OLD_FACT 原版事实" }],
  };
  const original = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: originalPayload,
  });
  const originalMetadata = structuredClone(original.document.metadata);
  const originalUpdate = api.store.update.bind(api.store);
  let failReplacementCommit = true;
  api.store.update = async (mutator) => {
    if (!failReplacementCommit) return originalUpdate(mutator);
    failReplacementCommit = false;
    await mutator(api.store.state);
    throw new Error("simulated metadata persistence failure");
  };

  await assert.rejects(jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: {
      ...originalPayload,
      files: [{ ...originalPayload.files[0], content: "UNCOMMITTED_NEW_FACT 不应可检索" }],
    },
  }));

  const storedDocument = api.store.state.documents.find((item) => item.id === original.document.id);
  assert.deepEqual(storedDocument.metadata, originalMetadata);
  assert.match(knowledgeIndex.searchFast("DURABLE_OLD_FACT", [knowledgeBase.id], 3).citations[0]?.snippet ?? "", /DURABLE_OLD_FACT/);
  assert.deepEqual(knowledgeIndex.searchFast("UNCOMMITTED_NEW_FACT", [knowledgeBase.id], 3).citations, []);
  assert.deepEqual(knowledgeIndex.state.pendingDocumentReplacements, {});

  const reopened = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  assert.match(reopened.searchFast("DURABLE_OLD_FACT", [knowledgeBase.id], 3).citations[0]?.snippet ?? "", /DURABLE_OLD_FACT/);
  assert.deepEqual(reopened.searchFast("UNCOMMITTED_NEW_FACT", [knowledgeBase.id], 3).citations, []);
});

test("a failed replacement finalize serves the committed version and an identical retry heals the WAL", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-folder-finalize-retry-"));
  const aiService = {
    async embed(texts) { return { model: "test", vectors: texts.map(() => [1, 0.2]) }; },
    async complete() { return "unused"; },
  };
  const knowledgeIndex = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  const api = await startReplicaApiServer({ port: 0, authToken: "test", dataDirectory, aiService, knowledgeIndex });
  context.after(async () => api.close());
  const base = `http://${api.host}:${api.port}`;
  const knowledgeBase = (await jsonRequest(`${base}/api/knowledge-bases`, {
    method: "POST",
    body: { name: "替换完成重试测试" },
  })).knowledgeBase;
  const originalPayload = {
    type: "folder",
    name: "finalize-folder",
    folderIdentity: "f".repeat(64),
    files: [{ path: "facts/version.md", kind: "document", content: "FINALIZE_OLD_FACT 原版事实" }],
  };
  const original = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: originalPayload,
  });
  const replacementPayload = {
    ...originalPayload,
    files: [{ ...originalPayload.files[0], content: "FINALIZE_NEW_FACT 已提交的新事实" }],
  };
  const originalPersist = knowledgeIndex.persist.bind(knowledgeIndex);
  let replacementPersistCalls = 0;
  knowledgeIndex.persist = async () => {
    replacementPersistCalls += 1;
    if (replacementPersistCalls === 2) throw new Error("simulated replacement finalize persistence failure");
    return originalPersist();
  };

  await assert.rejects(jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: replacementPayload,
  }));
  const committedDocument = api.store.state.documents.find((item) => item.id === original.document.id);
  assert.notEqual(committedDocument.metadata.sourceHash, original.document.metadata.sourceHash);
  assert.match(knowledgeIndex.searchFast("FINALIZE_NEW_FACT", [knowledgeBase.id], 3).citations[0]?.snippet ?? "", /FINALIZE_NEW_FACT/);
  assert.deepEqual(knowledgeIndex.searchFast("FINALIZE_OLD_FACT", [knowledgeBase.id], 3).citations, []);
  assert.equal(Object.keys(knowledgeIndex.state.pendingDocumentReplacements).length, 1);

  knowledgeIndex.persist = originalPersist;
  const retried = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: replacementPayload,
  });
  assert.equal(retried.index.reused, true);
  assert.equal(retried.document.id, original.document.id);
  assert.deepEqual(knowledgeIndex.state.pendingDocumentReplacements, {});
  const reopened = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  assert.match(reopened.searchFast("FINALIZE_NEW_FACT", [knowledgeBase.id], 3).citations[0]?.snippet ?? "", /FINALIZE_NEW_FACT/);
  assert.deepEqual(reopened.searchFast("FINALIZE_OLD_FACT", [knowledgeBase.id], 3).citations, []);
});

test("startup rolls back a durable pending replacement when business metadata is still old", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-folder-pending-restart-"));
  const aiService = {
    async embed(texts) { return { model: "test", vectors: texts.map(() => [1, 0.2]) }; },
    async complete() { return "unused"; },
  };
  const initialApi = await startReplicaApiServer({ port: 0, authToken: "test", dataDirectory, aiService });
  const initialBase = `http://${initialApi.host}:${initialApi.port}`;
  const knowledgeBase = (await jsonRequest(`${initialBase}/api/knowledge-bases`, {
    method: "POST",
    body: { name: "pending 重启测试" },
  })).knowledgeBase;
  const imported = await jsonRequest(`${initialBase}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: {
      type: "folder",
      name: "restart-folder",
      folderIdentity: "e".repeat(64),
      files: [{ path: "facts/restart.md", kind: "document", content: "RESTART_OLD_FACT 旧元数据对应事实" }],
    },
  });
  await initialApi.close();

  const stagingIndex = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  await stagingIndex.beginDocumentReplacement({
    document: { ...imported.document, filename: "restart-folder" },
    text: "# 未提交替换\n\nRESTART_UNCOMMITTED_FACT 不应与旧元数据并存",
    title: "restart-folder",
    mediaType: "text/markdown",
    sourceType: "folder",
    metadata: { ...imported.document.metadata, sourceHash: "pending-new-hash" },
  });
  assert.match(stagingIndex.searchFast("RESTART_OLD_FACT", [knowledgeBase.id], 3).citations[0]?.snippet ?? "", /RESTART_OLD_FACT/);
  assert.deepEqual(stagingIndex.searchFast("RESTART_UNCOMMITTED_FACT", [knowledgeBase.id], 3).citations, []);
  assert.equal(Object.keys(stagingIndex.state.pendingDocumentReplacements).length, 1);

  const recoveringIndex = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  const restartedApi = await startReplicaApiServer({
    port: 0,
    authToken: "test",
    dataDirectory,
    aiService,
    knowledgeIndex: recoveringIndex,
  });
  context.after(async () => restartedApi.close());

  assert.match(recoveringIndex.searchFast("RESTART_OLD_FACT", [knowledgeBase.id], 3).citations[0]?.snippet ?? "", /RESTART_OLD_FACT/);
  assert.deepEqual(recoveringIndex.searchFast("RESTART_UNCOMMITTED_FACT", [knowledgeBase.id], 3).citations, []);
  assert.deepEqual(recoveringIndex.state.pendingDocumentReplacements, {});
});

test("startup finalizes a pending replacement when the internal store token was committed", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-folder-committed-restart-"));
  const aiService = {
    async embed(texts) { return { model: "test", vectors: texts.map(() => [1, 0.2]) }; },
    async complete() { return "unused"; },
  };
  const initialApi = await startReplicaApiServer({ port: 0, authToken: "test", dataDirectory, aiService });
  const initialBase = `http://${initialApi.host}:${initialApi.port}`;
  const knowledgeBase = (await jsonRequest(`${initialBase}/api/knowledge-bases`, {
    method: "POST",
    body: { name: "committed pending 重启测试" },
  })).knowledgeBase;
  const imported = await jsonRequest(`${initialBase}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: {
      type: "folder",
      name: "committed-restart-folder",
      folderIdentity: "f".repeat(64),
      files: [{ path: "facts/commit.md", kind: "document", content: "COMMIT_RESTART_OLD_FACT" }],
    },
  });
  await initialApi.close();

  const stagingIndex = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  const staged = await stagingIndex.beginDocumentReplacement({
    document: { ...imported.document, filename: "committed-restart-folder" },
    text: "# 已提交替换\n\nCOMMIT_RESTART_NEW_FACT 应在重启后保留",
    title: "committed-restart-folder",
    mediaType: "text/markdown",
    sourceType: "folder",
    metadata: { ...imported.document.metadata, sourceHash: "committed-new-hash" },
  });
  const committedAt = new Date().toISOString();
  await initialApi.store.update((state) => {
    const document = state.documents.find((item) => item.id === imported.document.id);
    document.metadata = { ...document.metadata, sourceHash: "committed-new-hash", indexedAt: committedAt };
    document.updatedAt = committedAt;
    state.sourceImports.push({
      id: randomUUID(),
      knowledgeBaseId: knowledgeBase.id,
      documentId: imported.document.id,
      sourceType: "folder",
      origin: "manual",
      importedAt: committedAt,
      indexReplacementToken: staged.replacementToken,
    });
  });

  const recoveringIndex = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  const restartedApi = await startReplicaApiServer({
    port: 0,
    authToken: "test",
    dataDirectory,
    aiService,
    knowledgeIndex: recoveringIndex,
  });
  context.after(async () => restartedApi.close());

  assert.match(recoveringIndex.searchFast("COMMIT_RESTART_NEW_FACT", [knowledgeBase.id], 3).citations[0]?.snippet ?? "", /COMMIT_RESTART_NEW_FACT/);
  assert.deepEqual(recoveringIndex.searchFast("COMMIT_RESTART_OLD_FACT", [knowledgeBase.id], 3).citations, []);
  assert.deepEqual(recoveringIndex.state.pendingDocumentReplacements, {});
  const publicDocument = restartedApi.store.state.documents.find((item) => item.id === imported.document.id);
  assert.equal(Object.hasOwn(publicDocument.metadata, "indexReplacementToken"), false);
});

test("a concurrent folder update and delete cannot leave an orphaned searchable index", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-folder-delete-race-"));
  let embeddingGate = null;
  const aiService = {
    async embed(texts) {
      if (embeddingGate) {
        const activeGate = embeddingGate;
        embeddingGate = null;
        activeGate.started();
        await activeGate.wait;
      }
      return { model: "test", vectors: texts.map(() => [1, 0.2]) };
    },
    async complete() { return "unused"; },
  };
  const knowledgeIndex = await new KnowledgeIndex({
    filePath: join(dataDirectory, "knowledge-index.json"),
    aiService,
  }).initialize();
  const api = await startReplicaApiServer({ port: 0, authToken: "test", dataDirectory, aiService, knowledgeIndex });
  context.after(async () => api.close());
  const base = `http://${api.host}:${api.port}`;
  const knowledgeBase = (await jsonRequest(`${base}/api/knowledge-bases`, { method: "POST", body: { name: "并发测试" } })).knowledgeBase;
  const payload = {
    type: "folder",
    name: "race-folder",
    folderIdentity: "b".repeat(64),
    files: [{ path: "notes/fact.md", kind: "document", content: "OLD_FACT 初始事实" }],
  };
  const initial = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, { method: "POST", body: payload });

  let signalStarted;
  let releaseEmbedding;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const wait = new Promise((resolve) => { releaseEmbedding = resolve; });
  embeddingGate = { started: signalStarted, wait };
  const updatePromise = jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: { ...payload, files: [{ ...payload.files[0], content: "CHANGED_FACT 更新事实" }] },
  });
  await started;
  let deleteSettled = false;
  const deletePromise = jsonRequest(`${base}/api/documents/${initial.document.id}`, { method: "DELETE" });
  deletePromise.then(() => { deleteSettled = true; }, () => { deleteSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(deleteSettled, false, "delete must wait for the in-flight index mutation");
  releaseEmbedding();
  await Promise.all([updatePromise, deletePromise]);

  const documents = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/documents`);
  assert.deepEqual(documents.documents, []);
  assert.deepEqual(knowledgeIndex.searchFast("CHANGED_FACT", [knowledgeBase.id], 3).citations, []);

  const firstImportPayload = {
    type: "folder",
    name: "first-import-race",
    folderIdentity: "c".repeat(64),
    files: [{ path: "facts/concurrent.md", kind: "document", content: "CONCURRENT_FIRST_IMPORT_FACT" }],
  };
  let signalFirstImportStarted;
  let releaseFirstImport;
  const firstImportStarted = new Promise((resolve) => { signalFirstImportStarted = resolve; });
  const firstImportWait = new Promise((resolve) => { releaseFirstImport = resolve; });
  embeddingGate = { started: signalFirstImportStarted, wait: firstImportWait };
  const firstImport = jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: firstImportPayload,
  });
  await firstImportStarted;
  let secondImportSettled = false;
  const secondImport = jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/sources`, {
    method: "POST",
    body: firstImportPayload,
  });
  secondImport.then(() => { secondImportSettled = true; }, () => { secondImportSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(secondImportSettled, false, "an identical first folder import must wait for the in-flight ingestion");
  releaseFirstImport();
  const [firstImported, secondImported] = await Promise.all([firstImport, secondImport]);
  assert.equal(secondImported.document.id, firstImported.document.id);
  assert.equal(secondImported.index.reused, true);
  const documentsAfterConcurrentImport = await jsonRequest(`${base}/api/knowledge-bases/${knowledgeBase.id}/documents`);
  assert.equal(documentsAfterConcurrentImport.documents.length, 1);
});

test("failed workspace extraction remains visibly not ready instead of degrading to a filename", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-material-failure-"));
  const api = await startReplicaApiServer({
    port: 0,
    authToken: "test",
    dataDirectory,
    aiService: { async complete() { return "已提示解析失败。"; } },
  });
  context.after(async () => api.close());
  const base = `http://${api.host}:${api.port}`;
  const workspace = (await jsonRequest(`${base}/api/workspaces`, { method: "POST", body: {} })).workspace;
  const broken = await uploadWorkspaceFile(base, workspace.id, "resume.pdf", "application/pdf", Buffer.from("not a pdf"));
  assert.equal(broken.extraction.status, "failed");
  assert.ok(broken.extraction.error);

  const requestId = randomUUID();
  await jsonRequest(`${base}/api/workspaces/${workspace.id}/agent-turns`, {
    method: "POST",
    body: { clientRequestId: requestId, message: "这是我的中文简历。", attachmentAssetIds: [broken.assetId] },
    expectedStatus: 202,
  });
  await readAgentEvents(`${base}/api/workspaces/${workspace.id}/agent-turns/${requestId}/events`);
  const material = await jsonRequest(`${base}/api/workspaces/${workspace.id}/material`);
  assert.equal(material.hydrated.resume.rawContent, null);
  assert.equal(material.hydrated.resume.extraction.status, "failed");
  assert.equal(material.hydrated.materialReadiness.ready, false);
  assert.match(material.hydrated.materialReadiness.missingLabels.join(" "), /解析失败/);
  assert.doesNotMatch(JSON.stringify(material.hydrated.resume), /本地材料附件/);
});

async function uploadWorkspaceFile(base, workspaceId, displayName, contentType, bytes) {
  const presign = await jsonRequest(`${base}/api/workspaces/${workspaceId}/attachments/presign`, {
    method: "POST",
    body: { displayName, contentType, sizeBytes: bytes.length },
  });
  const uploaded = await fetch(presign.uploadUrl, { method: "PUT", headers: presign.requiredHeaders, body: bytes });
  assert.equal(uploaded.status, 200);
  return jsonRequest(`${base}/api/workspaces/${workspaceId}/attachments/${presign.assetId}/confirm`, { method: "POST" });
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: "Bearer test",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  assert.equal(response.status, options.expectedStatus ?? 200, `${options.method ?? "GET"} ${url}: ${await response.clone().text()}`);
  return response.json();
}

async function readAgentEvents(url) {
  const response = await fetch(url, { headers: { Authorization: "Bearer test" } });
  assert.equal(response.status, 200);
  return response.text();
}

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
