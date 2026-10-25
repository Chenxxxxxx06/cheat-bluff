import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractUploadedDocument } from "./extractors.mjs";
import { FOLDER_FILE_SENTINEL_PREFIX } from "./folder-source.mjs";

const MAX_CHARS = 1_200;
const OVERLAP_CHARS = 180;
const EMBEDDING_BATCH_SIZE = 10;
const MAX_BULK_SOURCE_EMBEDDING_CHUNKS = 120;
const INDEX_EMBEDDING_BATCH_TIMEOUT_MS = 4_000;
const BULK_INDEX_EMBEDDING_BUDGET_MS = 10_000;
const DOCUMENT_INDEX_EMBEDDING_BUDGET_MS = 15_000;
const MAX_DOCUMENT_CHUNKS = 5_000;
const MAX_TOTAL_CHUNKS = 100_000;

export class KnowledgeIndex {
  constructor({ filePath, aiService, cipher = null, ocr = null }) {
    this.filePath = filePath;
    this.aiService = aiService;
    this.cipher = cipher;
    this.ocr = ocr;
    this.state = { version: 1, documents: {}, pendingDocumentReplacements: {} };
    this.lexicalCache = new Map();
    this.mutationQueue = Promise.resolve();
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    try {
      const stored = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(this.cipher ? this.cipher.decryptText(stored) : stored);
      if (parsed?.version === 1 && parsed.documents && typeof parsed.documents === "object") {
        this.state = {
          ...parsed,
          pendingDocumentReplacements: parsed.pendingDocumentReplacements
            && typeof parsed.pendingDocumentReplacements === "object"
            && !Array.isArray(parsed.pendingDocumentReplacements)
            ? parsed.pendingDocumentReplacements
            : {},
        };
      }
      if (this.cipher && !this.cipher.isEncrypted(stored)) await this.persist();
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("知识库索引无法读取；已停止启动以避免覆盖原索引。", { cause: error });
    }
    this.rebuildLexicalCache();
    return this;
  }

  async indexDocument({ document, asset, bytes }) {
    const extracted = await extractUploadedDocument(bytes, document.filename, document.contentType, { ocr: this.ocr });
    return this.indexTextDocument({
      document,
      asset,
      text: extracted.text,
      title: extracted.title,
      mediaType: extracted.mediaType,
      sourceType: document.sourceType ?? "text",
      metadata: document.metadata ?? {},
    });
  }

  async indexTextDocument(input) {
    return this.enqueueMutation(() => this.indexTextDocumentUnlocked(input));
  }

  async beginDocumentReplacement(input) {
    const replacementToken = randomUUID();
    const result = await this.enqueueMutation(() => this.indexTextDocumentUnlocked(input, { replacementToken }));
    return { ...result, replacementToken };
  }

