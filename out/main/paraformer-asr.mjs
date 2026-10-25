import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const MAX_QUEUED_AUDIO_BYTES = 2 * 1024 * 1024;
const PCM_CHUNK_BYTES = 3_200;
const DEFAULT_FALLBACK_MODEL = "paraformer-realtime-v2";
const DEFAULT_BACKGROUND_RETRY_MS = 30_000;
const RECONNECT_DUPLICATE_WINDOW_MS = 30_000;

export function createParaformerAsrService(settingsStore, options = {}) {
  const service = {
    createSession(callbacks = {}, sessionOptions = {}) {
      const getCredentials = () => settingsStore.getAsrCredentials?.() ?? settingsStore.getCredentials();
      const credentials = getCredentials();
      return new ParaformerSession(credentials, callbacks, options.WebSocketImpl ?? WebSocket, {
        channel: sessionOptions.channel ?? "right",
        maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
        reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? 500,
        backgroundRetryMs: options.backgroundRetryMs ?? DEFAULT_BACKGROUND_RETRY_MS,
        fallbackModel: options.fallbackModel === false
          ? null
          : String(options.fallbackModel ?? DEFAULT_FALLBACK_MODEL).trim() || null,
        getCredentials,
      });
    },
    async testConnection(timeoutMs = 12_000) {
      return new Promise((resolve, reject) => {
        let session = null;
        let settled = false;
        const finish = (error = null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          session?.close();
          if (error) reject(error);
          else resolve({ ok: true });
        };
        const timer = setTimeout(() => finish(new Error("实时语音连接测试超时。")), timeoutMs);
        timer.unref?.();
        try {
          session = service.createSession({
            onStatus: (state) => {
              if (state === "ready" || state === "reconnected") finish();
            },
            onError: (message) => finish(new Error(message)),
          });
        } catch (error) {
          finish(error);
        }
      });
    },
  };
  return service;
}

export function createUnavailableAsrService() {
  return {
    createSession() {
      throw new Error("请先配置支持实时语音识别的 API Key。");
    },
  };
}

