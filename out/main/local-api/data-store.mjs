import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeCandidateMaterial } from "../knowledge/material-analysis.mjs";

const LEGAL_VERSION = "2026-03-11";

function now() {
  return new Date().toISOString();
}

function defaultState() {
  const createdAt = now();
  return {
    schemaVersion: 3,
    user: {
      id: "13e99f11-41a5-4b37-a8de-1f4ca548a03c",
      name: "本地用户",
      email: "local@example.invalid",
      emailVerified: true,
      image: null,
      phoneNumber: null,
      marketingConsent: false,
      consentMetadata: {
        legal: { version: LEGAL_VERSION, acceptedAt: createdAt },
        marketing: false,
      },
      createdAt,
      updatedAt: createdAt,
    },
    roleTracks: [],
    workspaces: [],
    workspaceMaterials: {},
    workspaceHistories: {},
    workspaceAgentStates: {},
    workspaceAgentTurns: {},
    workspaceCards: {},
    knowledgeBases: [],
    sourceImports: [],
    documents: [],
    interviews: [],
    personalLibrary: { version: 1, activeProfileId: null, profiles: [], sources: [], cards: [], jobs: [] },
    assets: {},
  };
}

function normalizeState(value) {
  const fallback = defaultState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const {
    marketplace: _removedMarketplace,
    quota: _removedQuota,
    ...localValue
  } = value;
  const normalized = {
    ...fallback,
    ...localValue,
    schemaVersion: 3,
    user: { ...fallback.user, ...(value.user ?? {}) },
    roleTracks: Array.isArray(value.roleTracks) ? value.roleTracks : [],
    workspaces: Array.isArray(value.workspaces) ? value.workspaces : [],
    workspaceMaterials: value.workspaceMaterials ?? {},
    workspaceHistories: value.workspaceHistories ?? {},
    workspaceAgentStates: value.workspaceAgentStates ?? {},
    workspaceAgentTurns: value.workspaceAgentTurns ?? {},
    workspaceCards: value.workspaceCards ?? {},
    knowledgeBases: Array.isArray(value.knowledgeBases)
      ? value.knowledgeBases.map(normalizeKnowledgeBase)
      : [],
    documents: Array.isArray(value.documents) ? value.documents : [],
    sourceImports: Array.isArray(value.sourceImports) ? value.sourceImports : [],
    interviews: Array.isArray(value.interviews) ? value.interviews : [],
    personalLibrary: value.personalLibrary?.version === 1 ? value.personalLibrary : fallback.personalLibrary,
    assets: value.assets ?? {},
  };
  for (const bundle of Object.values(normalized.workspaceMaterials)) {
    if (!bundle || typeof bundle !== "object") continue;
    if (bundle.material) delete bundle.material.marketplaceKnowledgeBaseIds;
    if (bundle.hydrated) delete bundle.hydrated.marketplaceKnowledgeBases;
    if (bundle.preparation) delete bundle.preparation.skippedOfficialQuestionBank;
  }
  return normalized;
}