  async indexTextDocumentUnlocked({ document, asset = null, text, title = null, mediaType = "text/plain", sourceType = "text", metadata = {}, skipEmbedding = false }, { replacementToken = null } = {}) {
    const activeReplacement = Object.values(this.state.pendingDocumentReplacements)
      .find((item) => item?.documentId === document.id);
    if (activeReplacement) throw new Error("该文档存在尚未完成的索引替换；请重启应用完成恢复后重试。");
    const allChunks = chunkText(text, title ?? document.filename);
    if (allChunks.length > MAX_DOCUMENT_CHUNKS) {
      throw new Error(`文档生成了 ${allChunks.length} 个片段，超过 ${MAX_DOCUMENT_CHUNKS} 个安全限制；请拆分文件后重试。`);
    }
    const existingChunkCount = Object.values(this.state.documents)
      .filter((item) => item.documentId !== document.id)
      .reduce((sum, item) => sum + (item.chunks?.length ?? 0), 0);
    if (existingChunkCount + allChunks.length > MAX_TOTAL_CHUNKS) {
      throw new Error(`知识库索引最多保存 ${MAX_TOTAL_CHUNKS} 个片段；请删除旧资料或拆分知识库后重试。`);
    }
    const chunks = allChunks.map((chunk) => ({
      id: `${document.id}:${createHash("sha256").update(chunk.content).digest("hex").slice(0, 20)}:${chunk.ordinal}`,
      knowledgeBaseId: document.knowledgeBaseId,
      documentId: document.id,
      documentName: document.filename,
      title: chunk.title,
      sourcePath: chunk.sourcePath ?? null,
      content: chunk.content,
      ordinal: chunk.ordinal,
      sourceType,
      embedding: null,
      embeddingModel: null,
    }));
    if (!chunks.length) throw new Error("文档没有生成可检索片段。");
    let retrievalMode = "lexical";
    const bulkSource = sourceType === "folder" || sourceType === "code";
    const embeddingChunks = bulkSource
      ? selectRepresentativeChunks(chunks, MAX_BULK_SOURCE_EMBEDDING_CHUNKS)
      : chunks;
    try {
      if (!skipEmbedding) await this.embedChunks(embeddingChunks, {
        totalBudgetMs: bulkSource ? BULK_INDEX_EMBEDDING_BUDGET_MS : DOCUMENT_INDEX_EMBEDDING_BUDGET_MS,
      });
    } catch (error) {
      console.warn("[knowledge] Embedding unavailable; indexed with BM25 only:", error?.publicMessage ?? error?.message ?? String(error));
    }
    const embeddedChunkCount = chunks.filter((chunk) => chunk.embedding).length;
    if (embeddedChunkCount) retrievalMode = "hybrid";
    const previousDocument = this.state.documents[document.id] ?? null;
    const previousKnowledgeBaseId = previousDocument?.knowledgeBaseId ?? null;
    if (replacementToken && !previousDocument) throw new Error("索引替换要求原文档仍然存在。");
    if (replacementToken) {
      this.state.pendingDocumentReplacements[replacementToken] = {
        token: replacementToken,
        documentId: document.id,
        previousDocument,
        stagedAt: new Date().toISOString(),
      };
    }
    this.state.documents[document.id] = {
      documentId: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      documentName: document.filename,
      mediaType,
      sourceType,
      metadata,
      assetId: asset?.id ?? document.assetId ?? null,
      indexedAt: new Date().toISOString(),
      chunks,
    };
    // A staged replacement is durable but deliberately invisible to searches
    // until the business metadata has committed its matching token.
    if (!replacementToken) {
      this.rebuildLexicalCache(document.knowledgeBaseId);
      if (previousKnowledgeBaseId && previousKnowledgeBaseId !== document.knowledgeBaseId) {
        this.rebuildLexicalCache(previousKnowledgeBaseId);
      }
    }
    try {
      await this.persist();
    } catch (error) {
      if (replacementToken) delete this.state.pendingDocumentReplacements[replacementToken];
      if (previousDocument) this.state.documents[document.id] = previousDocument;
      else delete this.state.documents[document.id];
      this.rebuildLexicalCache(document.knowledgeBaseId);
      if (previousKnowledgeBaseId && previousKnowledgeBaseId !== document.knowledgeBaseId) {
        this.rebuildLexicalCache(previousKnowledgeBaseId);
      }
      throw error;
    }
    return { chunkCount: chunks.length, embeddedChunkCount, retrievalMode, sourceType };
  }

  async commitDocumentReplacement(replacementToken) {
    return this.enqueueMutation(async () => {
      const pending = this.state.pendingDocumentReplacements[replacementToken];
      if (!pending) return false;
      delete this.state.pendingDocumentReplacements[replacementToken];
      const replacementDocument = this.state.documents[pending.documentId] ?? null;
      this.rebuildLexicalCache(replacementDocument?.knowledgeBaseId);
      if (replacementDocument?.knowledgeBaseId && pending.previousDocument?.knowledgeBaseId
        && replacementDocument.knowledgeBaseId !== pending.previousDocument.knowledgeBaseId) {
        this.rebuildLexicalCache(pending.previousDocument.knowledgeBaseId);
      }
      try {
        await this.persist();
      } catch (error) {
        // The caller invokes commit only after the business metadata journal is
        // durable. Keep the WAL entry for a later persistence retry, but serve
        // the matching replacement immediately instead of reverting live
        // queries to the old snapshot.
        pending.metadataCommitted = true;
        this.state.pendingDocumentReplacements[replacementToken] = pending;
        this.rebuildLexicalCache(replacementDocument?.knowledgeBaseId);
        if (replacementDocument?.knowledgeBaseId && pending.previousDocument?.knowledgeBaseId
          && replacementDocument.knowledgeBaseId !== pending.previousDocument.knowledgeBaseId) {
          this.rebuildLexicalCache(pending.previousDocument.knowledgeBaseId);
        }
        throw error;
      }
      return true;
    });
  }