class ParaformerSession {
  constructor(credentials, callbacks, WebSocketImpl, options) {
    this.credentials = credentials;
    this.getCredentials = options.getCredentials;
    this.callbacks = callbacks;
    this.WebSocketImpl = WebSocketImpl;
    this.channel = options.channel === "left" ? "left" : "right";
    this.maxReconnectAttempts = options.maxReconnectAttempts;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs;
    this.backgroundRetryMs = Math.max(10, options.backgroundRetryMs);
    this.primaryModel = credentials.asrModel;
    this.fallbackModel = options.fallbackModel && options.fallbackModel !== this.primaryModel
      ? options.fallbackModel
      : null;
    this.activeModel = this.primaryModel;
    this.usingFallback = false;
    this.manualOnly = false;
    this.taskId = null;
    this.socket = null;
    this.taskStarted = false;
    this.closed = false;
    this.reconnectAttempts = 0;
    this.totalFailures = 0;
    this.reconnectTimer = null;
    this.audioQueue = [];
    this.queuedBytes = 0;
    this.acceptQueuedAudio = true;
    this.connectionGeneration = 0;
    this.lastFinalTranscript = null;
    this.reconnectDuplicateCandidate = null;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    try {
      this.credentials = this.getCredentials?.() ?? this.credentials;
      this.primaryModel = this.credentials.asrModel;
      if (!this.usingFallback) this.activeModel = this.primaryModel;
    } catch (error) {
      this.handleConnectionFailure(
        null,
        safeText(error?.publicMessage ?? error?.message ?? "语音识别配置无法读取。"),
        false,
        "asr_configuration_failed",
      );
      return;
    }
    this.taskId = randomUUID();
    this.taskStarted = false;
    this.callbacks.onStatus?.(this.totalFailures ? "reconnecting" : "connecting", {
      attempt: this.totalFailures,
      channel: this.channel,
      model: this.activeModel,
      fallback: this.usingFallback,
      manualOnly: this.manualOnly,
    });
    let socket;
    try {
      socket = new this.WebSocketImpl(this.credentials.asrUrl, {
        headers: {
          Authorization: `Bearer ${this.credentials.asrApiKey ?? this.credentials.apiKey}`,
          "User-Agent": "Cheater-Desktop/0.3.1",
        },
        handshakeTimeout: 15_000,
        maxPayload: 4 * 1024 * 1024,
      });
    } catch (error) {
      this.handleConnectionFailure(
        null,
        `语音识别连接创建失败：${safeText(error?.message)}`,
        true,
        "asr_connection_create_failed",
      );
      return;
    }
    socket.cheaterFailureHandled = false;
    this.socket = socket;
    socket.on("open", () => {
      if (socket !== this.socket || this.closed) return;
      try {
        socket.send(JSON.stringify({
          header: { action: "run-task", task_id: this.taskId, streaming: "duplex" },
          payload: {
            task_group: "audio",
            task: "asr",
            function: "recognition",
            model: this.activeModel,
            parameters: asrParameters(this.activeModel),
            input: {},
          },
        }));
      } catch (error) {
        this.handleConnectionFailure(socket, `语音识别启动失败：${safeText(error?.message)}`, true, "asr_start_failed");
      }
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary || socket !== this.socket || this.closed) return;
      this.handleEvent(String(data));
    });
    socket.on("unexpected-response", (_request, response) => {
      const authenticationFailed = response.statusCode === 401 || response.statusCode === 403;
      this.handleConnectionFailure(
        socket,
        authenticationFailed
          ? "语音识别鉴权失败，请检查 API Key 和地域。"
          : `语音识别握手失败（HTTP ${response.statusCode}）。`,
        !authenticationFailed,
        authenticationFailed ? "asr_authentication_failed" : `asr_http_${response.statusCode}`,
      );
    });
    socket.on("error", (error) => this.handleConnectionFailure(
      socket,
      error?.message ? `语音识别连接失败：${safeText(error.message)}` : "语音识别连接失败。",
      true,
      "asr_connection_failed",
    ));
    socket.on("close", () => {
      if (!this.closed && socket === this.socket && !socket.cheaterFailureHandled) {
        this.handleConnectionFailure(socket, "语音识别连接意外断开。", true, "asr_connection_closed");
      }
    });
  }

  pushStereoPcm(bytes) {
    if (this.closed || !bytes?.byteLength) return;
    const mono = extractAudioChannel(Buffer.from(bytes), this.channel);
    for (let offset = 0; offset < mono.byteLength; offset += PCM_CHUNK_BYTES) {
      const chunk = mono.subarray(offset, Math.min(mono.byteLength, offset + PCM_CHUNK_BYTES));
      if (this.taskStarted && this.socket?.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(chunk, { binary: true });
        } catch (error) {
          this.handleConnectionFailure(
            this.socket,
            `语音数据发送失败：${safeText(error?.message)}`,
            true,
            "asr_audio_send_failed",
          );
          break;
        }
      } else if (this.acceptQueuedAudio) {
        this.audioQueue.push(Buffer.from(chunk));
        this.queuedBytes += chunk.byteLength;
        while (this.queuedBytes > MAX_QUEUED_AUDIO_BYTES && this.audioQueue.length) {
          this.queuedBytes -= this.audioQueue.shift().byteLength;
        }
      }
    }
  }

  handleEvent(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const event = message?.header?.event;
    if (event === "task-started") {
      const completedAttempt = this.reconnectAttempts;
      const completedFailures = this.totalFailures;
      const recoveredFromManualOnly = this.manualOnly;
      this.reconnectAttempts = 0;
      this.totalFailures = 0;
      this.manualOnly = false;
      this.acceptQueuedAudio = true;
      this.taskStarted = true;
      this.connectionGeneration += 1;
      this.reconnectDuplicateCandidate = (completedFailures || recoveredFromManualOnly) && this.lastFinalTranscript
        ? { ...this.lastFinalTranscript }
        : null;
      this.callbacks.onStatus?.(completedFailures || recoveredFromManualOnly ? "reconnected" : "ready", {
        attempt: completedFailures || completedAttempt,
        channel: this.channel,
        model: this.activeModel,
        fallback: this.usingFallback,
        manualOnly: false,
      });
      try {
        for (const chunk of this.audioQueue) this.socket?.send(chunk, { binary: true });
      } catch (error) {
        this.handleConnectionFailure(
          this.socket,
          `缓存语音发送失败：${safeText(error?.message)}`,
          true,
          "asr_audio_flush_failed",
        );
        return;
      }
      this.audioQueue = [];
      this.queuedBytes = 0;
      return;
    }
    if (event === "result-generated") {
      const sentence = message?.payload?.output?.sentence;
      const text = String(sentence?.text ?? "").trim();
      if (!text || sentence?.heartbeat === true) return;
      const beginTime = Number.isFinite(sentence?.begin_time) ? sentence.begin_time : 0;
      const endTime = Number.isFinite(sentence?.end_time) ? sentence.end_time : null;
      const sentenceId = Number.isInteger(sentence?.sentence_id) ? sentence.sentence_id : beginTime;
      const isFinal = sentence?.sentence_end === true;
      const normalizedText = normalizeTranscriptText(text);
      if (this.reconnectDuplicateCandidate) {
        if (!isFinal) return;
        const duplicate = normalizedText === this.reconnectDuplicateCandidate.normalizedText
          && Date.now() - this.reconnectDuplicateCandidate.emittedAt <= RECONNECT_DUPLICATE_WINDOW_MS;
        this.reconnectDuplicateCandidate = null;
        if (duplicate) return;
      }
      const itemId = `paraformer-${this.taskId}-${sentenceId}`;
      if (isFinal) {
        this.lastFinalTranscript = {
          normalizedText,
          emittedAt: Date.now(),
          itemId,
          generation: this.connectionGeneration,
        };
      }
      this.callbacks.onTranscript?.({
        itemId,
        text,
        isFinal,
        audioStartMs: beginTime,
        ...(endTime === null ? {} : { audioEndMs: endTime }),
      });
      return;
    }
    if (event === "task-failed") {
      const upstreamCode = safeText(message?.header?.error_code ?? "");
      const upstreamMessage = safeText(message?.header?.error_message ?? upstreamCode ?? "未知错误");
      const recoverable = isRecoverableTaskFailure(upstreamCode, upstreamMessage);
      this.handleConnectionFailure(
        this.socket,
        `语音识别失败：${upstreamMessage || "未知错误"}`,
        recoverable,
        upstreamCode ? `asr_task_${normalizeErrorCode(upstreamCode)}` : "asr_task_failed",
      );
      return;
    }
    if (event === "task-finished") {
      if (!this.closed) this.handleConnectionFailure(this.socket, "语音识别任务意外结束。", true, "asr_task_ended");
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.taskStarted && this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({
          header: { action: "finish-task", task_id: this.taskId, streaming: "duplex" },
          payload: { input: {} },
        }));
      } catch {}
      const socket = this.socket;
      const timer = setTimeout(() => socket.terminate(), 1_500);
      timer.unref?.();
    } else {
      this.socket?.terminate();
    }
    this.audioQueue = [];
    this.queuedBytes = 0;
    this.acceptQueuedAudio = false;
    this.reconnectDuplicateCandidate = null;
  }

  handleConnectionFailure(socket, message, recoverable = true, code = "asr_provider_failed") {
    if (this.closed || (socket && socket.cheaterFailureHandled)) return;
    if (socket) socket.cheaterFailureHandled = true;
    this.taskStarted = false;
    try { socket?.terminate(); } catch {}
    this.totalFailures += 1;
    const nextAttempt = this.reconnectAttempts + 1;
    const canFastRetry = recoverable && nextAttempt <= this.maxReconnectAttempts;
    const canUseFallback = recoverable && !canFastRetry && !this.usingFallback && Boolean(this.fallbackModel);
    const enteringManualOnly = !canFastRetry && !canUseFallback;
    const retryDelayMs = canFastRetry
      ? Math.min(10_000, this.reconnectBaseDelayMs * (2 ** (nextAttempt - 1)))
      : canUseFallback
        ? Math.min(1_000, this.reconnectBaseDelayMs)
        : this.backgroundRetryMs;
    if (canUseFallback) {
      this.usingFallback = true;
      this.activeModel = this.fallbackModel;
      this.reconnectAttempts = 0;
    } else if (canFastRetry) {
      this.reconnectAttempts = nextAttempt;
    } else {
      this.manualOnly = true;
      this.reconnectAttempts = 0;
      this.acceptQueuedAudio = false;
      this.audioQueue = [];
      this.queuedBytes = 0;
    }
    const details = {
      attempt: this.totalFailures,
      channel: this.channel,
      recoverable: canFastRetry || canUseFallback,
      code,
      message,
      model: this.activeModel,
      fallback: this.usingFallback,
      manualOnly: this.manualOnly || enteringManualOnly,
      nextRetryMs: retryDelayMs,
    };
    this.callbacks.onStatus?.("failed", {
      ...details,
    });
    this.callbacks.onError?.(message, {
      ...details,
    });
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualOnly) {
        this.usingFallback = false;
        this.activeModel = this.primaryModel;
        this.acceptQueuedAudio = true;
      }
      this.connect();
    }, retryDelayMs);
    this.reconnectTimer.unref?.();
  }
}