export class ReplicaDataStore {
  constructor(dataDirectory, options = {}) {
    this.dataDirectory = dataDirectory;
    this.filePath = join(dataDirectory, "replica-data.json");
    this.uploadDirectory = join(dataDirectory, "uploads");
    this.state = defaultState();
    this.cipher = options.cipher ?? null;
    this.mutationQueue = Promise.resolve();
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.uploadDirectory, { recursive: true });
    try {
      const stored = await readFile(this.filePath, "utf8");
      this.state = normalizeState(JSON.parse(this.cipher ? this.cipher.decryptText(stored) : stored));
      if (this.cipher && !this.cipher.isEncrypted(stored)) await this.save();
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("本地业务数据无法读取；已停止启动以避免覆盖原数据。", { cause: error });
      await this.save();
    }
    return this;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async update(mutator) {
    const operation = this.mutationQueue.catch(() => undefined).then(async () => {
      const previousState = structuredClone(this.state);
      try {
        const result = await mutator(this.state);
        await this.save();
        return result;
      } catch (error) {
        this.state = previousState;
        throw error;
      }
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  async save() {
    const operation = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(this.dataDirectory, { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
      await writeFile(temporaryPath, this.cipher ? this.cipher.encryptText(serialized) : serialized, { mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  protectBytes(bytes) {
    return this.cipher ? this.cipher.encryptBuffer(bytes) : Buffer.from(bytes);
  }

  unprotectBytes(bytes) {
    return this.cipher ? this.cipher.decryptBuffer(bytes) : Buffer.from(bytes);
  }

  async deleteAsset(assetId) {
    if (!assetId || !Object.hasOwn(this.state.assets, assetId)) return;
    await rm(join(this.uploadDirectory, assetId), { force: true });
    delete this.state.assets[assetId];
    await this.save();
  }

  async deleteAssets(assetIds) {
    for (const assetId of new Set(assetIds ?? [])) {
      if (!assetId) continue;
      await rm(join(this.uploadDirectory, assetId), { force: true });
      delete this.state.assets[assetId];
    }
    await this.save();
  }

  async clearAll() {
    await rm(this.uploadDirectory, { recursive: true, force: true });
    await mkdir(this.uploadDirectory, { recursive: true });
    await rm(join(this.dataDirectory, "personal-materials"), { recursive: true, force: true });
    this.state = defaultState();
    await this.save();
  }

  newRoleTrack(input = {}) {
    const timestamp = now();
    return {
      id: randomUUID(),
      name: cleanName(input.name, "新的职业方向"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  newWorkspace(input = {}) {
    const timestamp = now();
    const id = randomUUID();
    const workspace = {
      id,
      roleTrackId: typeof input.roleTrackId === "string" ? input.roleTrackId : null,
      personalProfileId: input.personalProfileId ?? this.state.personalLibrary?.activeProfileId ?? null,
      name: cleanName(input.name, `面试准备 · ${new Date(timestamp).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})} · ${this.state.workspaces.length+1}`),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.workspaceMaterials[id] = createWorkspaceMaterial(id, timestamp);
    const personal = this.state.personalLibrary?.profiles.find(p => p.id === workspace.personalProfileId);
    if (personal?.defaultResume?.rawContent) {
      const bundle = this.state.workspaceMaterials[id];
      bundle.material.resumeId = personal.defaultResume.id;
      bundle.hydrated.resume = structuredClone(personal.defaultResume);
      bundle.hydrated.candidateProfile = analyzeCandidateMaterial(personal.defaultResume.rawContent, personal.defaultResume.id);
    }
    this.state.workspaceHistories[id] = { runs: [], messages: [], attachments: [] };
    this.state.workspaceAgentStates[id] = emptyAgentState();
    this.state.workspaceAgentTurns[id] = {};
    this.state.workspaceCards[id] = [];
    return workspace;
  }

  ensureWorkspaceData(workspaceId) {
    const timestamp = now();
    this.state.workspaceMaterials[workspaceId] ??= createWorkspaceMaterial(workspaceId, timestamp);
    this.state.workspaceHistories[workspaceId] ??= { runs: [], messages: [], attachments: [] };
    this.state.workspaceAgentStates[workspaceId] ??= emptyAgentState();
    this.state.workspaceAgentTurns[workspaceId] ??= {};
    this.state.workspaceCards[workspaceId] ??= [];
    this.state.workspaceMaterials[workspaceId].preparation ??= defaultPreparationState();
  }

  newKnowledgeBase(input = {}) {
    const timestamp = now();
    return {
      id: randomUUID(),
      name: cleanName(input.name, "未命名知识库"),
      description: typeof input.description === "string" ? input.description.trim() : null,
      type: "personal",
      visibility: "private",
      source: "personal",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  newDocument(input) {
    const timestamp = now();
    return {
      id: randomUUID(),
      knowledgeBaseId: input.knowledgeBaseId,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      status: "uploaded",
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
      sourceType: cleanName(input.sourceType, "text"),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  newInterview(input = {}) {
    const timestamp = now();
    return {
      id: randomUUID(),
      workspaceId: input.workspaceId ?? null,
      personalProfileId: input.workspaceId
        ? this.state.workspaces.find(item => item.id === input.workspaceId)?.personalProfileId ?? null
        : this.state.personalLibrary?.activeProfileId ?? null,
      title: cleanName(input.title, "实时面试"),
      language: cleanName(input.fallbackLanguage, "zh-CN"),
      status: "in_progress",
      startAt: timestamp,
      endAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      durationSeconds: null,
      transcripts: [],
      answers: [],
    };
  }
}

export function emptyAgentState() {
  return {
    status: "completed",
    activeRunId: null,
    activeRequestId: null,
    pendingInput: null,
  };
}

export function createWorkspaceMaterial(workspaceId, timestamp = now()) {
  return {
    preparation: defaultPreparationState(),
    material: {
      workspaceId,
      language: "zh-CN",
      uiLocale: "zh-CN",
      answerLanguage: "zh-CN",
      asrLanguage: "zh-CN",
      codeLanguage: "source",
      resumeId: null,
      jobDescriptionId: null,
      customInstructions: null,
      knowledgeBaseIds: [],
      skillProfileIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    hydrated: {
      language: "zh-CN",
      resume: null,
      jobDescription: null,
      candidateProfile: null,
      jobProfile: null,
      materialReadiness: { ready: false, failures: [] },
      customInstruction: null,
      customInstructions: null,
      personalKnowledgeBase: null,
      knowledgeBases: [],
      userSkills: [],
      skillProfiles: [],
    },
  };
}

function defaultPreparationState() {
  return {
    revision: 1,
    skippedKnowledgeBases: false,
  };
}

function normalizeKnowledgeBase(item) {
  return {
    ...item,
    type: "personal",
    visibility: "private",
    source: "personal",
    marketplaceId: undefined,
  };
}

export function cleanName(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback;
}

export function isoNow() {
  return now();
}

export function replicaSession(user) {
  const timestamp = now();
  return {
    session: {
      id: "3ca43faa-38dc-4f95-9174-7c80246108ae",
      token: "cheater-local-session",
      userId: user.id,
      expiresAt: "2099-12-31T23:59:59.000Z",
      createdAt: timestamp,
      updatedAt: timestamp,
      ipAddress: "127.0.0.1",
      userAgent: "Cheater Desktop Replica",
    },
    user,
  };
}