  async rollbackDocumentReplacement(replacementToken) {
    return this.enqueueMutation(async () => {
      const pending = this.state.pendingDocumentReplacements[replacementToken];
      if (!pending) return false;
      const replacementDocument = this.state.documents[pending.documentId] ?? null;
      delete this.state.pendingDocumentReplacements[replacementToken];
      if (isIndexDocument(pending.previousDocument, pending.documentId)) {
        this.state.documents[pending.documentId] = pending.previousDocument;
      } else {
        delete this.state.documents[pending.documentId];
      }
      this.rebuildLexicalCache(replacementDocument?.knowledgeBaseId ?? pending.previousDocument?.knowledgeBaseId);
      if (replacementDocument?.knowledgeBaseId && pending.previousDocument?.knowledgeBaseId
        && replacementDocument.knowledgeBaseId !== pending.previousDocument.knowledgeBaseId) {
        this.rebuildLexicalCache(pending.previousDocument.knowledgeBaseId);
      }
      try {
        await this.persist();
      } catch (error) {
        // Keep serving the restored snapshot even if the disk rollback failed.
        // The durable pending record still contains the same snapshot, so the
        // next startup will retry recovery instead of exposing replacement data
        // beside stale business metadata.
        this.state.pendingDocumentReplacements[replacementToken] = pending;
        throw error;
      }
      return true;
    });
  }

  async recoverPendingDocumentReplacements(resolveDisposition) {
    return this.enqueueMutation(async () => {
      const pendingEntries = Object.entries(this.state.pendingDocumentReplacements);
      if (!pendingEntries.length) return { committed: 0, rolledBack: 0, discarded: 0 };
      const previousState = structuredClone(this.state);
      let committed = 0;
      let rolledBack = 0;
      let discarded = 0;
      try {
        for (const [replacementToken, pending] of pendingEntries) {
          const disposition = await resolveDisposition?.({
            replacementToken,
            documentId: pending?.documentId,
            stagedAt: pending?.stagedAt ?? null,
          });
          delete this.state.pendingDocumentReplacements[replacementToken];
          if (disposition === true || disposition === "commit") {
            committed += 1;
            continue;
          }
          if (disposition === "discard") {
            if (typeof pending?.documentId === "string") delete this.state.documents[pending.documentId];
            discarded += 1;
            continue;
          }
          if (isIndexDocument(pending?.previousDocument, pending?.documentId)) {
            this.state.documents[pending.documentId] = pending.previousDocument;
          } else if (typeof pending?.documentId === "string") {
            delete this.state.documents[pending.documentId];
          }
          rolledBack += 1;
        }
        this.rebuildLexicalCache();
        await this.persist();
      } catch (error) {
        this.state = previousState;
        this.rebuildLexicalCache();
        throw error;
      }
      return { committed, rolledBack, discarded };
    });
  }

  async removeDocument(documentId) {
    return this.enqueueMutation(async () => {
      const previousDocument = this.state.documents[documentId] ?? null;
      const removedPendingReplacements = Object.fromEntries(Object.entries(this.state.pendingDocumentReplacements)
        .filter(([, pending]) => pending?.documentId === documentId));
      const knowledgeBaseId = previousDocument?.knowledgeBaseId;
      delete this.state.documents[documentId];
      for (const replacementToken of Object.keys(removedPendingReplacements)) {
        delete this.state.pendingDocumentReplacements[replacementToken];
      }
      if (knowledgeBaseId) this.rebuildLexicalCache(knowledgeBaseId);
      try {
        await this.persist();
      } catch (error) {
        if (previousDocument) this.state.documents[documentId] = previousDocument;
        Object.assign(this.state.pendingDocumentReplacements, removedPendingReplacements);
        if (knowledgeBaseId) this.rebuildLexicalCache(knowledgeBaseId);
        throw error;
      }
    });
  }