export function extractMicrophoneAudioChannel(interleaved) {
  return extractAudioChannel(interleaved, "left");
}

export function extractSystemAudioChannel(interleaved) {
  return extractAudioChannel(interleaved, "right");
}

export function extractAudioChannel(interleaved, channel) {
  const frames = Math.floor(interleaved.byteLength / 4);
  const mono = Buffer.allocUnsafe(frames * 2);
  const sourceOffset = channel === "left" ? 0 : 2;
  for (let frame = 0; frame < frames; frame += 1) {
    interleaved.copy(mono, frame * 2, frame * 4 + sourceOffset, frame * 4 + sourceOffset + 2);
  }
  return mono;
}

function safeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function normalizeTranscriptText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim().toLocaleLowerCase();
}

function normalizeErrorCode(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80) || "unknown";
}

function isRecoverableTaskFailure(code, message) {
  const text = `${code} ${message}`.toLowerCase();
  return !/(invalid|authentication|unauthori[sz]ed|forbidden|api.?key|model.?not.?found|parameter)/i.test(text);
}

function asrParameters(model) {
  const common = { format: "pcm", sample_rate: 16_000 };
  if (!String(model).startsWith("paraformer")) return common;
  return {
    ...common,
    semantic_punctuation_enabled: false,
    max_sentence_silence: 500,
    multi_threshold_mode_enabled: true,
    punctuation_prediction_enabled: true,
    inverse_text_normalization_enabled: true,
    disfluency_removal_enabled: false,
    heartbeat: true,
  };
}
