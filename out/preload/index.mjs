import { contextBridge, ipcRenderer } from "electron";
//#region src/shared/interview-session.ts
var POSTGRES_INTEGER_MAX = 2147483647;
var ANSWER_SCREENSHOT_IMAGE_DATA_MAX_LENGTH = 16 * 1024 * 1024;
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
var INTERVIEW_SESSION_STATUSES = /* @__PURE__ */ new Set([
	"connecting",
	"active",
	"reconnecting",
	"ending",
	"ended",
	"failed"
]);
var INTERVIEW_SESSION_ENDED_REASONS = /* @__PURE__ */ new Set([
	"user_ended",
	"quota_exhausted",
	"credits_exhausted",
	"desktop_ws_failed",
	"sidecar_failed",
	"asr_reconnect_failed",
	"api_bootstrap_failed",
	"lease_expired",
	"ownership_lost",
	"provider_failed",
	"unknown"
]);
var ANSWER_CANCEL_REASONS = /* @__PURE__ */ new Set([
	"user_cancelled",
	"superseded",
	"session_ending"
]);
var ANSWER_AUTOMATION_MODES = /* @__PURE__ */ new Set(["manual", "auto"]);
var ANSWER_LENGTHS = /* @__PURE__ */ new Set(["quick", "standard", "deep"]);
var ANSWER_HINT_KINDS = /* @__PURE__ */ new Set(["fast_hint", "verified_card"]);
var ANSWER_INPUT_MODES = /* @__PURE__ */ new Set([
	"manual_text",
	"latest_media_transcript",
	"screenshot_only"
]);
var ANSWER_TRIGGER_SOURCES = /* @__PURE__ */ new Set(["manual", "auto"]);
var ANSWER_FINISH_STATUSES = /* @__PURE__ */ new Set([
	"completed",
	"cancelled",
	"failed"
]);
var ANSWER_QUESTION_CONFIDENCES = /* @__PURE__ */ new Set([
	"high",
	"medium",
	"low"
]);
var ANSWER_QUESTION_SOURCES = /* @__PURE__ */ new Set([
	"extractor",
	"fallback_latest_media",
	"manual",
	"screenshot_only"
]);
var ASR_STATES = /* @__PURE__ */ new Set([
	"connecting",
	"ready",
	"reconnecting",
	"reconnected",
	"degraded",
	"manual_only",
	"failed"
]);
var INTERVIEW_TERMINAL_CODES = /* @__PURE__ */ new Set([
	"ended",
	"quota_exhausted",
	"ownership_conflict",
	"ownership_lost",
	"authentication_failed",
	"reservation_expired",
	"provider_failed"
]);
function isInterviewSessionStartInput(value) {
	if (!isRecord(value) || !hasOnlyKeys(value, [
		"workspaceId",
		"title",
		"fallbackLanguage"
	])) return false;
	return (value.workspaceId === void 0 || isUuid(value.workspaceId)) && (value.title === void 0 || value.title === null || typeof value.title === "string") && (value.fallbackLanguage === void 0 || typeof value.fallbackLanguage === "string" && value.fallbackLanguage.length > 0);
}
function isInterviewSessionEndInput(value) {
	return isRecord(value) && hasOnlyKeys(value, ["expected", "reason"]) && isInterviewSessionExpectedIdentity(value.expected) && isInterviewSessionEndedReason(value.reason);
}
function isInterviewSessionCommandInput(value) {
	return isRecord(value) && hasOnlyKeys(value, ["expected", "command"]) && isInterviewSessionExpectedIdentity(value.expected) && isInterviewRealtimeUserCommand(value.command);
}
function isInterviewSessionSnapshot(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"clientSessionId",
		"interviewId",
		"status",
		"localGeneration",
		"connection",
		"endedReason"
	]) && isUuid(value.clientSessionId) && (value.interviewId === null || isUuid(value.interviewId)) && isInterviewSessionStatus(value.status) && isLocalGeneration(value.localGeneration) && (value.connection === void 0 || isInterviewPhysicalConnectionIdentity(value.connection)) && (value.endedReason === void 0 || isInterviewSessionEndedReason(value.endedReason));
}
function isInterviewSessionIpcEvent(value) {
	if (!isRecord(value)) return false;
	if (value.type === "snapshot") return hasOnlyKeys(value, ["type", "snapshot"]) && isInterviewSessionSnapshot(value.snapshot);
	if (value.type === "server_frame") return hasOnlyKeys(value, [
		"type",
		"clientSessionId",
		"localGeneration",
		"frame"
	]) && isUuid(value.clientSessionId) && isLocalGeneration(value.localGeneration) && isInterviewRealtimeServerFrame(value.frame);
	if (value.type === "ended") return hasOnlyKeys(value, [
		"type",
		"clientSessionId",
		"localGeneration",
		"reason"
	]) && isUuid(value.clientSessionId) && isLocalGeneration(value.localGeneration) && isInterviewSessionEndedReason(value.reason);
	return false;
}
function isInterviewSessionExpectedIdentity(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"clientSessionId",
		"localGeneration",
		"connectionId"
	]) && isUuid(value.clientSessionId) && isLocalGeneration(value.localGeneration) && (value.connectionId === void 0 || isUuid(value.connectionId));
}
function isInterviewRealtimeUserCommand(value) {
	if (!isRecord(value) || !hasOnlyKeys(value, ["type", "payload"])) return false;
	switch (value.type) {
		case "answer_trigger": return isAnswerTriggerPayload(value.payload);
		case "answer_cancel": return isAnswerCancelPayload(value.payload);
		case "answer_attachment_upload_result": return isAnswerAttachmentUploadResultPayload(value.payload);
		case "answer_settings": return isAnswerSettingsPayload(value.payload);
		case "answer_screenshot_result": return isAnswerScreenshotResultPayload(value.payload);
		default: return false;
	}
}
function isInterviewRealtimeServerFrame(value) {
	if (!isRecord(value) || !hasOnlyKeys(value, [
		"identity",
		"type",
		"payload"
	]) || !isInterviewPhysicalConnectionIdentity(value.identity)) return false;
	switch (value.type) {
		case "connection_ready": return isConnectionReadyPayload(value.payload);
		case "heartbeat_ack": return isHeartbeatAckPayload(value.payload);
		case "client_activity_ack": return isClientActivityAckPayload(value.payload);
		case "asr_status": return isAsrStatusPayload(value.payload);
		case "asr_transcript": return isAsrTranscriptPayload(value.payload);
		case "answer_hint": return isAnswerHintPayload(value.payload);
		case "audio_level": return isAudioLevelPayload(value.payload);
		case "runtime_error": return isRuntimeErrorPayload(value.payload);
		case "quota": return isQuotaPayload(value.payload);
		case "quota_warning": return isQuotaWarningPayload(value.payload);
		case "quota_exhausted": return isQuotaExhaustedPayload(value.payload);
		case "session_terminal": return isSessionTerminalPayload(value.payload);
		case "answer_turn": return isAnswerTurnPayload(value.payload);
		case "answer_attachment_upload": return isAnswerAttachmentUploadPayload(value.payload);
		case "answer_capture_screenshot_request": return isAnswerCaptureScreenshotRequestPayload(value.payload);
		case "answer_text_start":
		case "answer_text_end": return isAnswerTextIdentityPayload(value.payload);
		case "answer_text_delta": return isAnswerTextDeltaPayload(value.payload);
		case "answer_finish": return isAnswerFinishPayload(value.payload);
		default: return false;
	}
}
function isAnswerTriggerPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"requestId",
		"parentMessageId",
		"text",
		"useLatestMediaTranscript",
		"includeScreenshot",
		"screenshot",
		"answerLength"
	]) && isUuid(value.requestId) && (value.parentMessageId === void 0 || isUuid(value.parentMessageId)) && (value.text === void 0 || typeof value.text === "string") && typeof value.useLatestMediaTranscript === "boolean" && typeof value.includeScreenshot === "boolean" && (value.screenshot === void 0 || isAnswerScreenshot(value.screenshot)) && (value.answerLength === void 0 || isStringMember(value.answerLength, ANSWER_LENGTHS));
}
function isAnswerCancelPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["requestId", "reason"]) && (value.requestId === void 0 || isUuid(value.requestId)) && isStringMember(value.reason, ANSWER_CANCEL_REASONS);
}
function isAnswerAttachmentUploadResultPayload(value) {
	if (!isRecord(value) || !isUuid(value.requestId) || !isUuid(value.messageId) || !isUuid(value.attachmentId) || !isUuid(value.assetId) || typeof value.ok !== "boolean") return false;
	if (value.ok) return hasOnlyKeys(value, [
		"requestId",
		"messageId",
		"attachmentId",
		"assetId",
		"ok"
	]);
	return hasOnlyKeys(value, [
		"requestId",
		"messageId",
		"attachmentId",
		"assetId",
		"ok",
		"error"
	]) && isNonEmptyString(value.error);
}
function isAnswerSettingsPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["automationMode", "answerLength"]) && isStringMember(value.automationMode, ANSWER_AUTOMATION_MODES) && (value.answerLength === void 0 || isStringMember(value.answerLength, ANSWER_LENGTHS));
}
function isAnswerScreenshotResultPayload(value) {
	if (!isRecord(value) || !isUuid(value.requestId) || typeof value.ok !== "boolean") return false;
	if (value.ok) return hasOnlyKeys(value, [
		"requestId",
		"ok",
		"screenshot"
	]) && isAnswerScreenshot(value.screenshot);
	return hasOnlyKeys(value, [
		"requestId",
		"ok",
		"error"
	]) && isNonEmptyString(value.error);
}
function isAnswerScreenshot(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"attachmentId",
		"mimeType",
		"imageData",
		"width",
		"height"
	]) && isUuid(value.attachmentId) && (value.mimeType === "image/png" || value.mimeType === "image/jpeg") && isNonEmptyString(value.imageData) && value.imageData.length <= ANSWER_SCREENSHOT_IMAGE_DATA_MAX_LENGTH && (value.width === void 0 || isPositiveInteger(value.width)) && (value.height === void 0 || isPositiveInteger(value.height));
}
function isConnectionReadyPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"serverObservedAt",
		"ownerExpiresAt",
		"resumed",
		"heartbeatIntervalMs",
		"activityIntervalMs",
		"maxActivityGapMs"
	]) && isIsoTimestamp(value.serverObservedAt) && isIsoTimestamp(value.ownerExpiresAt) && typeof value.resumed === "boolean" && isPositiveInteger(value.heartbeatIntervalMs) && isPositiveInteger(value.activityIntervalMs) && isPositiveInteger(value.maxActivityGapMs);
}
function isHeartbeatAckPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["sequence", "serverObservedAt"]) && isActivitySequence(value.sequence) && isIsoTimestamp(value.serverObservedAt);
}
function isClientActivityAckPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"sequence",
		"serverObservedAt",
		"accepted",
		"billableMsAccrued",
		"sessionSecondsRemaining"
	]) && isActivitySequence(value.sequence) && isIsoTimestamp(value.serverObservedAt) && typeof value.accepted === "boolean" && isNonNegativeInteger(value.billableMsAccrued) && isNonNegativeInteger(value.sessionSecondsRemaining);
}
function isAsrStatusPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"state",
		"attempt",
		"code",
		"recoverable",
		"message",
		"channel",
		"mode",
		"model",
		"fallback",
		"nextRetryMs"
	]) && isStringMember(value.state, ASR_STATES) && (value.attempt === void 0 || isNonNegativeInteger(value.attempt)) && (value.code === void 0 || typeof value.code === "string") && (value.recoverable === void 0 || typeof value.recoverable === "boolean") && (value.message === void 0 || isNonEmptyString(value.message)) && (value.channel === void 0 || value.channel === "left" || value.channel === "right" || value.channel === "all") && (value.mode === void 0 || value.mode === "live" || value.mode === "fallback" || value.mode === "manual") && (value.model === void 0 || isNonEmptyString(value.model)) && (value.fallback === void 0 || typeof value.fallback === "boolean") && (value.nextRetryMs === void 0 || isNonNegativeInteger(value.nextRetryMs));
}
function isAsrTranscriptPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"channel",
		"text",
		"isFinal",
		"itemId",
		"audioStartMs",
		"audioEndMs"
	]) && (value.channel === "left" || value.channel === "right") && typeof value.text === "string" && typeof value.isFinal === "boolean" && (value.itemId === void 0 || isNonEmptyString(value.itemId)) && (value.audioStartMs === void 0 || isNonNegativeInteger(value.audioStartMs)) && (value.audioEndMs === void 0 || isNonNegativeInteger(value.audioEndMs));
}
function isAnswerHintPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["requestId", "turnId", "revisionId", "text", "kind", "confidence", "answerLength"]) && isUuid(value.requestId) && isNonEmptyString(value.turnId) && isPositiveInteger(value.revisionId) && isNonEmptyString(value.text) && (value.kind === void 0 || isStringMember(value.kind, ANSWER_HINT_KINDS)) && (value.confidence === void 0 || isUnitLevel(value.confidence)) && (value.answerLength === void 0 || isStringMember(value.answerLength, ANSWER_LENGTHS));
}
function isAudioLevelPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["microphone", "systemAudio", "timestamp"]) && isAudioLevelChannel(value.microphone) && isAudioLevelChannel(value.systemAudio) && isNonNegativeInteger(value.timestamp);
}
function isAudioLevelChannel(value) {
	return isRecord(value) && hasOnlyKeys(value, ["rms", "peak"]) && isUnitLevel(value.rms) && isUnitLevel(value.peak);
}
function isUnitLevel(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function isRuntimeErrorPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"code",
		"message",
		"retryable"
	]) && isNonEmptyString(value.code) && isNonEmptyString(value.message) && typeof value.retryable === "boolean";
}
function isQuotaPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"sessionSecondsRemaining",
		"settledUsedSeconds",
		"pendingUsedSeconds"
	]) && isNonNegativeInteger(value.sessionSecondsRemaining) && isNonNegativeInteger(value.settledUsedSeconds) && isNonNegativeInteger(value.pendingUsedSeconds);
}
function isQuotaWarningPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["sessionSecondsRemaining", "level"]) && isNonNegativeInteger(value.sessionSecondsRemaining) && (value.level === "warning" || value.level === "critical");
}
function isQuotaExhaustedPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["message"]) && isNonEmptyString(value.message);
}
function isSessionTerminalPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"code",
		"reason",
		"message",
		"retryable",
		"chargeSeconds"
	]) && isStringMember(value.code, INTERVIEW_TERMINAL_CODES) && isInterviewSessionEndedReason(value.reason) && isNonEmptyString(value.message) && value.retryable === false && isNonNegativeInteger(value.chargeSeconds);
}
function isAnswerTurnPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"userMessageId",
		"assistantMessageId",
		"parentMessageId",
		"resolvedText",
		"inputMode",
		"sourceTranscriptIds",
		"currentQuestionConfidence",
		"currentQuestionSource",
		"currentQuestionAsOfTranscriptId",
		"requestId",
		"triggerSource"
	]) && isUuid(value.userMessageId) && isUuid(value.assistantMessageId) && (value.parentMessageId === void 0 || isUuid(value.parentMessageId)) && isNonEmptyString(value.resolvedText) && isStringMember(value.inputMode, ANSWER_INPUT_MODES) && (value.sourceTranscriptIds === void 0 || Array.isArray(value.sourceTranscriptIds) && value.sourceTranscriptIds.every(isNonEmptyString)) && (value.currentQuestionConfidence === void 0 || isStringMember(value.currentQuestionConfidence, ANSWER_QUESTION_CONFIDENCES)) && (value.currentQuestionSource === void 0 || isStringMember(value.currentQuestionSource, ANSWER_QUESTION_SOURCES)) && (value.currentQuestionAsOfTranscriptId === void 0 || isNonEmptyString(value.currentQuestionAsOfTranscriptId)) && isUuid(value.requestId) && isStringMember(value.triggerSource, ANSWER_TRIGGER_SOURCES);
}
function isAnswerAttachmentUploadPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"messageId",
		"attachmentId",
		"assetId",
		"presignedUrl",
		"contentType",
		"expiresIn",
		"requestId"
	]) && isUuid(value.messageId) && isUuid(value.attachmentId) && isUuid(value.assetId) && isNonEmptyString(value.presignedUrl) && isNonEmptyString(value.contentType) && isNonNegativeInteger(value.expiresIn) && isUuid(value.requestId);
}
function isAnswerCaptureScreenshotRequestPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["requestId", "timeoutMs"]) && isUuid(value.requestId) && isPositiveInteger(value.timeoutMs);
}
function isAnswerTextIdentityPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, ["requestId", "messageId"]) && isUuid(value.requestId) && isUuid(value.messageId);
}
function isAnswerTextDeltaPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"requestId",
		"messageId",
		"delta"
	]) && isUuid(value.requestId) && isUuid(value.messageId) && typeof value.delta === "string";
}
function isAnswerFinishPayload(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"requestId",
		"status",
		"error",
		"answerSource"
	]) && isUuid(value.requestId) && isStringMember(value.status, ANSWER_FINISH_STATUSES) && (value.error === void 0 || typeof value.error === "string") && (value.answerSource === void 0 || ["model", "verified_fundamentals_card", "verified_personal_knowledge_card", "verified_contribution_boundary", "grounded_project_selection", "grounded_evidence_fallback", "grounded_evidence_unavailable"].includes(value.answerSource));
}
function isInterviewPhysicalConnectionIdentity(value) {
	return isRecord(value) && hasOnlyKeys(value, [
		"interviewId",
		"clientSessionId",
		"connectionId",
		"leaseGeneration"
	]) && isUuid(value.interviewId) && isUuid(value.clientSessionId) && isUuid(value.connectionId) && isLocalGeneration(value.leaseGeneration);
}
function isInterviewSessionStatus(value) {
	return INTERVIEW_SESSION_STATUSES.has(value);
}
function isInterviewSessionEndedReason(value) {
	return INTERVIEW_SESSION_ENDED_REASONS.has(value);
}
function isLocalGeneration(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= POSTGRES_INTEGER_MAX;
}
function isActivitySequence(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= POSTGRES_INTEGER_MAX;
}
function isNonNegativeInteger(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isPositiveInteger(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
function isNonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}
function isStringMember(value, values) {
	return typeof value === "string" && values.has(value);
}
function isIsoTimestamp(value) {
	return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value);
}
function isUuid(value) {
	return typeof value === "string" && UUID_PATTERN.test(value);
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value, keys) {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}
//#endregion
//#region src/shared/ipc.ts
var IPC_ONBOARD = {
	GET_STATUS: "onboard:get-status",
	GET_INITIAL_STEP: "onboard:get-initial-step",
	SET_MILESTONE: "onboard:set-milestone",
	COMPLETE: "onboard:complete",
	RESET: "onboard:reset"
};
var IPC_AUTH = {
	SAVE_TOKEN: "auth:save-token",
	LOAD_TOKEN: "auth:load-token",
	CLEAR_TOKEN: "auth:clear-token",
	STATUS: "auth:status"
};
var IPC_ACCENT = {
	GET: "accent:get",
	SET: "accent:set",
	CLEAR: "accent:clear"
};
var IPC_AUDIO_DEVICES = {
	GET_STATE: "audio-devices:get-state",
	SET_SELECTION: "audio-devices:set-selection",
	START_METER: "audio-devices:start-meter",
	STOP_METER: "audio-devices:stop-meter",
	METER_EVENT: "audio-devices:meter-event"
};
var IPC_THEME = {
	GET: "theme:get",
	SET: "theme:set"
};
var IPC_LOCALE = {
	GET_SYSTEM: "locale:get-system",
	GET: "locale:get",
	SET: "locale:set",
	CLEAR: "locale:clear"
};
var IPC_FILES = {
	OPEN_DIALOG: "files:open-dialog",
	OPEN_KNOWLEDGE_FOLDER: "files:open-knowledge-folder",
	STAT: "files:stat",
	READ_FILE: "files:read-file",
	RELEASE: "files:release",
	NORMALIZE_IMAGE: "files:normalize-image"
};
var IPC_OVERLAY = {
	SET_IGNORE_MOUSE: "overlay:set-ignore-mouse",
	SET_CONTENT_PROTECTION: "overlay:set-content-protection",
	GET_CONTENT_PROTECTION: "overlay:get-content-protection",
	CAPTURE_SCREEN: "overlay:capture-screen",
	GET_INTERACTION_MODE: "overlay:get-interaction-mode",
	GET_DISPLAY_METRICS: "overlay:get-display-metrics"
};
var IPC_SHORTCUT = {
	OVERLAY_ACTION: "shortcut:overlay-action",
	GET_BINDINGS: "shortcut:get-bindings",
	SET_BINDING: "shortcut:set-binding",
	RESET_BINDINGS: "shortcut:reset-bindings",
	CHECK_CONFLICTS: "shortcut:check-conflicts"
};
var IPC_SESSION = {
	START: "interview-session:start",
	END: "interview-session:end",
	SEND: "interview-session:send",
	SNAPSHOT: "interview-session:snapshot",
	EVENT: "interview-session:event"
};
var IPC_UPDATER = {
	CHECK: "updater:check",
	INSTALL: "updater:install",
	STATUS: "updater:status",
	EVENT: "updater:event"
};
var IPC_PERMISSION = {
	GET_STATUS: "permission:get-status",
	REQUEST_MICROPHONE: "permission:request-microphone",
	REQUEST_SCREEN: "permission:request-screen",
	PROBE_SIDECAR: "permission:probe-sidecar",
	PREFLIGHT_INTERVIEW_CAPTURE: "permission:preflight-interview-capture",
	OPEN_SCREEN_SETTINGS: "permission:open-screen-settings",
	OPEN_MIC_SETTINGS: "permission:open-mic-settings"
};
var IPC_WINDOW = {
	RENDERER_READY: "window:renderer-ready",
	FULLSCREEN_CHANGE: "window:fullscreen-change"
};
var IPC_WINDOW_STATE = { RESET: "window-state:reset" };
[...Array.from({ length: 24 }, (_, index) => `F${index + 1}`)];
//#endregion
//#region src/preload/window-api.ts
function createWindowAPI(deps) {
	return {
		getPlatform: () => deps.platform,
		getTitleBarOverlayHeight: () => deps.titleBarOverlayHeight,
		rendererReady: () => {
			deps.ipcRenderer.send(IPC_WINDOW.RENDERER_READY);
		},
		onFullscreenChange: (handler) => {
			const listener = (_event, payload) => handler(payload);
			deps.ipcRenderer.on(IPC_WINDOW.FULLSCREEN_CHANGE, listener);
			return () => deps.ipcRenderer.off(IPC_WINDOW.FULLSCREEN_CHANGE, listener);
		}
	};
}
//#endregion
//#region src/preload/index.ts
var onboardAPI = {
	getStatus: () => ipcRenderer.invoke(IPC_ONBOARD.GET_STATUS),
	getInitialStep: () => ipcRenderer.invoke(IPC_ONBOARD.GET_INITIAL_STEP),
	setMilestone: (milestone, value) => ipcRenderer.invoke(IPC_ONBOARD.SET_MILESTONE, milestone, value),
	complete: () => ipcRenderer.invoke(IPC_ONBOARD.COMPLETE),
	reset: () => ipcRenderer.invoke(IPC_ONBOARD.RESET)
};
var authAPI = {
	saveToken: (accessToken) => ipcRenderer.invoke(IPC_AUTH.SAVE_TOKEN, accessToken),
	loadToken: () => ipcRenderer.invoke(IPC_AUTH.LOAD_TOKEN),
	clearToken: () => ipcRenderer.invoke(IPC_AUTH.CLEAR_TOKEN),
	status: () => ipcRenderer.invoke(IPC_AUTH.STATUS)
};
var aiSettingsAPI = {
	get: () => ipcRenderer.invoke("ai-settings:get"),
	save: (settings) => ipcRenderer.invoke("ai-settings:save", settings),
	clearApiKey: () => ipcRenderer.invoke("ai-settings:clear-key"),
	testConnection: () => ipcRenderer.invoke("ai-settings:test")
};
var accentAPI = {
	get: () => ipcRenderer.invoke(IPC_ACCENT.GET),
	set: (accent) => ipcRenderer.invoke(IPC_ACCENT.SET, accent),
	clear: () => ipcRenderer.invoke(IPC_ACCENT.CLEAR)
};
var audioDevicesAPI = {
	getState: () => ipcRenderer.invoke(IPC_AUDIO_DEVICES.GET_STATE),
	setSelection: (selection) => ipcRenderer.invoke(IPC_AUDIO_DEVICES.SET_SELECTION, selection),
	startMeter: (options) => ipcRenderer.invoke(IPC_AUDIO_DEVICES.START_METER, options),
	stopMeter: () => ipcRenderer.invoke(IPC_AUDIO_DEVICES.STOP_METER),
	onMeterEvent: (handler) => {
		const listener = (_event, payload) => handler(payload);
		ipcRenderer.on(IPC_AUDIO_DEVICES.METER_EVENT, listener);
		return () => ipcRenderer.off(IPC_AUDIO_DEVICES.METER_EVENT, listener);
	}
};
var themeAPI = {
	get: () => ipcRenderer.invoke(IPC_THEME.GET),
	set: (preference) => ipcRenderer.invoke(IPC_THEME.SET, preference)
};
var localeAPI = {
	getSystem: () => ipcRenderer.invoke(IPC_LOCALE.GET_SYSTEM),
	get: () => ipcRenderer.invoke(IPC_LOCALE.GET),
	set: (locale) => ipcRenderer.invoke(IPC_LOCALE.SET, locale),
	clear: () => ipcRenderer.invoke(IPC_LOCALE.CLEAR)
};
var filesAPI = {
	openDialog: (options) => ipcRenderer.invoke(IPC_FILES.OPEN_DIALOG, options),
	openKnowledgeFolder: () => ipcRenderer.invoke(IPC_FILES.OPEN_KNOWLEDGE_FOLDER),
	stat: (fileToken) => ipcRenderer.invoke(IPC_FILES.STAT, fileToken),
	readFile: (fileToken) => ipcRenderer.invoke(IPC_FILES.READ_FILE, fileToken),
	release: (fileToken) => ipcRenderer.invoke(IPC_FILES.RELEASE, fileToken),
	normalizeImage: (fileToken) => ipcRenderer.invoke(IPC_FILES.NORMALIZE_IMAGE, fileToken)
};
var overlayAPI = {
	quitApp: () => ipcRenderer.invoke("overlay:quit-app"),
	setIgnoreMouse: (ignore, options) => {
		ipcRenderer.send(IPC_OVERLAY.SET_IGNORE_MOUSE, ignore, options);
	},
	setContentProtection: (enabled) => ipcRenderer.invoke(IPC_OVERLAY.SET_CONTENT_PROTECTION, enabled),
	getContentProtection: () => ipcRenderer.invoke(IPC_OVERLAY.GET_CONTENT_PROTECTION),
	captureScreen: () => ipcRenderer.invoke(IPC_OVERLAY.CAPTURE_SCREEN),
	getInteractionMode: () => ipcRenderer.invoke(IPC_OVERLAY.GET_INTERACTION_MODE),
	getDisplayMetrics: () => ipcRenderer.invoke(IPC_OVERLAY.GET_DISPLAY_METRICS),
	onShortcutAction: (handler) => {
		const listener = (_event, action) => handler(action);
		ipcRenderer.on(IPC_SHORTCUT.OVERLAY_ACTION, listener);
		return () => ipcRenderer.off(IPC_SHORTCUT.OVERLAY_ACTION, listener);
	}
};
var shortcutsAPI = {
	onBindingsChanged: (handler) => { const listener = (_event, bindings) => handler(bindings); ipcRenderer.on("shortcut:bindings-changed", listener); return () => ipcRenderer.off("shortcut:bindings-changed", listener); },
	getBindings: () => ipcRenderer.invoke(IPC_SHORTCUT.GET_BINDINGS),
	setBinding: (action, accelerator) => ipcRenderer.invoke(IPC_SHORTCUT.SET_BINDING, action, accelerator),
	resetBindings: () => ipcRenderer.invoke(IPC_SHORTCUT.RESET_BINDINGS),
	checkConflicts: () => ipcRenderer.invoke(IPC_SHORTCUT.CHECK_CONFLICTS)
};
var sessionAPI = {
	startRealtime: async (input, options) => {
		if (!isInterviewSessionStartInput(input)) throw new TypeError("Invalid interview session start input");
		return requireInterviewSessionSnapshot(await ipcRenderer.invoke(IPC_SESSION.START, input, options));
	},
	endRealtime: async (input) => {
		if (!isInterviewSessionEndInput(input)) throw new TypeError("Invalid interview session end input");
		return requireInterviewSessionSnapshot(await ipcRenderer.invoke(IPC_SESSION.END, input));
	},
	send: async (input) => {
		if (!isInterviewSessionCommandInput(input)) throw new TypeError("Invalid interview session command input");
		const accepted = await ipcRenderer.invoke(IPC_SESSION.SEND, input);
		if (typeof accepted !== "boolean") throw new TypeError("Invalid interview session send result");
		return accepted;
	},
	getSnapshot: async () => {
		const snapshot = await ipcRenderer.invoke(IPC_SESSION.SNAPSHOT);
		if (snapshot === null) return null;
		return requireInterviewSessionSnapshot(snapshot);
	},
	onEvent: (handler) => {
		const listener = (_event, payload) => {
			if (!isInterviewSessionIpcEvent(payload)) {
				console.warn("[preload] Ignoring invalid interview session event");
				return;
			}
			handler(payload);
		};
		ipcRenderer.on(IPC_SESSION.EVENT, listener);
		return () => ipcRenderer.off(IPC_SESSION.EVENT, listener);
	}
};
function requireInterviewSessionSnapshot(snapshot) {
	if (!isInterviewSessionSnapshot(snapshot)) throw new TypeError("Invalid interview session snapshot");
	return snapshot;
}
var api = {
	onboard: onboardAPI,
	auth: authAPI,
	aiSettings: aiSettingsAPI,
	personalLibrary: { invoke: (action, input) => ipcRenderer.invoke("personal-library:invoke", action, input) },
	interviewWorkflow: { invoke: (action, input) => ipcRenderer.invoke("interview-workflow:invoke", action, input) },
	interviewBudget: { invoke: (action, input) => ipcRenderer.invoke("interview-budget:invoke", action, input) },
	interviewRecords: { exportPdf: (id) => ipcRenderer.invoke("interview-records:export-pdf", id) },
	accent: accentAPI,
	audioDevices: audioDevicesAPI,
	theme: themeAPI,
	locale: localeAPI,
	files: filesAPI,
	overlay: overlayAPI,
	permission: {
		getStatus: () => ipcRenderer.invoke(IPC_PERMISSION.GET_STATUS),
		requestMicrophone: () => ipcRenderer.invoke(IPC_PERMISSION.REQUEST_MICROPHONE),
		requestScreen: () => ipcRenderer.invoke(IPC_PERMISSION.REQUEST_SCREEN),
		probeSidecar: () => ipcRenderer.invoke(IPC_PERMISSION.PROBE_SIDECAR),
		preflightInterviewCapture: () => ipcRenderer.invoke(IPC_PERMISSION.PREFLIGHT_INTERVIEW_CAPTURE),
		openScreenSettings: () => ipcRenderer.invoke(IPC_PERMISSION.OPEN_SCREEN_SETTINGS),
		openMicSettings: () => ipcRenderer.invoke(IPC_PERMISSION.OPEN_MIC_SETTINGS)
	},
	session: sessionAPI,
	shortcuts: shortcutsAPI,
	updater: {
		checkForUpdates: () => ipcRenderer.invoke(IPC_UPDATER.CHECK),
		installUpdate: () => ipcRenderer.invoke(IPC_UPDATER.INSTALL),
		getStatus: () => ipcRenderer.invoke(IPC_UPDATER.STATUS),
		onUpdateEvent: (handler) => {
			const listener = (_event, payload) => handler(payload);
			ipcRenderer.on(IPC_UPDATER.EVENT, listener);
			return () => ipcRenderer.off(IPC_UPDATER.EVENT, listener);
		}
	},
	window: createWindowAPI({
		ipcRenderer,
		platform: process.platform,
		titleBarOverlayHeight: process.platform === "win32" ? 38 : 0
	}),
	windowState: { reset: () => ipcRenderer.invoke(IPC_WINDOW_STATE.RESET) }
};
if (process.contextIsolated) try {
	contextBridge.exposeInMainWorld("api", api);
} catch (error) {
	console.error(error);
}
else window.api = api;
//#endregion
export {};