  async removeKnowledgeBase(knowledgeBaseId) {
    return this.enqueueMutation(async () => {
      const removed = Object.fromEntries(Object.entries(this.state.documents)
        .filter(([, document]) => document.knowledgeBaseId === knowledgeBaseId));
      const removedPendingReplacements = Object.fromEntries(Object.entries(this.state.pendingDocumentReplacements)
        .filter(([, pending]) => pending?.previousDocument?.knowledgeBaseId === knowledgeBaseId
          || this.state.documents[pending?.documentId]?.knowledgeBaseId === knowledgeBaseId));
      for (const documentId of Object.keys(removed)) delete this.state.documents[documentId];
      for (const replacementToken of Object.keys(removedPendingReplacements)) {
        delete this.state.pendingDocumentReplacements[replacementToken];
      }
      this.lexicalCache.delete(knowledgeBaseId);
      try {
        await this.persist();
      } catch (error) {
        Object.assign(this.state.documents, removed);
        Object.assign(this.state.pendingDocumentReplacements, removedPendingReplacements);
        this.rebuildLexicalCache(knowledgeBaseId);
        throw error;
      }
    });
  }

  async clear() {
    return this.enqueueMutation(async () => {
      const previousState = this.state;
      this.state = { version: 1, documents: {}, pendingDocumentReplacements: {} };
      this.lexicalCache.clear();
      try {
        await this.persist();
      } catch (error) {
        this.state = previousState;
        this.rebuildLexicalCache();
        throw error;
      }
    });
  }

  async search(query, knowledgeBaseIds, limit = 6, options = {}) {
    return this.searchDeep(query, knowledgeBaseIds, limit, options);
  }

  searchFast(query, knowledgeBaseIds, limit = 6, options = {}) {
    const prepared = this.prepareSearch(query, knowledgeBaseIds, options);
    if (!prepared.chunks.length) return { query: prepared.normalized, retrievalMode: "none", citations: [] };
    const lexical = rankPreparedBm25(prepared.lexicalDocuments, prepared.normalized);
    return this.buildSearchResult(prepared.normalized, "lexical", lexical, limit);
  }

  async searchDeep(query, knowledgeBaseIds, limit = 6, options = {}) {
    const prepared = this.prepareSearch(query, knowledgeBaseIds, options);
    if (!prepared.chunks.length) return { query: prepared.normalized, retrievalMode: "none", citations: [] };
    throwIfAborted(options.signal);
    const lexical = rankPreparedBm25(prepared.lexicalDocuments, prepared.normalized);
    let ranked = lexical;
    let retrievalMode = "lexical";
    const embedded = prepared.chunks.filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 1);
    if (embedded.length) {
      try {
        const queryResult = await this.aiService.embed([prepared.normalized], {
          signal: options.signal,
          timeoutMs: options.timeoutMs,
        });
        throwIfAborted(options.signal);
        const queryVector = normalizeVector(queryResult.vectors[0]);
        const compatibleEmbedded = embedded
          .filter((chunk) => chunk.embeddingModel === queryResult.model && chunk.embedding.length === queryVector.length);
        const semantic = compatibleEmbedded
          .map((chunk) => ({ chunk, score: dotProduct(queryVector, chunk.embedding) }))
          .sort((left, right) => right.score - left.score);
        if (semantic.length) {
          const partialEmbeddingCoverage = compatibleEmbedded.length < prepared.chunks.length;
          ranked = reciprocalRankFusion(
            lexical,
            semantic,
            partialEmbeddingCoverage ? { lexical: 0.72, semantic: 0.28 } : undefined,
          );
          if (partialEmbeddingCoverage && lexical[0]) ranked = promoteRankedItem(ranked, lexical[0]);
          retrievalMode = "hybrid";
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        console.warn("[knowledge] Hybrid query fell back to BM25:", error?.publicMessage ?? error?.message ?? String(error));
      }
    }
    throwIfAborted(options.signal);
    return this.buildSearchResult(prepared.normalized, retrievalMode, ranked, limit);
  }

