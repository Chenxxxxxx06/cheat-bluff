export class AiServiceError extends Error {
  constructor(message, { code = "ai_provider_error", status = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AiServiceError";
    this.code = code;
    this.status = status;
    this.publicMessage = message;
  }
}

export function createQwenAiService(settingsStore, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");

  return {
    async complete({ messages, image = null, maxTokens = null, temperature = 0.25, onDelta = null, signal = null } = {}) {
      const credentials = settingsStore.getCredentials();
      const model = image ? credentials.visionModel : credentials.textModel;
      const providerMessages = attachImage(messages, image);
      const request = {
        fetchImpl,
        timeoutMs,
        credentials,
        model,
        messages: providerMessages,
        maxTokens: maxTokens ?? credentials.maxAnswerTokens ?? 1400,
        temperature,
        signal,
      };
      return typeof onDelta === "function"
        ? requestChatCompletionStream({ ...request, onDelta })
        : requestChatCompletion(request);
    },

    async embed(texts, options = {}) {
      if (!Array.isArray(texts) || texts.length === 0 || texts.length > 10) {
        throw new AiServiceError("单次 Embedding 请求必须包含 1–10 段文本。", { code: "ai_invalid_embedding_batch" });
      }
      const credentials = settingsStore.getCredentials();
      const payload = await requestJson({
        fetchImpl,
        timeoutMs: Number.isFinite(options.timeoutMs) ? Math.max(100, options.timeoutMs) : timeoutMs,
        url: `${credentials.baseUrl}/embeddings`,
        credentials,
        signal: options.signal,
        body: {
          model: credentials.embeddingModel,
          input: texts.map((text) => String(text ?? "").slice(0, 12_000)),
          encoding_format: "float",
        },
      });
      const vectors = [...(payload?.data ?? [])]
        .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
        .map((item) => item.embedding);
      if (vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || vector.length < 2)) {
        throw new AiServiceError("Embedding 服务返回了无效向量。", { code: "ai_invalid_embedding_response" });
      }
      return { model: payload.model ?? credentials.embeddingModel, vectors };
    },

    async testConnection() {
      const reply = await this.complete({
        messages: [
          { role: "system", content: "You are a connection test. Reply briefly." },
          { role: "user", content: "请只回复：连接成功" },
        ],
        maxTokens: 16,
        temperature: 0,
      });
      return { ok: true, reply };
    },

    async testVisionConnection() {
      const reply = await this.complete({
        messages: [
          { role: "system", content: "You are a connection test. Reply briefly." },
          { role: "user", content: "请识别图片并只回复：视觉连接成功" },
        ],
        image: {
          mimeType: "image/png",
          imageData: "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABv0lEQVR4nO3VSREDQRADwYUzEA22wBiGHp0RQlC6vveL3g7Ch/6bRpABMaDLLdSAGNA8hhrQHIQJ6qZ8QAxoHkMNaA7CBHVTPiAGNI+hBjQHYYK6KR8QA5rHUAOagzBB3ZQPiAHNY6gBzUGYoG7KB8SA5jHUgOYgTFA35QNiQPMYakBzECaom/IBMaB5DDWgOQgT1E35gBjQPIYa0ByECeqmfEAMaB5DDWgOwgR1Uz4gBjSPoQY0B2GCuikfEAOax1ADmoMwQd2UD4gBzWOoAc1BmKBuygfEgOYx1IDmIExQN+UDYkDzGGpAcxAmqJvyATGgeQw1oDkIE9RN+YAY0DyGGtAchAnqpnxADGgeQw1oDsIEdVM+IAY0j6EGNAdhgropHxADmsdQA5qDMEHdlA+IAc1jqAHNQZigbsoHxIDmMdSA5iBMUDflA2JA8xhqQHMQJqib8gExoHkMNaA5CBPUTfmAGNA8hhrQHIQJ6qZ8QAxoHkMNaA7CBHVTPiAGNI+hBjQHYYK6KR8QA5rHUAOagzBB3ZQPiAHNY6gBzUGYoG7KB8SA5jHUgOYgTFA35QNiQPMYakBzECaoOYuJ/qGFBZL3W232AAAAAElFTkSuQmCC",
        },
        maxTokens: 24,
        temperature: 0,
      });
      return { ok: true, reply };
    },

    getRuntimeConfig() {
      const settings = settingsStore.getPublicSettings();
      return {
        maxAnswerTokens: settings.maxAnswerTokens,
        autoAnswerCooldownMs: settings.autoAnswerCooldownMs,
      };
    },
  };
}

export function createUnavailableAiService() {
  return {
    async complete() {
      throw new AiServiceError("请先在“设置 → AI 与本地数据 → AI 模型”中配置 API Key。", {
        code: "ai_not_configured",
      });
    },
  };
}

