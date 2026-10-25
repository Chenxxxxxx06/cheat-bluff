import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {randomUUID} from 'node:crypto';

export const DEFAULT_AI_SETTINGS = Object.freeze({
  provider: "custom",
  baseUrl: "https://api.example.invalid/v1",
  textModel: "your-text-model",
  visionModel: "your-vision-model",
  embeddingModel: "your-embedding-model",
  asrModel: "your-speech-model",
  asrUrl: "wss://speech.example.invalid/inference",
  maxAnswerTokens: 1400,
  autoAnswerCooldownMs: 700,
});

export class AiSettingsStore {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.state = {
      version: 5,
      ...DEFAULT_AI_SETTINGS,
      encryptedApiKey: null,
      encryptedAsrApiKey: null,
      updatedAt: null,
    };
  }

  async initialize() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.profiles=Array.isArray(parsed.connectionProfiles)?parsed.connectionProfiles:[];
      this.activeProfileId=parsed.activeProfileId??null;
      this.profileName=parsed.profileName||'当前连接';
      this.state = {
        ...this.state,
        provider: normalizeProvider(parsed.provider ?? this.state.provider),
        baseUrl: normalizeBaseUrl(parsed.baseUrl ?? this.state.baseUrl),
        textModel: normalizeModel(parsed.textModel ?? this.state.textModel, "textModel"),
        visionModel: normalizeModel(parsed.visionModel ?? this.state.visionModel, "visionModel"),
        embeddingModel: normalizeModel(parsed.embeddingModel ?? this.state.embeddingModel, "embeddingModel"),
        asrModel: normalizeModel(parsed.asrModel ?? this.state.asrModel, "asrModel"),
        asrUrl: normalizeWebSocketUrl(parsed.asrUrl ?? this.state.asrUrl),
        maxAnswerTokens: normalizeInteger(parsed.maxAnswerTokens, 256, 8_000, this.state.maxAnswerTokens),
        autoAnswerCooldownMs: normalizeInteger(
          Number(parsed.version ?? 0) < 5 && parsed.autoAnswerCooldownMs === 1500
            ? DEFAULT_AI_SETTINGS.autoAnswerCooldownMs
            : parsed.autoAnswerCooldownMs,
          500,
          10_000,
          this.state.autoAnswerCooldownMs,
        ),
        encryptedApiKey: typeof parsed.encryptedApiKey === "string" ? parsed.encryptedApiKey : null,
        // Single-key mode intentionally drops legacy ASR-specific credentials.
        encryptedAsrApiKey: parsed.provider==='custom'&&typeof parsed.encryptedAsrApiKey==='string'?parsed.encryptedAsrApiKey:null,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      };
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn("[ai-settings] Ignoring unreadable settings file.");
    }
    return this;
  }

  getPublicSettings() {
    return {
      profileName:this.profileName||'当前连接',activeProfileId:this.activeProfileId??null,
      connectionProfiles:(this.profiles??[]).map(p=>({id:p.id,name:p.name,provider:p.settings.provider,baseUrl:p.settings.baseUrl,textModel:p.settings.textModel})),
      provider: this.state.provider,
      baseUrl: this.state.baseUrl,
      textModel: this.state.textModel,
      visionModel: this.state.visionModel,
      embeddingModel: this.state.embeddingModel,
      asrModel: this.state.asrModel,
      asrUrl: this.state.asrUrl,
      maxAnswerTokens: this.state.maxAnswerTokens,
      autoAnswerCooldownMs: this.state.autoAnswerCooldownMs,
      hasApiKey: Boolean(this.state.encryptedApiKey),
      hasSeparateAsrApiKey: Boolean(this.state.encryptedAsrApiKey),
      singleApiKeyMode: !this.state.encryptedAsrApiKey,
      allowCopilotFallback: false,
      updatedAt: this.state.updatedAt,
    };
  }

  async save(input = {}) {
    if(input.profileAction)return this.manageProfile(input);
    if (input.provider && !["qwen", "custom"].includes(input.provider)) {
      throw new AiConfigurationError("当前统一 API Key 模式支持百炼或自定义 OpenAI 兼容连接。");
    }
    const submittedApiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const submittedAsrKey = typeof input.asrApiKey === "string" ? input.asrApiKey.trim() : "";
    if ((input.provider??this.state.provider)!=='custom'&&submittedAsrKey && submittedAsrKey !== submittedApiKey) {
      throw new AiConfigurationError("当前版本只允许一个统一 API Key；ASR 不得配置不同凭证。");
    }
    const next = {
      ...this.state,
      provider: normalizeProvider(input.provider ?? this.state.provider),
      baseUrl: normalizeBaseUrl(input.baseUrl ?? this.state.baseUrl),
      textModel: normalizeModel(input.textModel ?? this.state.textModel, "textModel"),
      visionModel: normalizeModel(input.visionModel ?? this.state.visionModel, "visionModel"),
      embeddingModel: normalizeModel(input.embeddingModel ?? this.state.embeddingModel, "embeddingModel"),
      asrModel: normalizeModel(input.asrModel ?? this.state.asrModel, "asrModel"),
      asrUrl: normalizeWebSocketUrl(input.asrUrl ?? this.state.asrUrl),
      maxAnswerTokens: normalizeInteger(input.maxAnswerTokens, 256, 8_000, this.state.maxAnswerTokens),
      autoAnswerCooldownMs: normalizeInteger(input.autoAnswerCooldownMs, 500, 10_000, this.state.autoAnswerCooldownMs),
      updatedAt: new Date().toISOString(),
    };
    if (submittedApiKey) next.encryptedApiKey = this.encryptApiKey(submittedApiKey);
    if(next.provider==='custom'){if(submittedAsrKey)next.encryptedAsrApiKey=this.encryptApiKey(submittedAsrKey);if(input.clearAsrKey)next.encryptedAsrApiKey=null;}else next.encryptedAsrApiKey=null;
    if(input.profileName!==undefined){const name=String(input.profileName).trim();if(!name||name.length>60)throw new AiConfigurationError('连接名称请输入1–60字。');this.profileName=name;}
    this.state = next;
    await this.persist();
    return this.getPublicSettings();
  }

  async clearApiKey() {
    this.state = { ...this.state, encryptedApiKey: null, encryptedAsrApiKey: null, updatedAt: new Date().toISOString() };
    await this.persist();
    return this.getPublicSettings();
  }

  getCredentials() {
    if (!this.state.encryptedApiKey) {
      throw new AiConfigurationError("请先在“设置 → AI 与本地数据 → AI 模型”中填写 API Key。");
    }
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new AiConfigurationError("当前系统安全存储不可用，无法解密 API Key。");
    }
    let apiKey;
    let asrApiKey;
    try {
      apiKey = this.safeStorage.decryptString(Buffer.from(this.state.encryptedApiKey, "base64"));
      asrApiKey = this.state.encryptedAsrApiKey?this.safeStorage.decryptString(Buffer.from(this.state.encryptedAsrApiKey,'base64')):apiKey;
    } catch {
      throw new AiConfigurationError("API Key 无法解密，请清除后重新填写。");
    }
    return {
      apiKey,
      asrApiKey,
      baseUrl: this.state.baseUrl,
      textModel: this.state.textModel,
      visionModel: this.state.visionModel,
      embeddingModel: this.state.embeddingModel,
      asrModel: this.state.asrModel,
      asrUrl: this.state.asrUrl,
      maxAnswerTokens: this.state.maxAnswerTokens,
      autoAnswerCooldownMs: this.state.autoAnswerCooldownMs,
    };
  }

  getAsrCredentials() {
    const encryptedCredential = this.state.encryptedAsrApiKey||this.state.encryptedApiKey;
    if (!encryptedCredential) {
      throw new AiConfigurationError("请在“设置 → AI 与本地数据 → AI 模型”中填写统一 API Key，才能使用实时转写。");
    }
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new AiConfigurationError("当前系统安全存储不可用，无法解密 ASR API Key。");
    }
    let asrApiKey;
    try {
      asrApiKey = this.safeStorage.decryptString(Buffer.from(encryptedCredential, "base64"));
    } catch {
      throw new AiConfigurationError("ASR API Key 无法解密，请清除后重新填写。");
    }
    return {
      apiKey: asrApiKey,
      asrApiKey,
      asrModel: this.state.asrModel,
      asrUrl: this.state.asrUrl,
    };
  }

  encryptApiKey(apiKey) {
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new AiConfigurationError("当前系统安全存储不可用，因此不会以明文保存 API Key。");
    }
    return this.safeStorage.encryptString(apiKey).toString("base64");
  }

  async persist() {
    this.profiles??=[];
    this.activeProfileId??=randomUUID();
    const profile={id:this.activeProfileId,name:this.profileName||'当前连接',settings:structuredClone(this.state)};
    const index=this.profiles.findIndex(p=>p.id===profile.id);if(index<0)this.profiles.push(profile);else this.profiles[index]=profile;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({...this.state,profileName:profile.name,activeProfileId:this.activeProfileId,connectionProfiles:this.profiles}, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
  async manageProfile(input){
    if(!['create','activate','remove'].includes(input.profileAction))throw new AiConfigurationError('未知连接操作。');
    await this.persist();
    if(input.profileAction==='create'){
      if(this.profiles.length>=30)throw new AiConfigurationError('最多保存30个连接。');
      this.activeProfileId=randomUUID();this.profileName='新连接';
      this.state={version:6,...DEFAULT_AI_SETTINGS,provider:'custom',baseUrl:'https://api.example.invalid/v1',textModel:'your-text-model',visionModel:'your-text-model',embeddingModel:'your-embedding-model',encryptedApiKey:null,encryptedAsrApiKey:null,updatedAt:new Date().toISOString()};
    }else{
      const selected=this.profiles.find(p=>p.id===input.profileId);if(!selected)throw new AiConfigurationError('连接不存在。');
      if(input.profileAction==='remove'){
        if(this.profiles.length===1)throw new AiConfigurationError('请至少保留一个连接。');
        this.profiles=this.profiles.filter(p=>p.id!==input.profileId);
        if(this.activeProfileId!==input.profileId){await this.persist();return this.getPublicSettings();}
      }
      const next=input.profileAction==='remove'?this.profiles[0]:selected;
      this.activeProfileId=next.id;this.profileName=next.name;this.state=structuredClone(next.settings);
    }
    await this.persist();return this.getPublicSettings();
  }
}

export class AiConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AiConfigurationError";
    this.code = "ai_configuration_error";
    this.publicMessage = message;
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AiConfigurationError("Base URL 格式不正确。");
  }
  const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(localHost && parsed.protocol === "http:")) {
    throw new AiConfigurationError("Base URL 必须使用 HTTPS（本机 localhost 可使用 HTTP）。");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeProvider(value) {
  const provider = String(value ?? "").trim();
  if (["qwen","custom"].includes(provider)) return provider;
  if (provider === "github-copilot") return "qwen";
  throw new AiConfigurationError("请选择 Qwen 或自定义兼容接口。");
}

function normalizeModel(value, fieldName) {
  const model = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._:/-]{1,128}$/.test(model)) {
    throw new AiConfigurationError(`${fieldName} 不是有效的模型名称。`);
  }
  return model;
}

function normalizeWebSocketUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    throw new AiConfigurationError("ASR WebSocket URL 格式不正确。");
  }
  if (parsed.protocol !== "wss:") throw new AiConfigurationError("ASR WebSocket URL 必须使用 WSS。 ");
  parsed.hash = "";
  return parsed.toString();
}

function normalizeInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