  prepareSearch(query, knowledgeBaseIds, options = {}) {
    const normalized = String(query ?? "").trim().slice(0, 4_000);
    const allowed = new Set((knowledgeBaseIds ?? []).filter((id) => typeof id === "string"));
    if (!normalized || !allowed.size) return { normalized, lexicalDocuments: [], chunks: [] };
    let lexicalDocuments = [...allowed].flatMap((knowledgeBaseId) => this.lexicalCache.get(knowledgeBaseId) ?? []);
    // Explicit project names constrain curated results, preventing another project's similar
    // terminology from outranking the project the interviewer actually named.
    const lowered=normalized.toLowerCase();
    const projects=new Set(lexicalDocuments.map(d=>this.state.documents[d.chunk.documentId]?.metadata?.project).filter(Boolean));
    const mentioned=typeof options.project==='string'?new Set([options.project]):new Set([...projects].filter(p=>p.length>=3&&lowered.includes(p.toLowerCase())));
    if(mentioned.size)lexicalDocuments=lexicalDocuments.filter(d=>{
      const project=this.state.documents[d.chunk.documentId]?.metadata?.project;
      return !project||mentioned.has(project);
    });
    return { normalized, lexicalDocuments, chunks: lexicalDocuments.map((document) => document.chunk) };
  }

  buildSearchResult(query, retrievalMode, ranked, limit) {
    const citations = [];
    const perSource = new Map();
    for (const item of ranked) {
      if (citations.length >= Math.max(1, Math.min(12, limit))) break;
      const sourceKey = item.chunk.sourceType === "folder" && item.chunk.sourcePath
        ? `${item.chunk.documentId}:${item.chunk.sourcePath}`
        : item.chunk.documentId;
      const count = perSource.get(sourceKey) ?? 0;
      if (count >= 3) continue;
      perSource.set(sourceKey, count + 1);
      const metadata=this.state.documents[item.chunk.documentId]?.metadata;
      const answer=metadata?.curatedAnswer;
      // Only the answer paragraph can produce an immediate hint. The same document's
      // attribution header and raw evidence chunks must not inherit that capability.
      const directAnswer=item.chunk.sourceType==="personal-card"&&answer?.version===1
        &&answer.origin==="codex_curated_with_sources"&&answer.evidenceVerified===true
        &&answer.revision===metadata.personalRevision&&["ready","confirmed"].includes(answer.status)
        &&(answer.kind!=="personal"||answer.status==="confirmed")
        &&typeof answer.answer==="string"&&answer.answer.length>=20
        &&item.chunk.content.includes(answer.answer.slice(0,Math.min(80,answer.answer.length)));
      citations.push({
        evidenceId: item.chunk.id,
        knowledgeBaseId: item.chunk.knowledgeBaseId,
        documentId: item.chunk.documentId,
        documentName: item.chunk.documentName,
        title: item.chunk.title,
        sourcePath: item.chunk.sourcePath ?? null,
        ordinal: item.chunk.ordinal,
        sourceType: item.chunk.sourceType ?? "text",
        ...(directAnswer?{personalRevision:metadata.personalRevision,curatedAnswer:{...answer,directAnswer:true}}:{}),
        snippet: item.chunk.content.slice(0, 1_000),
        score: Number(item.score.toFixed(6)),
      });
    }
    return { query, retrievalMode, citations };
  }