async function requestChatCompletion({ fetchImpl, timeoutMs, credentials, model, messages, maxTokens, temperature, signal }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(`${credentials.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw providerHttpError(response.status, payload);
    const content = normalizeContent(payload?.choices?.[0]?.message?.content);
    if (!content) throw new AiServiceError("AI 服务返回了空内容。", { code: "ai_empty_response" });
    return content;
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    if (error?.name === "AbortError") {
      throw new AiServiceError(signal?.aborted ? "AI 请求已取消。" : "AI 请求超时，请检查网络或 Base URL。", {
        code: signal?.aborted ? "ai_cancelled" : "ai_timeout",
        cause: error,
      });
    }
    throw new AiServiceError("无法连接 AI 服务，请检查网络与 Base URL。", { code: "ai_network_error", cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

async function requestChatCompletionStream({ fetchImpl, timeoutMs, credentials, model, messages, maxTokens, temperature, onDelta, signal }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), Math.max(timeoutMs, 90_000));
  timeout.unref?.();
  let response;
  try {
    response = await fetchImpl(`${credentials.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, temperature }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await readJsonResponse(response);
      throw providerHttpError(response.status, payload);
    }
    if (!response.body) throw new AiServiceError("AI 服务没有返回流式响应。", { code: "ai_missing_stream" });
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let pending = "";
    let result = "";
    let totalBytes = 0;
    let streamCompleted = false;
    const consumeLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return;
      const raw = line.slice(5).trim();
      if (!raw) return;
      if (raw === "[DONE]") {
        streamCompleted = true;
        return;
      }
      let item;
      try {
        item = JSON.parse(raw);
      } catch {
        return;
      }
      if (item?.error) throw providerHttpError(Number(item.error.status ?? 500), item);
      if (item?.choices?.[0]?.finish_reason) streamCompleted = true;
      const rawContent = item?.choices?.[0]?.delta?.content;
      const delta = typeof rawContent === "string" ? rawContent : normalizeContent(rawContent);
      if (!delta) return;
      result += delta;
      if (result.length > 2_000_000) throw new AiServiceError("AI 流式响应过大。", { code: "ai_stream_too_large" });
      onDelta(delta);
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new AiServiceError("AI 流式响应超过 8 MB 限制。", { code: "ai_stream_too_large" });
        }
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) consumeLine(line);
      }
      pending += decoder.decode();
      if (pending.trim()) consumeLine(pending);
    } finally {
      reader.releaseLock();
    }
    if (!result.trim()) throw new AiServiceError("AI 服务返回了空的流式内容。", { code: "ai_empty_response" });
    if (!streamCompleted) {
      throw new AiServiceError("AI 流式连接在回答完成前中断，请重试。", { code: "ai_stream_incomplete" });
    }
    return result;
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    if (error?.name === "AbortError") throw new AiServiceError(signal?.aborted ? "AI 请求已取消。" : "AI 请求超时。", { code: signal?.aborted ? "ai_cancelled" : "ai_timeout", cause: error });
    throw new AiServiceError("无法连接 AI 服务，请检查网络与 Base URL。", { code: "ai_network_error", cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

async function requestJson({ fetchImpl, timeoutMs, url, credentials, body, signal = null }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw providerHttpError(response.status, payload);
    return payload;
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    if (error?.name === "AbortError") {
      throw new AiServiceError(signal?.aborted ? "Embedding 请求已取消。" : "Embedding 请求超时。", {
        code: signal?.aborted ? "ai_cancelled" : "ai_timeout",
        cause: error,
      });
    }
    throw new AiServiceError("无法连接 AI 服务。", { code: "ai_network_error", cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

function providerHttpError(status, payload) {
  const providerMessage = cleanProviderMessage(payload?.error?.message ?? payload?.message);
  const message = status === 401 || status === 403
    ? "API Key 无效、无权限，或与当前地域的 Base URL 不匹配。"
    : providerMessage ? `AI 服务返回错误：${providerMessage}` : `AI 服务返回 HTTP ${status}。`;
  return new AiServiceError(message, { status });
}

function attachImage(messages, image) {
  const cloned = Array.isArray(messages)
    ? messages.map((message) => ({ ...message }))
    : [];
  if (!image) return cloned;
  const mimeType = /^image\/[a-z0-9.+-]+$/i.test(image.mimeType ?? "") ? image.mimeType : "image/png";
  const imageData = String(image.imageData ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!imageData) throw new AiServiceError("截图内容为空，无法使用视觉模型。", { code: "ai_invalid_image" });
  const lastUserIndex = cloned.findLastIndex((message) => message.role === "user");
  const text = lastUserIndex >= 0 ? normalizeContent(cloned[lastUserIndex].content) : "请分析这张截图并回答其中的问题。";
  const content = [
    { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageData}` } },
    { type: "text", text: text || "请分析这张截图并回答其中的问题。" },
  ];
  if (lastUserIndex >= 0) cloned[lastUserIndex] = { ...cloned[lastUserIndex], content };
  else cloned.push({ role: "user", content });
  return cloned;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (!response.ok) return null;
    throw new AiServiceError("AI 服务返回了无法解析的响应。", { code: "ai_invalid_response" });
  }
}

function normalizeContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cleanProviderMessage(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}