  async embedChunks(chunks, { totalBudgetMs = DOCUMENT_INDEX_EMBEDDING_BUDGET_MS } = {}) {
    const startedAt = Date.now();
    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const remainingBudgetMs = totalBudgetMs - (Date.now() - startedAt);
      if (remainingBudgetMs < 100) throw new Error("Embedding 入库超过时间预算，剩余片段改用 BM25。");
      const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const result = await this.aiService.embed(
        batch.map((chunk) => `${chunk.title}\n${chunk.content}`.slice(0, 8_000)),
        { timeoutMs: Math.min(INDEX_EMBEDDING_BATCH_TIMEOUT_MS, remainingBudgetMs) },
      );
      for (let index = 0; index < batch.length; index += 1) {
        batch[index].embedding = normalizeVector(result.vectors[index]);
        batch[index].embeddingModel = result.model;
      }
    }
  }

  rebuildLexicalCache(knowledgeBaseId = null) {
    const pendingByDocumentId = new Map(Object.values(this.state.pendingDocumentReplacements ?? {})
      .filter((pending) => pending?.metadataCommitted !== true
        && isIndexDocument(pending?.previousDocument, pending?.documentId))
      .map((pending) => [pending.documentId, pending.previousDocument]));
    // Replacements are durable before their matching business metadata is.
    // Continue serving the prior snapshot until the replacement is committed.
    const searchableDocuments = Object.values(this.state.documents)
      .map((document) => pendingByDocumentId.get(document.documentId) ?? document);
    const targetIds = knowledgeBaseId
      ? [knowledgeBaseId]
      : [...new Set(searchableDocuments.map((document) => document.knowledgeBaseId))];
    if (!knowledgeBaseId) this.lexicalCache.clear();
    for (const targetId of targetIds) {
      const chunks = searchableDocuments
        .filter((document) => document.knowledgeBaseId === targetId)
        .flatMap((document) => document.chunks ?? []);
      if (chunks.length) this.lexicalCache.set(targetId, prepareLexicalDocuments(chunks));
      else this.lexicalCache.delete(targetId);
    }
  }

  enqueueMutation(task) {
    const operation = this.mutationQueue.then(task);
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async persist() {
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      const serialized = `${JSON.stringify(this.state)}\n`;
      await writeFile(temporaryPath, this.cipher ? this.cipher.encryptText(serialized) : serialized, { mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}

function isIndexDocument(value, documentId) {
  return Boolean(value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof documentId === "string"
    && value.documentId === documentId
    && Array.isArray(value.chunks));
}

function selectRepresentativeChunks(chunks, limit) {
  if (chunks.length <= limit) return chunks;
  const groups = [...Map.groupBy(chunks, (chunk) => chunk.sourcePath
    ? `path:${chunk.sourcePath}`
    : `title:${chunk.title}`).values()];
  const selected = [];
  const selectedIds = new Set();
  const groupCount = Math.min(groups.length, limit);
  for (let index = 0; index < groupCount; index += 1) {
    const group = groups[Math.floor(index * groups.length / groupCount)];
    const representative = group.reduce((best, chunk) => chunk.content.length > best.content.length ? chunk : best);
    selected.push(representative);
    selectedIds.add(representative.id);
  }
  if (selected.length < limit) {
    const remaining = chunks.filter((chunk) => !selectedIds.has(chunk.id));
    const available = limit - selected.length;
    for (let index = 0; index < available; index += 1) {
      selected.push(remaining[Math.floor(index * remaining.length / available)]);
    }
  }
  return selected;
}

export function chunkText(text, fallbackTitle) {
  const cleaned = String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\t\f\v]+/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  let currentTitle = fallbackTitle;
  let currentFolderPath = null;
  const push = () => {
    const value = current.trim();
    if (!value) return;
    chunks.push({ title: currentTitle, sourcePath: currentFolderPath, content: value, ordinal: chunks.length });
    current = value.slice(Math.max(0, value.length - OVERLAP_CHARS));
  };
  for (const paragraph of paragraphs) {
    const folderBoundary = parseFolderFileBoundary(paragraph);
    let chunkParagraph = folderBoundary?.visibleContent ?? paragraph;
    if (folderBoundary) {
      if (current) push();
      current = "";
      currentFolderPath = folderBoundary.path;
      currentTitle = `文件：${folderBoundary.path}`;
    }
    const nextTitle = !folderBoundary
      && /^(?:#{1,6}\s+|第.+[章节]|[A-Z][A-Z\s]{3,}$)/.test(chunkParagraph)
      && chunkParagraph.length < 160
      ? chunkParagraph.replace(/^#+\s*/, "").trim()
      : null;
    if (nextTitle) {
      if (current) push();
      current = "";
      currentTitle = currentFolderPath ? `${currentFolderPath} › ${nextTitle}` : nextTitle;
    }
    if (!chunkParagraph) continue;
    if (chunkParagraph.length > MAX_CHARS) {
      if (current) push();
      for (let offset = 0; offset < chunkParagraph.length; offset += MAX_CHARS - OVERLAP_CHARS) {
        current = chunkParagraph.slice(offset, offset + MAX_CHARS);
        push();
      }
      current = "";
      continue;
    }
    const candidate = current ? `${current}\n\n${chunkParagraph}` : chunkParagraph;
    if (candidate.length > MAX_CHARS && current) push();
    current = current ? `${current}\n\n${chunkParagraph}` : chunkParagraph;
  }
  push();
  return chunks;
}

function parseFolderFileBoundary(paragraph) {
  if (!paragraph.startsWith(FOLDER_FILE_SENTINEL_PREFIX)) return null;
  const lineEnd = paragraph.indexOf("\n");
  const sentinel = lineEnd >= 0 ? paragraph.slice(0, lineEnd) : paragraph;
  const encodedPath = sentinel.slice(FOLDER_FILE_SENTINEL_PREFIX.length).match(/^([A-Za-z0-9_-]+) -->$/)?.[1];
  if (!encodedPath) return null;
  try {
    const path = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encodedPath, "base64url"));
    if (!path || Buffer.from(path, "utf8").toString("base64url") !== encodedPath) return null;
    return {
      path,
      visibleContent: lineEnd >= 0 ? paragraph.slice(lineEnd + 1).trim() : "",
    };
  } catch {
    return null;
  }
}

function tokenize(input) {
  const tokens = String(input ?? "").normalize("NFKC").toLowerCase().match(/[a-z0-9][a-z0-9_+.#-]{1,}|[\p{Script=Han}]/gu) ?? [];
  const result = [];
  let previousHan = null;
  for (const token of tokens) {
    if (/^\p{Script=Han}$/u.test(token)) {
      result.push(token);
      if (previousHan) result.push(previousHan + token);
      previousHan = token;
    } else {
      result.push(token);
      previousHan = null;
    }
  }
  return result;
}

function rankBm25(chunks, query) {
  return rankPreparedBm25(prepareLexicalDocuments(chunks), query);
}

function prepareLexicalDocuments(chunks) {
  return chunks.map((chunk) => {
    const tokens = tokenize(`${chunk.title} ${chunk.content}`);
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { chunk, length: tokens.length, frequencies, titleTokens: new Set(tokenize(chunk.title)) };
  });
}

function rankPreparedBm25(documents, query) {
  const terms = [...new Set(tokenize(query))];
  const documentFrequency = new Map();
  for (const document of documents) for (const term of document.frequencies.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const averageLength = documents.length ? documents.reduce((sum, document) => sum + document.length, 0) / documents.length : 1;
  return documents.flatMap((document) => {
    let score = 0;
    for (const term of terms) {
      const frequency = document.frequencies.get(term) ?? 0;
      if (!frequency) continue;
      const idf = Math.log(1 + (documents.length - (documentFrequency.get(term) ?? 0) + 0.5) / ((documentFrequency.get(term) ?? 0) + 0.5));
      score += idf * ((frequency * 2.45) / (frequency + 1.45 * (0.28 + 0.72 * document.length / averageLength)));
    }
    if (score <= 0) return [];
    return [{ chunk: document.chunk, score: score * (terms.some((term) => document.titleTokens.has(term)) ? 1.18 : 1) }];
  }).sort((left, right) => right.score - left.score);
}

function normalizeVector(vector) {
  if (!Array.isArray(vector) || vector.length < 2 || vector.some((value) => !Number.isFinite(value))) throw new Error("Embedding 返回了无效向量。");
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) throw new Error("Embedding 返回了零向量。");
  return vector.map((value) => Number((value / magnitude).toFixed(7)));
}

function dotProduct(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("知识检索已取消。");
}

function reciprocalRankFusion(lexical, semantic, weights = {}) {
  const combined = new Map();
  const add = (items, weight) => items.slice(0, 200).forEach((item, index) => {
    const existing = combined.get(item.chunk.id);
    combined.set(item.chunk.id, { chunk: item.chunk, score: (existing?.score ?? 0) + weight / (61 + index) });
  });
  add(lexical, weights.lexical ?? 0.44);
  add(semantic, weights.semantic ?? 0.56);
  return [...combined.values()].sort((left, right) => right.score - left.score);
}

function promoteRankedItem(ranked, item) {
  const index = ranked.findIndex((candidate) => candidate.chunk.id === item.chunk.id);
  if (index === 0) return ranked;
  const promoted = index >= 0 ? ranked[index] : item;
  return [promoted, ...ranked.filter((candidate) => candidate.chunk.id !== promoted.chunk.id)];
}
