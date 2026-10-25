import { createRequire } from "node:module";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { BrowserWindow, app, desktopCapturer, dialog, globalShortcut, ipcMain, nativeTheme, net, protocol, screen, shell, systemPreferences } from "electron";
import Store from "electron-store";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { existsSync, promises } from "node:fs";
import { basename, dirname, extname, join, normalize, resolve, win32 } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fileURLToPath, pathToFileURL } from "node:url";
import electronUpdater from "electron-updater";
//#region src/shared/appearance.ts
var SUPPORTED_ACCENTS = [
	"default",
	"amber",
	"blue",
	"cyan",
	"emerald",
	"fuchsia",
	"green",
	"indigo",
	"lime",
	"orange",
	"pink",
	"purple",
	"red",
	"rose",
	"sky",
	"teal",
	"violet",
	"yellow"
];
var DEFAULT_ACCENT = "default";
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
//#endregion
//#region src/shared/audio-devices.ts
var SYSTEM_DEFAULT_AUDIO_DEVICE_ID = "system-default";
function normalizeAudioDeviceSelection(selection) {
	return {
		microphoneDeviceId: normalizeDeviceId(selection?.microphoneDeviceId),
		systemAudioDeviceId: normalizeDeviceId(selection?.systemAudioDeviceId)
	};
}
function normalizeDeviceId(value) {
	const trimmed = value?.trim();
	if (!trimmed) return SYSTEM_DEFAULT_AUDIO_DEVICE_ID;
	return trimmed;
}
//#endregion
//#region src/shared/onboard.ts
var DEFAULT_ONBOARD_MILESTONES = {
	welcome: false,
	account: false,
	permissions: false
};
//#endregion
//#region src/shared/overlay.ts
var OVERLAY_INTERACTION_MODES = ["normal", "passive"];
var DEFAULT_OVERLAY_INTERACTION_MODE = "normal";
var OVERLAY_SHORTCUTS = [
	{
		accelerator: "Control+Alt+A",
		action: "ask"
	},
	{
		accelerator: "Control+Alt+S",
		action: "shot"
	},
	{
		accelerator: "Control+Alt+D",
		action: "hide"
	},
	{
		accelerator: "Control+Alt+K",
		action: "toggle_shortcut_panel"
	},
	{
		accelerator: "Control+Alt+I",
		action: "toggle_interaction"
	},
	{
		accelerator: "Control+Alt+Shift+Q",
		action: "quit_app"
	},
	{
		accelerator: "Control+Alt+Q",
		action: "end_session"
	},
	{
		accelerator: "Control+Alt+X",
		action: "toggle_auto_answer"
	},
	{
		accelerator: "Control+Alt+1",
		action: "ask_transcript_1"
	},
	{
		accelerator: "Control+Alt+2",
		action: "ask_transcript_2"
	},
	{
		accelerator: "Control+Alt+3",
		action: "ask_transcript_3"
	},
	{
		accelerator: "Control+Alt+4",
		action: "ask_transcript_4"
	},
	{
		accelerator: "Control+Alt+5",
		action: "ask_transcript_5"
	},
	{
		accelerator: "Control+Alt+6",
		action: "ask_transcript_6"
	},
	{
		accelerator: "Control+Alt+7",
		action: "ask_transcript_7"
	},
	{
		accelerator: "Control+Alt+8",
		action: "ask_transcript_8"
	},
	{
		accelerator: "Control+Alt+Shift+Up",
		action: "scroll_answer_up"
	},
	{
		accelerator: "Control+Alt+Shift+Down",
		action: "scroll_answer_down"
	},
	{
		accelerator: "Control+Alt+Up",
		action: "place_top"
	},
	{
		accelerator: "Control+Alt+Down",
		action: "place_bottom"
	},
	{
		accelerator: "Control+Alt+Left",
		action: "place_left"
	},
	{
		accelerator: "Control+Alt+Right",
		action: "place_right"
	}
];
var REGISTERED_OVERLAY_SHORTCUT_ACTION_SET = /* @__PURE__ */ new Set([
	"ask",
	"shot",
	"hide",
	"toggle_shortcut_panel",
	"toggle_interaction",
	"end_session",
	"quit_app",
	"toggle_auto_answer",
	"ask_transcript_1",
	"ask_transcript_2",
	"ask_transcript_3",
	"ask_transcript_4",
	"ask_transcript_5",
	"ask_transcript_6",
	"ask_transcript_7",
	"ask_transcript_8",
	"scroll_answer_up",
	"scroll_answer_down",
	"place_top",
	"place_bottom",
	"place_left",
	"place_right"
]);
function shouldRegisterOverlayShortcut(action) {
	return REGISTERED_OVERLAY_SHORTCUT_ACTION_SET.has(action);
}
var OVERLAY_SHORTCUT_MODIFIERS = /* @__PURE__ */ new Set([
	"Control",
	"Alt",
	"Shift",
	"Meta",
	"CommandOrControl"
]);
var OVERLAY_SHORTCUT_PRIMARY_KEYS = /* @__PURE__ */ new Set([
	..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	..."0123456789",
	...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
	"Up",
	"Down",
	"Left",
	"Right",
	"Space",
	"Tab",
	"Backspace",
	"Delete",
	"Insert",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"-",
	"=",
	"[",
	"]",
	"\\",
	";",
	"'",
	",",
	".",
	"/",
	"`"
]);
/**
* Validate an Electron accelerator for overlay shortcuts. Requires at least
* one modifier plus exactly one primary key so users cannot bind bare keys
* that would hijack normal typing while a session is active.
*/
function isValidOverlayAccelerator(value) {
	if (typeof value !== "string" || value.length === 0) return false;
	const parts = value.split("+");
	if (parts.some((part) => part.length === 0)) return false;
	const modifiers = /* @__PURE__ */ new Set();
	let primaryCount = 0;
	for (const part of parts) {
		if (OVERLAY_SHORTCUT_MODIFIERS.has(part)) {
			if (modifiers.has(part)) return false;
			modifiers.add(part);
			continue;
		}
		if (!OVERLAY_SHORTCUT_PRIMARY_KEYS.has(part)) return false;
		primaryCount += 1;
	}
	return modifiers.size >= 1 && primaryCount === 1;
}
/** Resolve the effective shortcut table: defaults overlaid with valid user overrides. */
function resolveOverlayShortcuts(overrides) {
	return OVERLAY_SHORTCUTS.map((definition) => {
		const override = overrides[definition.action];
		if (typeof override === "string" && isValidOverlayAccelerator(override)) return {
			action: definition.action,
			accelerator: override
		};
		return definition;
	});
}
/** Return accelerators bound to more than one action in the given table. */
function findDuplicateOverlayAccelerators(shortcuts) {
	const counts = /* @__PURE__ */ new Map();
	for (const { accelerator } of shortcuts) counts.set(accelerator, (counts.get(accelerator) ?? 0) + 1);
	return [...counts.entries()].filter(([, count]) => count > 1).map(([accelerator]) => accelerator);
}
function normalizeOverlayInteractionMode(value) {
	return OVERLAY_INTERACTION_MODES.includes(value) ? value : DEFAULT_OVERLAY_INTERACTION_MODE;
}
//#endregion
//#region src/main/store/index.ts
var defaults = {
	onboard: {
		completed: false,
		milestones: { ...DEFAULT_ONBOARD_MILESTONES }
	},
	auth: null,
	accent: null,
	theme: "system",
	locale: null,
	audioDevices: {
		microphoneDeviceId: SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
		systemAudioDeviceId: SYSTEM_DEFAULT_AUDIO_DEVICE_ID
	},
	shortcuts: {},
	windowState: {
		bounds: null,
		isMaximized: false,
		isFullScreen: false
	}
};
var store = new Store({
	name: "cheater-desktop-v1",
	defaults
});
var onboardStore = {
	isCompleted() {
		return store.get("onboard.completed", false) || store.get("onboarding.completed", false);
	},
	getMilestones() {
		return store.get("onboard.milestones", { ...DEFAULT_ONBOARD_MILESTONES });
	},
	setMilestone(key, value) {
		store.set(`onboard.milestones.${key}`, value);
	},
	setCompleted(completed) {
		store.set("onboard.completed", completed);
		store.set("onboarding.completed", completed);
		if (completed) store.set("onboard.milestones", {
			welcome: true,
			account: true,
			permissions: true
		});
	},
	reset() {
		store.set("onboard.completed", false);
		store.set("onboarding.completed", false);
		store.set("onboard.milestones", { ...DEFAULT_ONBOARD_MILESTONES });
	}
};
var authStore = {
	getTokens() {
		return store.get("auth", null);
	},
	setTokens(tokens) {
		store.set("auth", tokens);
	},
	clear() {
		store.set("auth", null);
	}
};
var accentStore = {
	get() {
		return store.get("accent", null);
	},
	set(accent) {
		store.set("accent", accent);
	},
	clear() {
		store.set("accent", null);
	}
};
var themeStore = {
	get() {
		return store.get("theme", "system");
	},
	set(theme) {
		store.set("theme", theme);
	}
};
var localeStore = {
	get() {
		return store.get("locale", null);
	},
	set(locale) {
		store.set("locale", locale);
	},
	clear() {
		store.set("locale", null);
	}
};
var audioDevicesStore = {
	getSelection() {
		return {
			microphoneDeviceId: store.get("audioDevices.microphoneDeviceId", SYSTEM_DEFAULT_AUDIO_DEVICE_ID),
			systemAudioDeviceId: store.get("audioDevices.systemAudioDeviceId", SYSTEM_DEFAULT_AUDIO_DEVICE_ID)
		};
	},
	setSelection(selection) {
		const nextSelection = {
			...this.getSelection(),
			...selection
		};
		store.set("audioDevices", nextSelection);
		return nextSelection;
	}
};
var shortcutStore = {
	getOverrides() {
		return store.get("shortcuts", {});
	},
	/** Set or clear (accelerator = null) the override for one action. */
	setOverride(action, accelerator) {
		if (accelerator !== null && !isValidOverlayAccelerator(accelerator)) throw new TypeError(`Invalid overlay shortcut accelerator: ${accelerator}`);
		const overrides = { ...this.getOverrides() };
		if (accelerator === null) delete overrides[action];
		else overrides[action] = accelerator;
		store.set("shortcuts", overrides);
		return overrides;
	},
	reset() {
		store.set("shortcuts", {});
	}
};
var windowStateStore = {
	get() {
		return store.get("windowState");
	},
	setBounds(bounds) {
		store.set("windowState.bounds", bounds);
	},
	setMaximized(isMaximized) {
		store.set("windowState.isMaximized", isMaximized);
	},
	setFullScreen(isFullScreen) {
		store.set("windowState.isFullScreen", isFullScreen);
	},
	reset() {
		store.set("windowState", defaults.windowState);
	}
};
//#endregion
//#region src/main/ipc/accent.ts
/**
* Normalize and validate an accent color.
* @param value - The accent value to normalize
* @returns The normalized accent or null if invalid
*/
function normalizeAccent(value) {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	return SUPPORTED_ACCENTS.find((accent) => accent === normalized) ?? null;
}
/**
* Get the current accent color preference.
*/
function getAccent() {
	const stored = accentStore.get();
	if (stored) {
		const normalized = normalizeAccent(stored);
		if (normalized) return {
			accent: normalized,
			source: "user_preference"
		};
		accentStore.clear();
	}
	return {
		accent: DEFAULT_ACCENT,
		source: "default_fallback"
	};
}
/**
* Set the accent color preference.
* @param accent - The accent color to set
* @returns The new accent info
* @throws Error if the accent is not supported
*/
function setAccent(accent) {
	const trimmed = accent.trim();
	if (!trimmed || trimmed.toLowerCase() === "default") return clearAccent();
	const normalized = normalizeAccent(trimmed);
	if (!normalized) throw new Error(`Unsupported accent: ${accent}`);
	accentStore.set(normalized);
	return {
		accent: normalized,
		source: "user_preference"
	};
}
/**
* Clear the accent preference and reset to default.
*/
function clearAccent() {
	accentStore.clear();
	return {
		accent: DEFAULT_ACCENT,
		source: "default_fallback"
	};
}
/**
* Register accent IPC handlers.
*/
function registerAccentIpc() {
	ipcMain.handle(IPC_ACCENT.GET, () => {
		return getAccent();
	});
	ipcMain.handle(IPC_ACCENT.SET, (_event, accent) => {
		return setAccent(accent);
	});
	ipcMain.handle(IPC_ACCENT.CLEAR, () => {
		return clearAccent();
	});
}
//#endregion
//#region src/main/realtime/audio-device-selection.ts
function buildAudioDeviceArgs(selection) {
	const normalized = normalizeAudioDeviceSelection(selection);
	return [
		"--input-device-id",
		normalized.microphoneDeviceId,
		"--output-device-id",
		normalized.systemAudioDeviceId
	];
}
//#endregion
//#region src/main/realtime/sidecar-process.ts
/**
* Shared helpers for resolving and spawning the platform audio sidecar.
*/
var SIDECAR_BINARY_NAME = process.platform === "win32" ? "cheater-audio.exe" : "cheater-audio";
function resolveSidecarPath() {
	const appPath = app.getAppPath();
	const resourcesPath = process.resourcesPath;
	const platformDir = process.platform === "win32" ? "win32" : "darwin";
	const candidates = [
		resolve(resourcesPath, "sidecars", "audio", SIDECAR_BINARY_NAME),
		resolve(resourcesPath, "binaries", "sidecars", "audio", SIDECAR_BINARY_NAME),
		resolve(resourcesPath, "binaries", platformDir, SIDECAR_BINARY_NAME),
		resolve(appPath, "resources", "sidecars", "audio", SIDECAR_BINARY_NAME),
		resolve(appPath, "sidecars", "audio", SIDECAR_BINARY_NAME),
		resolve(appPath, "binaries", "sidecars", "audio", SIDECAR_BINARY_NAME),
		resolve(appPath, "binaries", platformDir, SIDECAR_BINARY_NAME)
	];
	candidates.push(resolve(appPath, "..", "services", "target", "release", SIDECAR_BINARY_NAME));
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) throw new Error(`Audio sidecar binary not found. Checked: ${candidates.join(", ")}`);
	return found;
}
function spawnSidecarProcess(options) {
	const args = options.args ?? [];
	let binaryPath;
	try {
		binaryPath = resolveSidecarPath();
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to resolve audio sidecar binary";
		console.error(`[sidecar:${options.mode}] ${message}`);
		throw error;
	}
	let child;
	try {
		child = spawn(binaryPath, args, { stdio: "pipe" });
	} catch (error) {
		const message = error instanceof Error ? error.message : `Failed to spawn audio sidecar: ${binaryPath}`;
		console.error(`[sidecar:${options.mode}] ${message}`);
		throw error;
	}
	const stderrLines = [];
	const stderrReader = createInterface({ input: child.stderr });
	const handleStderr = (line) => {
		stderrLines.push(line);
		options.onStderrLine?.(line);
	};
	stderrReader.on("line", handleStderr);
	return {
		child,
		cleanup: () => {
			stderrReader.off("line", handleStderr);
			stderrReader.close();
		},
		getCollectedStderr: () => collectSidecarStderr(stderrLines)
	};
}
function collectSidecarStderr(lines) {
	if (lines.length === 0) return null;
	return lines.join("\n");
}
//#endregion
//#region src/main/realtime/audio-stream.ts
var SIDECAR_SAMPLE_RATE_HZ = 16e3;
var SIDECAR_FRAME_BYTES = 4;
SIDECAR_SAMPLE_RATE_HZ / 1e3 * 40 * SIDECAR_FRAME_BYTES;
var REALTIME_WS_CHUNK_BYTES = SIDECAR_SAMPLE_RATE_HZ / 1e3 * 40 * SIDECAR_FRAME_BYTES;
var PCM16_SCALE = 32768;
var SILENT_PEAK_THRESHOLD = 5e-4;
var AUDIO_STREAM_READY_TIMEOUT_MS = 4e3;
var SIDECAR_HEALTH_PREFIX = "AETHER_AUDIO_HEALTH ";
var RECOVERABLE_HEALTH_CAPTURE_THRESHOLD = 3;
/**
* Buffer sidecar output into REALTIME_WS_CHUNK_BYTES batches before WebSocket send.
*/
function createAudioPipeline(sendBinary, stopFn, stopState, onChunkMetrics) {
	let pending = Buffer.alloc(0);
	let offset = 0;
	const handleData = (data) => {
		if (stopState.stopped) return;
		const next = Buffer.from(data);
		if (pending.length === 0 || offset >= pending.length) {
			pending = next;
			offset = 0;
		} else if (offset > 0) {
			pending = Buffer.concat([pending.subarray(offset), next]);
			offset = 0;
		} else pending = Buffer.concat([pending, next]);
		while (pending.length - offset >= REALTIME_WS_CHUNK_BYTES) {
			const end = offset + REALTIME_WS_CHUNK_BYTES;
			const chunk = pending.subarray(offset, end);
			offset = end;
			onChunkMetrics?.(analyzeSidecarPcm16Chunk(chunk));
			if (!sendBinary(chunk)) {
				stopFn();
				return;
			}
		}
		if (offset >= 2560 * 8) {
			pending = pending.subarray(offset);
			offset = 0;
		}
	};
	return { handleData };
}
function parseSidecarHealthLine(line) {
	const payload = parseSidecarHealthPayload(line);
	if (!payload) return null;
	return {
		code: payload.code,
		component: payload.component,
		message: payload.message,
		recoverable: payload.recoverable,
		failureClass: resolveSidecarFailureClass(payload.code),
		micState: payload.mic,
		systemState: payload.system
	};
}
function analyzeSidecarPcm16Chunk(chunk) {
	const bytes = chunk.length - chunk.length % SIDECAR_FRAME_BYTES;
	const frames = bytes / SIDECAR_FRAME_BYTES;
	let microphonePeak = 0;
	let systemAudioPeak = 0;
	let microphoneSquareSum = 0;
	let systemAudioSquareSum = 0;
	for (let offset = 0; offset < bytes; offset += SIDECAR_FRAME_BYTES) {
		const microphoneSample = chunk.readInt16LE(offset);
		const systemAudioSample = chunk.readInt16LE(offset + 2);
		const microphoneAbs = Math.abs(microphoneSample);
		const systemAudioAbs = Math.abs(systemAudioSample);
		microphonePeak = Math.max(microphonePeak, microphoneAbs);
		systemAudioPeak = Math.max(systemAudioPeak, systemAudioAbs);
		microphoneSquareSum += microphoneSample * microphoneSample;
		systemAudioSquareSum += systemAudioSample * systemAudioSample;
	}
	const microphone = createChannelMetrics(microphoneSquareSum, microphonePeak, frames);
	const systemAudio = createChannelMetrics(systemAudioSquareSum, systemAudioPeak, frames);
	return {
		bytes,
		frames,
		durationMs: frames > 0 ? frames / SIDECAR_SAMPLE_RATE_HZ * 1e3 : 0,
		microphone,
		systemAudio,
		silent: microphone.peak < SILENT_PEAK_THRESHOLD && systemAudio.peak < SILENT_PEAK_THRESHOLD,
		timestamp: Date.now()
	};
}
function startSpawnAudioStream(sendBinary, emitMessage, onFailure, onHealth, devices, onChunkMetrics) {
	const stopState = { stopped: false };
	let stopStream = () => {};
	let lastFatalHealthEvent = null;
	const healthOccurrences = /* @__PURE__ */ new Map();
	const spawned = spawnSidecarProcess({
		args: buildAudioDeviceArgs(devices),
		mode: "stream",
		onStderrLine: (line) => {
			const healthEvent = parseSidecarHealthLine(line);
			if (healthEvent) {
				const occurrence = (healthOccurrences.get(healthEvent.code) ?? 0) + 1;
				healthOccurrences.set(healthEvent.code, occurrence);
				if (!healthEvent.recoverable) lastFatalHealthEvent = healthEvent;
				console.info("[sidecar_health]", {
					code: healthEvent.code,
					component: healthEvent.component,
					recoverable: healthEvent.recoverable,
					failureClass: healthEvent.failureClass,
					micState: healthEvent.micState,
					systemState: healthEvent.systemState,
					occurrence,
					message: healthEvent.message
				});
				if (!healthEvent.recoverable || occurrence >= RECOVERABLE_HEALTH_CAPTURE_THRESHOLD) emitMessage(`sidecar health: ${healthEvent.code} ${healthEvent.message}`);
				onHealth?.(healthEvent);
			}
			if (!stopState.stopped) emitMessage(`sidecar: ${line}`);
		}
	});
	const { child } = spawned;
	const pipeline = createAudioPipeline(sendBinary, () => stopStream(), stopState, onChunkMetrics);
	const cleanup = () => {
		child.stdout.off("data", pipeline.handleData);
		spawned.cleanup();
	};
	const stop = () => {
		if (stopState.stopped) return;
		stopState.stopped = true;
		cleanup();
		try {
			child.kill();
		} catch {}
	};
	stopStream = stop;
	child.stdout.on("data", pipeline.handleData);
	child.on("exit", (code, signal) => {
		if (stopState.stopped) return;
		stopState.stopped = true;
		cleanup();
		const message = `Sidecar exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "null"}`;
		emitMessage(`sidecar exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
		if (code !== 0) {
			const failureClass = lastFatalHealthEvent?.failureClass ?? "audio_stream_failed";
			onFailure?.({
				event: "exit",
				message,
				exitCode: code,
				signal,
				failureClass,
				healthCode: lastFatalHealthEvent?.code,
				recoverable: lastFatalHealthEvent?.recoverable,
				micState: lastFatalHealthEvent?.micState,
				systemState: lastFatalHealthEvent?.systemState
			});
		}
	});
	child.on("error", (error) => {
		if (stopState.stopped) return;
		stopState.stopped = true;
		cleanup();
		emitMessage(`sidecar error: ${error.message}`);
		const failureClass = lastFatalHealthEvent?.failureClass ?? "sidecar_engine_failed";
		onFailure?.({
			event: "error",
			message: error.message,
			failureClass,
			healthCode: lastFatalHealthEvent?.code,
			recoverable: lastFatalHealthEvent?.recoverable,
			micState: lastFatalHealthEvent?.micState,
			systemState: lastFatalHealthEvent?.systemState
		});
	});
	return {
		child,
		stop,
		get stopped() {
			return stopState.stopped;
		}
	};
}
function startSidecarAudioStream(sendBinary, emitMessage, onFailure, onHealth, devices, onChunkMetrics) {
	return startSpawnAudioStream(sendBinary, emitMessage, onFailure, onHealth, devices, onChunkMetrics);
}
function waitForAudioStreamReady(audio, timeoutMs = AUDIO_STREAM_READY_TIMEOUT_MS) {
	if (audio.stopped) return Promise.reject(/* @__PURE__ */ new Error("Audio sidecar stopped before producing audio"));
	return new Promise((resolve, reject) => {
		let settled = false;
		let pending = Buffer.alloc(0);
		const cleanup = () => {
			clearTimeout(timeout);
			audio.child.stdout.off("data", handleData);
			audio.child.off("exit", handleExit);
			audio.child.off("error", handleError);
		};
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const handleData = (chunk) => {
			if (chunk.length === 0) return;
			pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
			if (pending.length < 2560) return;
			if (analyzeSidecarPcm16Chunk(pending.subarray(0, 2560)).frames === 0) return;
			finish(resolve);
		};
		const handleExit = (code, signal) => {
			finish(() => {
				reject(/* @__PURE__ */ new Error(`Audio sidecar exited before producing audio: code=${code ?? "null"} signal=${signal ?? "null"}`));
			});
		};
		const handleError = (error) => {
			finish(() => {
				reject(error);
			});
		};
		const timeout = setTimeout(() => {
			finish(() => {
				reject(/* @__PURE__ */ new Error("Timed out waiting for audio sidecar output"));
			});
		}, timeoutMs);
		audio.child.stdout.on("data", handleData);
		audio.child.on("exit", handleExit);
		audio.child.on("error", handleError);
	});
}
function stopAudioStreamInternal(audio) {
	if (!audio.stopped) audio.stop();
}
function parseSidecarHealthPayload(line) {
	const markerIndex = line.indexOf(SIDECAR_HEALTH_PREFIX);
	if (markerIndex === -1) return null;
	const rawPayload = line.slice(markerIndex + 20).trim();
	try {
		const payload = JSON.parse(rawPayload);
		if (!isSidecarHealthCode(payload.code)) return null;
		const micState = isSidecarMicState(payload.mic) ? payload.mic : "ok";
		const systemState = isSidecarSystemState(payload.system) ? payload.system : "ok";
		return {
			code: payload.code,
			component: typeof payload.component === "string" && payload.component.length > 0 ? payload.component : "capture",
			message: typeof payload.message === "string" && payload.message.length > 0 ? payload.message : payload.code,
			recoverable: payload.recoverable === true,
			mic: micState,
			system: systemState
		};
	} catch {
		return null;
	}
}
function createChannelMetrics(squareSum, peak, frames) {
	if (frames <= 0) return {
		rms: 0,
		peak: 0
	};
	return {
		rms: Math.sqrt(squareSum / frames) / PCM16_SCALE,
		peak: peak / PCM16_SCALE
	};
}
function resolveSidecarFailureClass(code) {
	switch (code) {
		case "mic_degraded":
		case "mic_unavailable":
		case "mic_stalled":
		case "mic_silent": return "sidecar_mic_degraded";
		case "system_audio_lost": return "sidecar_system_audio_lost";
		case "system_audio_fallback":
		case "system_audio_stalled":
		case "system_audio_silent": return "audio_stream_failed";
		case "device_lost": return "sidecar_device_lost";
		case "capture_stalled": return "sidecar_capture_stalled";
		case "engine_failed":
		case "swift_capture_exited": return "sidecar_engine_failed";
	}
}
function isSidecarHealthCode(value) {
	return value === "mic_degraded" || value === "mic_unavailable" || value === "mic_stalled" || value === "mic_silent" || value === "system_audio_lost" || value === "system_audio_fallback" || value === "system_audio_stalled" || value === "system_audio_silent" || value === "device_lost" || value === "engine_failed" || value === "swift_capture_exited" || value === "capture_stalled";
}
function isSidecarMicState(value) {
	return value === "ok" || value === "degraded" || value === "unavailable" || value === "lost" || value === "stalled" || value === "silent";
}
function isSidecarSystemState(value) {
	return value === "ok" || value === "lost" || value === "stalled" || value === "silent";
}
//#endregion
//#region src/main/ipc/audio-devices.ts
var runningMeter = null;
async function getAudioDeviceState() {
	const capabilities = resolveCapabilities();
	const storedSelection = normalizeSelectionForPlatform(audioDevicesStore.getSelection(), capabilities);
	return {
		capabilities,
		devices: await readAudioDevices(capabilities, storedSelection),
		selection: storedSelection
	};
}
function setAudioDeviceSelection(selection) {
	const capabilities = resolveCapabilities();
	const nextSelection = normalizeSelectionForPlatform({
		...audioDevicesStore.getSelection(),
		...selection
	}, capabilities);
	return audioDevicesStore.setSelection(nextSelection);
}
function registerAudioDevicesIpc() {
	ipcMain.handle(IPC_AUDIO_DEVICES.GET_STATE, async () => {
		return getAudioDeviceState();
	});
	ipcMain.handle(IPC_AUDIO_DEVICES.SET_SELECTION, async (_event, selection) => {
		setAudioDeviceSelection(selection);
		return getAudioDeviceState();
	});
	ipcMain.handle(IPC_AUDIO_DEVICES.START_METER, async (event, options) => {
		startMeter(event.sender, options.kind);
	});
	ipcMain.handle(IPC_AUDIO_DEVICES.STOP_METER, async () => {
		stopMeter();
	});
}
function resolveCapabilities() {
	return {
		supportsMicrophoneSelection: process.platform === "darwin" || process.platform === "win32",
		supportsSystemAudioSelection: process.platform === "win32",
		systemAudioFollowsSystemOutput: process.platform === "darwin"
	};
}
function normalizeSelectionForPlatform(selection, capabilities) {
	const normalized = normalizeAudioDeviceSelection(selection);
	if (!capabilities.supportsSystemAudioSelection) normalized.systemAudioDeviceId = SYSTEM_DEFAULT_AUDIO_DEVICE_ID;
	if (!capabilities.supportsMicrophoneSelection) normalized.microphoneDeviceId = SYSTEM_DEFAULT_AUDIO_DEVICE_ID;
	return normalized;
}
async function readAudioDevices(capabilities, selection) {
	const parsedDevices = await runSidecarDeviceList().catch(() => []);
	return appendUnavailableSelections(dedupeDevices([...defaultDevices(capabilities), ...parsedDevices]), selection);
}
function defaultDevices(capabilities) {
	const devices = [{
		id: SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
		label: "System Default Microphone",
		kind: "microphone",
		isDefault: true,
		isAvailable: true
	}];
	devices.push({
		id: SYSTEM_DEFAULT_AUDIO_DEVICE_ID,
		label: capabilities.systemAudioFollowsSystemOutput ? "Follow System Output" : "System Default Output",
		kind: "system-audio",
		isDefault: true,
		isAvailable: true
	});
	return devices;
}
async function runSidecarDeviceList() {
	const spawned = spawnSidecarProcess({
		mode: "list-devices",
		args: ["--list-devices", "--json"]
	});
	const chunks = [];
	try {
		return await new Promise((resolve, reject) => {
			const cleanup = () => {
				spawned.child.stdout.off("data", handleData);
				spawned.child.off("error", handleError);
				spawned.child.off("exit", handleExit);
			};
			const handleData = (chunk) => {
				chunks.push(chunk);
			};
			const handleError = (error) => {
				cleanup();
				reject(error);
			};
			const handleExit = (code) => {
				cleanup();
				if (code !== 0) {
					reject(/* @__PURE__ */ new Error(`Audio device listing failed with code ${code ?? "null"}`));
					return;
				}
				try {
					resolve(parseSidecarDevices(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
				} catch (error) {
					reject(error);
				}
			};
			spawned.child.stdout.on("data", handleData);
			spawned.child.once("error", handleError);
			spawned.child.once("exit", handleExit);
		});
	} finally {
		spawned.cleanup();
	}
}
function parseSidecarDevices(payload) {
	if (!Array.isArray(payload.devices)) return [];
	return payload.devices.flatMap((device) => {
		if (!device.id || !device.kind || device.kind !== "microphone" && device.kind !== "system-audio") return [];
		return [{
			id: device.id,
			label: device.label || device.id,
			kind: device.kind,
			isDefault: Boolean(device.isDefault),
			isAvailable: true
		}];
	});
}
function dedupeDevices(devices) {
	const seen = /* @__PURE__ */ new Set();
	return devices.filter((device) => {
		const key = `${device.kind}:${device.id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
function appendUnavailableSelections(devices, selection) {
	const nextDevices = [...devices];
	appendUnavailableSelection(nextDevices, "microphone", selection.microphoneDeviceId);
	appendUnavailableSelection(nextDevices, "system-audio", selection.systemAudioDeviceId);
	return nextDevices;
}
function appendUnavailableSelection(devices, kind, selectedId) {
	if (selectedId === "system-default") return;
	if (devices.some((device) => device.kind === kind && device.id === selectedId)) return;
	devices.push({
		id: selectedId,
		label: "Unavailable device",
		kind,
		isDefault: false,
		isAvailable: false
	});
}
function startMeter(webContents, activeKind) {
	stopMeter();
	let lastHealthEvent = null;
	let terminalEventSent = false;
	const sendEvent = (event) => {
		if (webContents.isDestroyed()) return;
		webContents.send(IPC_AUDIO_DEVICES.METER_EVENT, event);
	};
	const sendTerminalEvent = (event) => {
		if (terminalEventSent) return;
		terminalEventSent = true;
		sendEvent(event);
	};
	const spawned = spawnSidecarProcess({
		mode: "meter",
		args: ["--meter-only", ...buildAudioDeviceArgs(audioDevicesStore.getSelection())],
		onStderrLine: (line) => {
			const healthEvent = parseSidecarHealthLine(line);
			if (!healthEvent) return;
			lastHealthEvent = healthEvent;
			if (!healthEvent.recoverable) {
				sendTerminalEvent(createMeterHealthEvent(activeKind, healthEvent));
				return;
			}
			sendEvent(createMeterHealthNoticeEvent(activeKind, healthEvent));
		}
	});
	const stdoutReader = createInterface({ input: spawned.child.stdout });
	const handleLine = (line) => {
		if (terminalEventSent) return;
		const event = parseMeterEvent(line, activeKind);
		if (!event) return;
		sendEvent(event);
	};
	const cleanup = () => {
		stdoutReader.off("line", handleLine);
		stdoutReader.close();
		spawned.cleanup();
	};
	stdoutReader.on("line", handleLine);
	const closeRunningMeter = () => {
		if (runningMeter?.child === spawned.child) {
			cleanup();
			runningMeter = null;
		}
	};
	spawned.child.once("error", (error) => {
		if (runningMeter?.child !== spawned.child) return;
		sendTerminalEvent(createMeterFailureEvent(activeKind, "sidecar_error", error.message, lastHealthEvent));
		closeRunningMeter();
	});
	spawned.child.once("exit", (code, signal) => {
		if (runningMeter?.child !== spawned.child) return;
		if (code === 0) sendTerminalEvent(createMeterStoppedEvent(activeKind));
		else sendTerminalEvent(createMeterFailureEvent(activeKind, "sidecar_exit", `Audio sidecar exited with code=${code ?? "null"} signal=${signal ?? "null"}`, lastHealthEvent));
		closeRunningMeter();
	});
	runningMeter = {
		activeKind,
		child: spawned.child,
		cleanup,
		stdoutReader
	};
}
function stopMeter() {
	if (!runningMeter) return;
	const meter = runningMeter;
	runningMeter = null;
	meter.cleanup();
	try {
		meter.child.kill();
	} catch {}
}
function parseMeterEvent(line, activeKind) {
	try {
		const payload = JSON.parse(line);
		return {
			activeKind,
			microphone: clampLevel(payload.microphone),
			systemAudio: clampLevel(payload.systemAudio),
			timestamp: typeof payload.timestamp === "number" ? payload.timestamp : Date.now(),
			status: "active"
		};
	} catch {
		return null;
	}
}
function createMeterHealthEvent(activeKind, healthEvent) {
	return {
		activeKind,
		microphone: 0,
		systemAudio: 0,
		timestamp: Date.now(),
		status: "failed",
		reasonCode: healthEvent.code,
		reason: healthEvent.message,
		recoverable: healthEvent.recoverable,
		microphoneState: healthEvent.micState,
		systemAudioState: healthEvent.systemState
	};
}
function createMeterHealthNoticeEvent(activeKind, healthEvent) {
	return {
		activeKind,
		microphone: 0,
		systemAudio: 0,
		timestamp: Date.now(),
		status: "active",
		reasonCode: healthEvent.code,
		reason: healthEvent.message,
		recoverable: healthEvent.recoverable,
		microphoneState: healthEvent.micState,
		systemAudioState: healthEvent.systemState
	};
}
function createMeterFailureEvent(activeKind, reasonCode, reason, healthEvent) {
	return {
		activeKind,
		microphone: 0,
		systemAudio: 0,
		timestamp: Date.now(),
		status: "failed",
		reasonCode: healthEvent?.code ?? reasonCode,
		reason: healthEvent?.message ?? reason,
		recoverable: healthEvent?.recoverable,
		microphoneState: healthEvent?.micState,
		systemAudioState: healthEvent?.systemState
	};
}
function createMeterStoppedEvent(activeKind) {
	return {
		activeKind,
		microphone: 0,
		systemAudio: 0,
		timestamp: Date.now(),
		status: "stopped"
	};
}
function clampLevel(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}
//#endregion
//#region src/main/ipc/auth.ts
var MAX_TOKEN_LENGTH = 8192;
/**
* Validate an access token.
* @param token - The token to validate
* @throws Error if the token is invalid
*/
function validateAccessToken(token) {
	const trimmed = token.trim();
	if (!trimmed) throw new Error("Access token is empty");
	if (trimmed.length > MAX_TOKEN_LENGTH) throw new Error("Access token too large");
}
/**
* Load tokens from store.
*/
function loadTokens() {
	const tokens = authStore.getTokens();
	if (tokens) {
		const trimmed = tokens.access_token.trim();
		if (!trimmed) {
			authStore.clear();
			return null;
		}
		return { access_token: trimmed };
	}
	return null;
}
/**
* Save an access token.
* @param accessToken - The access token to save
* @returns The saved tokens
* @throws Error if the token is invalid
*/
function saveAuthToken(accessToken) {
	validateAccessToken(accessToken);
	const tokens = { access_token: accessToken.trim() };
	authStore.setTokens(tokens);
	return tokens;
}
/**
* Load the stored auth token.
*/
function loadAuthToken() {
	return loadTokens();
}
/**
* Clear the stored auth token.
*/
function clearAuthToken() {
	authStore.clear();
}
/**
* Get the authentication status.
*/
function getAuthStatus() {
	return { has_token: loadTokens() !== null };
}
/**
* Register auth IPC handlers.
*/
function registerAuthIpc() {
	ipcMain.handle(IPC_AUTH.SAVE_TOKEN, (_event, accessToken) => {
		return saveAuthToken(accessToken);
	});
	ipcMain.handle(IPC_AUTH.LOAD_TOKEN, () => {
		return loadAuthToken();
	});
	ipcMain.handle(IPC_AUTH.CLEAR_TOKEN, () => {
		clearAuthToken();
	});
	ipcMain.handle(IPC_AUTH.STATUS, () => {
		return getAuthStatus();
	});
}
//#endregion
//#region ../../packages/contracts/dist/shared.mjs
var KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES = 30 * 1024 * 1024;
var KNOWLEDGE_DOCUMENT_IMAGE_MAX_SIZE_BYTES = 15 * 1024 * 1024;
var KNOWLEDGE_DOCUMENT_TEXT_MAX_SIZE_BYTES = 8 * 1024 * 1024;
var KNOWLEDGE_DOCUMENT_FILE_FORMATS = {
	pdf: {
		contentType: "application/pdf",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES
	},
	doc: {
		contentType: "application/msword",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES
	},
	docx: {
		contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES
	},
	ppt: {
		contentType: "application/vnd.ms-powerpoint",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES
	},
	pptx: {
		contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES
	},
	xls: {
		contentType: "application/vnd.ms-excel",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES
	},
	xlsx: {
		contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_OFFICE_MAX_SIZE_BYTES
	},
	txt: {
		contentType: "text/plain",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_TEXT_MAX_SIZE_BYTES
	},
	md: {
		contentType: "text/markdown",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_TEXT_MAX_SIZE_BYTES
	},
	markdown: {
		contentType: "text/markdown",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_TEXT_MAX_SIZE_BYTES
	},
	html: {
		contentType: "text/html",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_TEXT_MAX_SIZE_BYTES
	},
	htm: {
		contentType: "text/html",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_TEXT_MAX_SIZE_BYTES
	},
	jpg: {
		contentType: "image/jpeg",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_IMAGE_MAX_SIZE_BYTES
	},
	jpeg: {
		contentType: "image/jpeg",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_IMAGE_MAX_SIZE_BYTES
	},
	png: {
		contentType: "image/png",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_IMAGE_MAX_SIZE_BYTES
	},
	bmp: {
		contentType: "image/bmp",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_IMAGE_MAX_SIZE_BYTES
	},
	gif: {
		contentType: "image/gif",
		maxSizeBytes: KNOWLEDGE_DOCUMENT_IMAGE_MAX_SIZE_BYTES
	}
};
Object.keys(KNOWLEDGE_DOCUMENT_FILE_FORMATS);
Array.from(new Set(Object.values(KNOWLEDGE_DOCUMENT_FILE_FORMATS).map((format) => format.contentType)));
Math.max(...Object.values(KNOWLEDGE_DOCUMENT_FILE_FORMATS).map((format) => format.maxSizeBytes));
//#endregion
//#region src/shared/files.ts
var MAX_BINARY_DOCUMENT_BYTES = 50 * 1024 * 1024;
var MAX_IMAGE_FILE_BYTES = 16 * 1024 * 1024;
var SUPPORTED_FILE_TOKEN_EXTENSIONS = [
	"pdf",
	"doc",
	"docx",
	"ppt",
	"pptx",
	"xls",
	"xlsx",
	"xlsm",
	"jpg",
	"jpeg",
	"png",
	"bmp",
	"gif",
	"md",
	"markdown",
	"html",
	"htm",
	"epub",
	"mobi",
	"rtf",
	"txt",
	"webp"
];
function matchesSupportedFileTokenContent(sample, extension) {
	if (extension === "txt" || extension === "md" || extension === "markdown") return isUtf8Text(sample);
	if (extension === "pdf") return startsWithBytes(sample, [
		37,
		80,
		68,
		70,
		45
	]);
	if (extension === "doc" || extension === "ppt" || extension === "xls") return startsWithBytes(sample, [
		208,
		207,
		17,
		224,
		161,
		177,
		26,
		225
	]);
	if (extension === "docx" || extension === "pptx" || extension === "xlsx" || extension === "xlsm" || extension === "epub") return isZipFileSignature(sample);
	if (extension === "png") return startsWithBytes(sample, [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10
	]);
	if (extension === "jpg" || extension === "jpeg") return startsWithBytes(sample, [
		255,
		216,
		255
	]);
	if (extension === "bmp") return startsWithBytes(sample, [66, 77]);
	if (extension === "gif") return startsWithBytes(sample, [
		71,
		73,
		70,
		56,
		55,
		97
	]) || startsWithBytes(sample, [
		71,
		73,
		70,
		56,
		57,
		97
	]);
	if (extension === "webp") return startsWithBytes(sample, [
		82,
		73,
		70,
		70
	]) && hasBytesAt(sample, 8, [
		87,
		69,
		66,
		80
	]);
	if (extension === "html" || extension === "htm") return isHtmlText(sample);
	if (extension === "mobi") return hasBytesAt(sample, 60, [
		66,
		79,
		79,
		75,
		77,
		79,
		66,
		73
	]);
	return extension === "rtf" && startsWithBytes(sample, [
		123,
		92,
		114,
		116,
		102
	]);
}
function startsWithBytes(sample, expected) {
	return sample.length >= expected.length && expected.every((byte, index) => sample[index] === byte);
}
function hasBytesAt(sample, offset, expected) {
	return sample.length >= offset + expected.length && expected.every((byte, index) => sample[offset + index] === byte);
}
function isZipFileSignature(sample) {
	return startsWithBytes(sample, [
		80,
		75,
		3,
		4
	]) || startsWithBytes(sample, [
		80,
		75,
		5,
		6
	]) || startsWithBytes(sample, [
		80,
		75,
		7,
		8
	]);
}
function isUtf8Text(sample) {
	try {
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(sample);
		return Array.from(decoded).every((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint >= 32 || codePoint === 9 || codePoint === 10 || codePoint === 13;
		});
	} catch {
		return false;
	}
}
function isHtmlText(sample) {
	if (!isUtf8Text(sample)) return false;
	const text = new TextDecoder("utf-8").decode(sample).replace(/^\uFEFF/u, "").trimStart();
	return /^<(?:!doctype\s+html\b|html\b|head\b|body\b|title\b|meta\b|main\b|section\b|article\b|div\b|p\b|h[1-6]\b)/iu.test(text);
}
//#endregion
//#region src/main/file-content-validation.ts
var directUtf8TextFileExtensions = /* @__PURE__ */ new Set([
	"txt",
	"md",
	"markdown"
]);
function isDirectUtf8TextFileTokenExtension(extension) {
	return directUtf8TextFileExtensions.has(extension);
}
async function assertFileContentMatchesExtension(filePath, extension) {
	if (!matchesSupportedFileTokenContent(isDirectUtf8TextFileTokenExtension(extension) ? await promises.readFile(filePath) : await readFileSample(filePath, 64 * 1024), extension)) throw new Error("Selected file content does not match its extension");
}
async function readFileSample(filePath, maxBytes) {
	const handle = await promises.open(filePath, "r");
	try {
		const buffer = Buffer.alloc(maxBytes);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}
//#endregion
//#region src/main/image-normalization.ts
var MAX_IMAGE_PIXELS = 5e7;
var NORMALIZED_IMAGE_LONG_EDGE_LIMIT = 2048;
async function normalizeImageAttachmentBytes(input) {
	const inputBuffer = Buffer.from(input.bytes);
	const metadata = await sharp(inputBuffer, {
		animated: false,
		limitInputPixels: MAX_IMAGE_PIXELS
	}).metadata();
	assertSupportedImageMetadata(metadata);
	const normalized = await createNormalizedImageVariant(inputBuffer, input.extension, metadata.hasAlpha);
	const thumbnail = await createThumbnailVariant(normalized).catch(() => void 0);
	return {
		image: normalized,
		...thumbnail ? { thumbnail } : {},
		metadata: {
			source: {
				extension: input.extension,
				sizeBytes: input.sizeBytes,
				format: metadata.format ?? null,
				width: metadata.width ?? null,
				height: metadata.height ?? null,
				hasAlpha: typeof metadata.hasAlpha === "boolean" ? metadata.hasAlpha : null
			},
			normalized: {
				extension: normalized.extension,
				contentType: normalized.contentType,
				sizeBytes: normalized.sizeBytes,
				width: normalized.width,
				height: normalized.height,
				longEdgeLimit: NORMALIZED_IMAGE_LONG_EDGE_LIMIT
			},
			...thumbnail ? { thumbnail: {
				extension: thumbnail.extension,
				contentType: thumbnail.contentType,
				sizeBytes: thumbnail.sizeBytes,
				width: thumbnail.width,
				height: thumbnail.height
			} } : {}
		}
	};
}
function assertSupportedImageMetadata(metadata) {
	if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") throw new Error("Selected image format is not supported");
	if (metadata.pages && metadata.pages > 1) throw new Error("Animated images are not supported");
	const width = metadata.autoOrient?.width ?? metadata.width;
	const height = metadata.autoOrient?.height ?? metadata.height;
	if (!width || !height) throw new Error("Selected image dimensions are unknown");
	if (width * height > 5e7) throw new Error(`Selected image exceeds the ${MAX_IMAGE_PIXELS} pixel limit`);
}
function createBaseImagePipeline(input) {
	return sharp(input, {
		animated: false,
		limitInputPixels: MAX_IMAGE_PIXELS
	}).autoOrient().resize({
		width: NORMALIZED_IMAGE_LONG_EDGE_LIMIT,
		height: NORMALIZED_IMAGE_LONG_EDGE_LIMIT,
		fit: "inside",
		withoutEnlargement: true
	}).toColorspace("srgb");
}
async function createNormalizedImageVariant(input, extension, hasAlpha) {
	const pipeline = createBaseImagePipeline(input);
	if (extension === "jpg" || extension === "jpeg") return createImageVariant(await pipeline.jpeg({
		quality: 85,
		progressive: true
	}).toBuffer({ resolveWithObject: true }), "image/jpeg", "jpg");
	if (extension === "webp") return createImageVariant(await pipeline.webp(hasAlpha ? { lossless: true } : { quality: 86 }).toBuffer({ resolveWithObject: true }), "image/webp", "webp");
	const pngOutput = await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
	if (pngOutput.info.size <= 4194304) return createImageVariant(pngOutput, "image/png", "png");
	return createImageVariant(await createBaseImagePipeline(input).webp({ lossless: true }).toBuffer({ resolveWithObject: true }), "image/webp", "webp");
}
async function createThumbnailVariant(normalized) {
	return createImageVariant(await sharp(Buffer.from(normalized.bytes), {
		animated: false,
		limitInputPixels: MAX_IMAGE_PIXELS
	}).resize({
		width: 256,
		height: 256,
		fit: "cover"
	}).toColorspace("srgb").webp({ quality: 75 }).toBuffer({ resolveWithObject: true }), "image/webp", "webp");
}
function createImageVariant(output, contentType, extension) {
	return {
		bytes: toUint8Array(output.data),
		contentType,
		extension,
		sizeBytes: output.info.size,
		width: output.info.width,
		height: output.info.height
	};
}
function toUint8Array(buffer) {
	return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}
//#endregion
//#region src/main/ipc/files.ts
var fileTokenEntries = /* @__PURE__ */ new Map();
var supportedFileExtensions = new Set(SUPPORTED_FILE_TOKEN_EXTENSIONS);
var imageFileExtensions = /* @__PURE__ */ new Set([
	"png",
	"jpg",
	"jpeg",
	"bmp",
	"gif",
	"webp"
]);
var normalizableImageFileExtensions = /* @__PURE__ */ new Set([
	"png",
	"jpg",
	"jpeg",
	"webp"
]);
function isSupportedFileExtension(extension) {
	return supportedFileExtensions.has(extension);
}
function getFileSizeLimit(extension) {
	if (imageFileExtensions.has(extension)) return MAX_IMAGE_FILE_BYTES;
	return isDirectUtf8TextFileTokenExtension(extension) ? KNOWLEDGE_DOCUMENT_TEXT_MAX_SIZE_BYTES : MAX_BINARY_DOCUMENT_BYTES;
}
function isNormalizableImageFileExtension(extension) {
	return normalizableImageFileExtensions.has(extension);
}
function normalizeFileToken(fileToken) {
	const trimmed = fileToken.trim();
	if (!trimmed) throw new Error("File token is empty");
	return trimmed;
}
function resolveSelectedFileName(filePath) {
	const nativeName = basename(filePath);
	const windowsName = win32.basename(filePath);
	return nativeName.includes("\\") && !windowsName.includes("\\") ? windowsName : nativeName;
}
function resolveSelectedFileExtension(filePath) {
	return extname(resolveSelectedFileName(filePath)).replace(/^\./, "").toLowerCase();
}
async function validateSelectedFile(filePath) {
	const name = resolveSelectedFileName(filePath);
	const extension = resolveSelectedFileExtension(filePath);
	if (!isSupportedFileExtension(extension)) throw new Error(`Unsupported file extension: ${extension || "none"}`);
	const stats = await promises.stat(filePath);
	if (!stats.isFile()) throw new Error("Selected path is not a file");
	const sizeLimit = getFileSizeLimit(extension);
	if (stats.size > sizeLimit) throw new Error(`Selected file exceeds the ${sizeLimit} byte limit`);
	await assertFileContentMatchesExtension(filePath, extension);
	return {
		deviceId: stats.dev,
		filePath,
		inode: stats.ino,
		name,
		sizeBytes: stats.size,
		mtimeMs: stats.mtimeMs,
		extension
	};
}
async function validateTokenEntry(entry) {
	const currentName = resolveSelectedFileName(entry.filePath);
	const currentExtension = resolveSelectedFileExtension(entry.filePath);
	if (currentName !== entry.name || currentExtension !== entry.extension || !isSupportedFileExtension(currentExtension)) throw new Error("attachment_source_changed");
	const stats = await promises.stat(entry.filePath);
	if (!stats.isFile()) throw new Error("attachment_source_changed");
	if (stats.dev !== entry.deviceId || stats.ino !== entry.inode || stats.size !== entry.sizeBytes || stats.mtimeMs !== entry.mtimeMs) throw new Error("attachment_source_changed");
	if (stats.size > getFileSizeLimit(currentExtension)) throw new Error("Selected file exceeds the allowed size limit");
	await assertFileContentMatchesExtension(entry.filePath, currentExtension);
	return entry;
}
function createFileHandle(entry) {
	const fileToken = randomUUID();
	fileTokenEntries.set(fileToken, entry);
	return {
		fileToken,
		name: entry.name,
		sizeBytes: entry.sizeBytes,
		mtimeMs: entry.mtimeMs,
		extension: entry.extension
	};
}
async function resolveFileEntryFromToken(fileToken) {
	const normalizedToken = normalizeFileToken(fileToken);
	const entry = fileTokenEntries.get(normalizedToken);
	if (!entry) throw new Error("attachment_source_changed");
	return validateTokenEntry(entry);
}
async function normalizeImageAttachmentFromToken(fileToken) {
	const entry = await resolveFileEntryFromToken(fileToken);
	if (!isNormalizableImageFileExtension(entry.extension)) throw new Error("Selected file is not an image");
	return normalizeImageAttachmentBytes({
		bytes: await readStableFileBytes(entry),
		extension: entry.extension,
		sizeBytes: entry.sizeBytes
	});
}
async function readStableFileBytes(entry) {
	const bytes = await promises.readFile(entry.filePath);
	await validateTokenEntry(entry);
	if (bytes.byteLength !== entry.sizeBytes) throw new Error("attachment_source_changed");
	return bytes;
}
function registerFilesIpc() {
	ipcMain.handle(IPC_FILES.OPEN_DIALOG, async (_event, options) => {
		const properties = ["openFile"];
		if (options?.multiple) properties.push("multiSelections");
		const result = await dialog.showOpenDialog({
			properties,
			filters: options?.filters
		});
		if (result.canceled) return null;
		return (await Promise.all(result.filePaths.map(validateSelectedFile))).map(createFileHandle);
	});
	ipcMain.handle(IPC_FILES.STAT, async (_event, fileToken) => {
		const entry = await resolveFileEntryFromToken(fileToken);
		return {
			sizeBytes: entry.sizeBytes,
			mtimeMs: entry.mtimeMs
		};
	});
	ipcMain.handle(IPC_FILES.READ_FILE, async (_event, fileToken) => {
		return readStableFileBytes(await resolveFileEntryFromToken(fileToken));
	});
	ipcMain.handle(IPC_FILES.RELEASE, (_event, fileToken) => {
		fileTokenEntries.delete(normalizeFileToken(fileToken));
	});
	ipcMain.handle(IPC_FILES.NORMALIZE_IMAGE, async (_event, fileToken) => {
		return normalizeImageAttachmentFromToken(fileToken);
	});
}
//#endregion
//#region src/shared/locale.ts
var DESKTOP_SUPPORTED_LOCALES = [
	"zh-Hans-CN",
	"zh-Hant-HK",
	"zh-Hant-TW",
	"en-Latn-US"
];
var DESKTOP_DEFAULT_LOCALE = "en-Latn-US";
//#endregion
//#region src/main/ipc/locale.ts
var ALIAS_TO_LOCALE = {
	zh: "zh-Hans-CN",
	"zh-cn": "zh-Hans-CN",
	"zh-hans": "zh-Hans-CN",
	"zh-hans-cn": "zh-Hans-CN",
	cmn: "zh-Hans-CN",
	"cmn-hans": "zh-Hans-CN",
	"cmn-hans-cn": "zh-Hans-CN",
	"zh-hk": "zh-Hant-HK",
	"zh-hant-hk": "zh-Hant-HK",
	yue: "zh-Hant-HK",
	"yue-hk": "zh-Hant-HK",
	"yue-hant": "zh-Hant-HK",
	"yue-hant-hk": "zh-Hant-HK",
	"zh-tw": "zh-Hant-TW",
	"zh-hant-tw": "zh-Hant-TW",
	"zh-hant": "zh-Hant-TW",
	en: "en-Latn-US",
	"en-us": "en-Latn-US",
	"en-latn": "en-Latn-US",
	"en-latn-us": "en-Latn-US",
	"en-gb": "en-Latn-GB",
	"en-latn-gb": "en-Latn-GB",
	"en-au": "en-Latn-AU",
	"en-latn-au": "en-Latn-AU",
	"en-sg": "en-Latn-SG",
	"en-latn-sg": "en-Latn-SG",
	ja: "ja-Jpan-JP",
	"ja-jp": "ja-Jpan-JP",
	"ja-jpan": "ja-Jpan-JP",
	"ja-jpan-jp": "ja-Jpan-JP",
	ko: "ko-Kore-KR",
	"ko-kr": "ko-Kore-KR",
	"ko-kore": "ko-Kore-KR",
	"ko-kore-kr": "ko-Kore-KR",
	de: "de-Latn-DE",
	"de-de": "de-Latn-DE",
	"de-latn": "de-Latn-DE",
	"de-latn-de": "de-Latn-DE",
	fr: "fr-Latn-FR",
	"fr-fr": "fr-Latn-FR",
	"fr-latn": "fr-Latn-FR",
	"fr-latn-fr": "fr-Latn-FR",
	es: "es-Latn-ES",
	"es-es": "es-Latn-ES",
	"es-latn": "es-Latn-ES",
	"es-latn-es": "es-Latn-ES"
};
var LOCALE_CANONICAL = {
	"zh-hans-cn": "zh-Hans-CN",
	"zh-hant-hk": "zh-Hant-HK",
	"zh-hant-tw": "zh-Hant-TW",
	"en-latn-us": "en-Latn-US",
	"en-latn-gb": "en-Latn-GB",
	"en-latn-au": "en-Latn-AU",
	"en-latn-sg": "en-Latn-SG",
	"ja-jpan-jp": "ja-Jpan-JP",
	"ko-kore-kr": "ko-Kore-KR",
	"de-latn-de": "de-Latn-DE",
	"fr-latn-fr": "fr-Latn-FR",
	"es-latn-es": "es-Latn-ES"
};
/**
* Check if a locale is supported.
*/
function isSupported(locale) {
	return DESKTOP_SUPPORTED_LOCALES.includes(locale);
}
/**
* Use Intl.Locale.maximize() to expand a locale string to full BCP 47 format.
* e.g., "zh-CN" -> "zh-Hans-CN", "en" -> "en-Latn-US"
*/
function maximizeLocale(input) {
	try {
		return new Intl.Locale(input).maximize().toString();
	} catch {
		return null;
	}
}
/**
* Normalize any locale input to a supported full BCP 47 locale.
* Resolution order (matching Rust/ICU4X implementation):
* 1. Direct canonical match (case-insensitive)
* 2. Alias lookup
* 3. Try Intl.Locale maximize() then match
* 4. Language-only fallback
*/
function normalizeLocale(input) {
	if (!input) return null;
	const trimmed = input.trim();
	if (!trimmed) return null;
	const lowercase = trimmed.toLowerCase();
	if (LOCALE_CANONICAL[lowercase]) return LOCALE_CANONICAL[lowercase];
	if (ALIAS_TO_LOCALE[lowercase]) return ALIAS_TO_LOCALE[lowercase];
	const maximized = maximizeLocale(trimmed);
	if (maximized) {
		const maximizedLower = maximized.toLowerCase();
		if (LOCALE_CANONICAL[maximizedLower]) return LOCALE_CANONICAL[maximizedLower];
		if (ALIAS_TO_LOCALE[maximizedLower]) return ALIAS_TO_LOCALE[maximizedLower];
	}
	const lang = lowercase.split("-")[0];
	if (lang && ALIAS_TO_LOCALE[lang]) return ALIAS_TO_LOCALE[lang];
	return null;
}
/**
* Get the raw system locale from Electron.
*/
function getSystemLocale() {
	try {
		return app.getSystemLocale() || app.getLocale() || null;
	} catch {
		return null;
	}
}
/**
* Resolve the system locale to a supported locale.
*/
function resolveSystemLocale() {
	const resolved = normalizeLocale(getSystemLocale());
	if (resolved && isSupported(resolved)) return {
		locale: resolved,
		source: "system_locale"
	};
	return {
		locale: DESKTOP_DEFAULT_LOCALE,
		source: "default_fallback"
	};
}
/**
* Load the user's locale preference from store.
*/
function loadUserLocale() {
	const stored = localeStore.get();
	if (stored) {
		const normalized = normalizeLocale(stored);
		if (normalized && isSupported(normalized)) return normalized;
		localeStore.clear();
	}
	return null;
}
/**
* Get the current locale.
* Priority: User preference > System locale > Default fallback
*/
function getLocale() {
	const userLocale = loadUserLocale();
	if (userLocale) return {
		locale: userLocale,
		source: "user_preference"
	};
	const { locale, source } = resolveSystemLocale();
	return {
		locale,
		source
	};
}
/**
* Set the locale preference.
* @param locale - The locale to set, or "auto" to clear
* @returns The new locale info
* @throws Error if the locale is not supported
*/
function setLocale(locale) {
	const trimmed = locale.trim();
	if (!trimmed || trimmed.toLowerCase() === "auto") return clearLocale();
	const normalized = normalizeLocale(trimmed);
	if (!normalized || !isSupported(normalized)) throw new Error(`Unsupported locale: ${locale}`);
	localeStore.set(normalized);
	return {
		locale: normalized,
		source: "user_preference"
	};
}
/**
* Clear the locale preference and fall back to system/default.
*/
function clearLocale() {
	localeStore.clear();
	const { locale, source } = resolveSystemLocale();
	return {
		locale,
		source
	};
}
/**
* Register locale IPC handlers.
*/
function registerLocaleIpc() {
	ipcMain.handle(IPC_LOCALE.GET_SYSTEM, () => {
		return getSystemLocale();
	});
	ipcMain.handle(IPC_LOCALE.GET, () => {
		return getLocale();
	});
	ipcMain.handle(IPC_LOCALE.SET, (_event, locale) => {
		return setLocale(locale);
	});
	ipcMain.handle(IPC_LOCALE.CLEAR, () => {
		return clearLocale();
	});
}
//#endregion
//#region src/main/lib/runtime-paths.ts
var mainDistDir = dirname(fileURLToPath(import.meta.url));
var preloadEntryPath = join(mainDistDir, "../preload/index.mjs");
var rendererDistDir = join(mainDistDir, "../renderer");
//#endregion
//#region src/main/protocol.ts
/**
* Custom protocol (aether://) for serving renderer content in production.
*
* Benefits over file:// :
*  - Proper Origin header for CORS ("aether://localhost")
*  - Secure Context (WebCrypto, Service Workers, etc.)
*  - Standard-compliant fetch/XHR behaviour
*
* Usage:
*  1. Call registerProtocolScheme() BEFORE app.whenReady()
*  2. Call setupProtocolHandler() AFTER app.whenReady()
*  3. Use getRendererURL(hash) to load windows
*/
var PROTOCOL_SCHEME = "cheater";
var PROTOCOL_HOST = "localhost";
/** Absolute path to the renderer output directory (resolved at runtime). */
var RENDERER_DIR = rendererDistDir;
/**
* Register the custom scheme as privileged.
* MUST be called synchronously before app.whenReady().
*/
function registerProtocolScheme() {
	protocol.registerSchemesAsPrivileged([{
		scheme: PROTOCOL_SCHEME,
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
			stream: true
		}
	}]);
}
/**
* Install the protocol handler that maps aether:// URLs to local renderer files.
* MUST be called after app.whenReady().
*/
function setupProtocolHandler() {
	protocol.handle(PROTOCOL_SCHEME, (request) => {
		const url = new URL(request.url);
		let pathname = decodeURIComponent(url.pathname);
		if (pathname.startsWith("/")) pathname = pathname.slice(1);
		const resolved = normalize(join(RENDERER_DIR, pathname));
		if (!resolved.startsWith(RENDERER_DIR)) return new Response("Forbidden", { status: 403 });
		const filePath = pathname && existsSync(resolved) ? resolved : join(RENDERER_DIR, "index.html");
		return net.fetch(pathToFileURL(filePath).href);
	});
}
/**
* Build the URL to load in a BrowserWindow for a given hash route.
*
* - Development: uses the Vite dev server (ELECTRON_RENDERER_URL)
* - Production:  uses the custom aether:// protocol
*
* @param hash - Hash route including leading slash, e.g. "/" or "/onboard"
*/
function getRendererURL(hash) {
	if (is.dev && process.env.ELECTRON_RENDERER_URL) return `${process.env.ELECTRON_RENDERER_URL}/#${hash}`;
	return `${PROTOCOL_SCHEME}://${PROTOCOL_HOST}/#${hash}`;
}
//#endregion
//#region src/main/windows/navigation-guard.ts
var INTERNAL_PROTOCOL = "cheater:";
var INTERNAL_HOST = "localhost";
var EXTERNAL_PROTOCOLS = /* @__PURE__ */ new Set([
	"http:",
	"https:",
	"mailto:"
]);
function getNavigationRuntime() {
	const devServerURL = process.env.ELECTRON_RENDERER_URL;
	return {
		isDev: Boolean(devServerURL),
		devServerURL
	};
}
function getNavigationDecision(targetURL, runtime) {
	let parsed;
	try {
		parsed = new URL(targetURL);
	} catch {
		return "deny";
	}
	if (isInternalRendererURL(parsed, runtime)) return "allow";
	if (EXTERNAL_PROTOCOLS.has(parsed.protocol)) return "open-external";
	return "deny";
}
function installNavigationGuard(webContents, options = {}) {
	const windowName = options.windowName ?? "unknown";
	const runtime = options.runtime ?? getNavigationRuntime();
	const onBlocked = options.onBlocked ?? ((entry) => console.warn("[navigation-guard]", entry));
	const openExternal = options.openExternal ?? (() => {});
	const handleNavigation = (event, targetURL, source) => {
		const decision = getNavigationDecision(targetURL, runtime);
		if (decision === "allow") return;
		event.preventDefault();
		if (decision === "open-external") Promise.resolve(openExternal(targetURL)).catch(() => {});
		onBlocked({
			windowName,
			source,
			targetURL,
			decision
		});
	};
	const registerListener = (eventName) => {
		webContents.on(eventName, (event, url) => handleNavigation(event, url, eventName));
	};
	registerListener("will-navigate");
	registerListener("will-frame-navigate");
	registerListener("will-redirect");
	webContents.setWindowOpenHandler(({ url }) => {
		const decision = getNavigationDecision(url, runtime);
		if (decision === "allow") return { action: "allow" };
		if (decision === "open-external") Promise.resolve(openExternal(url)).catch(() => {});
		onBlocked({
			windowName,
			source: "window-open",
			targetURL: url,
			decision
		});
		return { action: "deny" };
	});
}
function isInternalRendererURL(url, runtime) {
	if (runtime.isDev) {
		const devServerURL = runtime.devServerURL;
		if (!devServerURL) return false;
		try {
			const devOrigin = new URL(devServerURL).origin;
			return url.origin === devOrigin;
		} catch {
			return false;
		}
	}
	return url.protocol === INTERNAL_PROTOCOL && url.host === INTERNAL_HOST;
}
//#endregion
//#region src/main/windows/main.ts
var SHOW_FALLBACK_TIMEOUT_MS$1 = 5e3;
var MAIN_WINDOW_WIDTH = 1200;
var MAIN_WINDOW_HEIGHT = 800;
var MAIN_WINDOW_MIN_HEIGHT = 600;
var SAVE_BOUNDS_DEBOUNCE_MS = 500;
/** Check if the centre of the saved bounds falls within any connected display's work area. */
function isWindowBoundsVisible(bounds) {
	const displays = screen.getAllDisplays();
	const centerX = bounds.x + bounds.width / 2;
	const centerY = bounds.y + bounds.height / 2;
	return displays.some((display) => {
		const { x, y, width, height } = display.workArea;
		return centerX >= x && centerX < x + width && centerY >= y && centerY < y + height;
	});
}
var getMainWindowOptions = () => {
	const isMac = process.platform === "darwin";
	const isWin = process.platform === "win32";
	const savedBounds = windowStateStore.get().bounds;
	const hasSavedBounds = savedBounds !== null && isWindowBoundsVisible(savedBounds);
	const baseOptions = {
		width: hasSavedBounds ? savedBounds.width : MAIN_WINDOW_WIDTH,
		height: hasSavedBounds ? savedBounds.height : MAIN_WINDOW_HEIGHT,
		...hasSavedBounds ? {
			x: savedBounds.x,
			y: savedBounds.y
		} : {},
		minWidth: 940,
		minHeight: MAIN_WINDOW_MIN_HEIGHT,
		show: false,
		center: !hasSavedBounds,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		hasShadow: true,
		webPreferences: {
			preload: preloadEntryPath,
			contextIsolation: true,
			sandbox: false,
			nodeIntegration: false,
			webviewTag: false
		}
	};
	if (isMac) return {
		...baseOptions,
		vibrancy: "hud",
		visualEffectState: "active",
		titleBarStyle: "hiddenInset",
		trafficLightPosition: {
			x: 16,
			y: 16
		}
	};
	if (isWin) return {
		...baseOptions,
		height: hasSavedBounds ? savedBounds.height : MAIN_WINDOW_HEIGHT + 38,
		minHeight: MAIN_WINDOW_MIN_HEIGHT + 38,
		transparent: false,
		titleBarStyle: "hidden",
		thickFrame: true,
		roundedCorners: true,
		autoHideMenuBar: true,
		titleBarOverlay: {
			height: 38,
			color: "#00000000",
			symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#000000"
		},
		backgroundMaterial: "acrylic"
	};
	return baseOptions;
};
var mainWindow = null;
function createMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
	const isMac = process.platform === "darwin";
	const isWin = process.platform === "win32";
	const savedState = windowStateStore.get();
	mainWindow = new BrowserWindow(getMainWindowOptions());
	const windowRef = mainWindow;
	if (isMac) windowRef.setWindowButtonVisibility(true);
	if (isWin) {
		const updateTitleBarColors = () => {
			if (!windowRef.isDestroyed()) windowRef.setTitleBarOverlay({
				color: "#00000000",
				symbolColor: nativeTheme.shouldUseDarkColors ? "#ffffff" : "#000000"
			});
		};
		nativeTheme.on("updated", updateTitleBarColors);
		windowRef.once("closed", () => nativeTheme.off("updated", updateTitleBarColors));
	}
	if (savedState.isFullScreen) windowRef.setFullScreen(true);
	else if (savedState.isMaximized) windowRef.maximize();
	let saveBoundsTimer = null;
	const saveBoundsDebounced = () => {
		if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
		saveBoundsTimer = setTimeout(() => {
			if (windowRef.isDestroyed() || windowRef.isMaximized() || windowRef.isFullScreen()) return;
			windowStateStore.setBounds(windowRef.getBounds());
		}, SAVE_BOUNDS_DEBOUNCE_MS);
	};
	windowRef.on("resize", saveBoundsDebounced);
	windowRef.on("move", saveBoundsDebounced);
	windowRef.on("maximize", () => windowStateStore.setMaximized(true));
	windowRef.on("unmaximize", () => {
		windowStateStore.setMaximized(false);
		saveBoundsDebounced();
	});
	windowRef.on("enter-full-screen", () => {
		windowStateStore.setFullScreen(true);
		if (!windowRef.isDestroyed()) windowRef.webContents.send(IPC_WINDOW.FULLSCREEN_CHANGE, true);
	});
	windowRef.on("leave-full-screen", () => {
		windowStateStore.setFullScreen(false);
		if (!windowRef.isDestroyed()) windowRef.webContents.send(IPC_WINDOW.FULLSCREEN_CHANGE, false);
	});
	let windowReadyToShow = false;
	let rendererReady = false;
	const tryShowWindow = () => {
		if (windowRef.isDestroyed() || windowRef.isVisible()) return;
		if (windowReadyToShow && rendererReady) windowRef.show();
	};
	const handleRendererMessage = (_event, channel) => {
		if (channel !== IPC_WINDOW.RENDERER_READY) return;
		rendererReady = true;
		tryShowWindow();
	};
	const fallbackTimer = setTimeout(() => {
		if (windowRef.isDestroyed() || windowRef.isVisible()) return;
		windowRef.show();
	}, SHOW_FALLBACK_TIMEOUT_MS$1);
	windowRef.once("ready-to-show", () => {
		windowReadyToShow = true;
		tryShowWindow();
	});
	windowRef.webContents.on("ipc-message", handleRendererMessage);
	windowRef.once("show", () => {
		clearTimeout(fallbackTimer);
	});
	windowRef.on("closed", () => {
		clearTimeout(fallbackTimer);
		mainWindow = null;
	});
	installNavigationGuard(windowRef.webContents, {
		windowName: "main",
		openExternal: (url) => shell.openExternal(url)
	});
	windowRef.loadURL(getRendererURL("/"));
	return windowRef;
}
function getMainWindow() {
	return mainWindow;
}
function showMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.show();
		mainWindow.focus();
	}
}
function hideMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}
//#endregion
//#region src/main/windows/onboard.ts
var SHOW_FALLBACK_TIMEOUT_MS = 5e3;
var getOnboardOptions = () => {
	return {
		width: 928,
		height: 544,
		resizable: false,
		show: false,
		frame: false,
		transparent: true,
		hasShadow: true,
		backgroundColor: "#00000000",
		webPreferences: {
			preload: preloadEntryPath,
			sandbox: false,
			contextIsolation: true
		}
	};
};
var onboardWindow = null;
function createOnboardWindow() {
	// Cheater is local-only: onboarding and account login are permanently disabled.
	return createMainWindow();
	if (onboardWindow && !onboardWindow.isDestroyed()) return onboardWindow;
	onboardWindow = new BrowserWindow(getOnboardOptions());
	const windowRef = onboardWindow;
	let windowReadyToShow = false;
	let rendererReady = false;
	const tryShowWindow = () => {
		if (windowRef.isDestroyed() || windowRef.isVisible()) return;
		if (windowReadyToShow && rendererReady) windowRef.show();
	};
	const handleRendererMessage = (_event, channel) => {
		if (channel !== IPC_WINDOW.RENDERER_READY) return;
		rendererReady = true;
		tryShowWindow();
	};
	const fallbackTimer = setTimeout(() => {
		if (windowRef.isDestroyed() || windowRef.isVisible()) return;
		windowRef.show();
	}, SHOW_FALLBACK_TIMEOUT_MS);
	windowRef.once("ready-to-show", () => {
		windowReadyToShow = true;
		tryShowWindow();
	});
	windowRef.webContents.on("ipc-message", handleRendererMessage);
	windowRef.once("show", () => {
		clearTimeout(fallbackTimer);
	});
	windowRef.on("closed", () => {
		clearTimeout(fallbackTimer);
		onboardWindow = null;
	});
	installNavigationGuard(windowRef.webContents, {
		windowName: "onboard",
		openExternal: (url) => shell.openExternal(url)
	});
	windowRef.loadURL(getRendererURL("/"));
	return windowRef;
}
function closeOnboardWindow() {
	if (onboardWindow && !onboardWindow.isDestroyed()) {
		onboardWindow.close();
		onboardWindow = null;
	}
}
//#endregion
//#region src/main/windows/overlay.ts
/**
* Window configuration for overlay (transparent, click-through, always on top).
* Combines the old toolbar and panel windows into a single overlay.
*/
var getOverlayOptions = (mode) => ({
	resizable: false,
	show: false,
	frame: false,
	transparent: true,
	hasShadow: false,
	backgroundColor: "#00000000",
	alwaysOnTop: true,
	skipTaskbar: true,
	focusable: mode === "normal",
	webPreferences: {
		preload: preloadEntryPath,
		sandbox: false,
		contextIsolation: true
	}
});
var overlayWindow = null;
var closeAllowed = false;
var appQuitting$1 = false;
var pendingCloseTimer = null;
var delayedCloseToken = 0;
var currentOverlayInteractionMode = DEFAULT_OVERLAY_INTERACTION_MODE;
var desiredContentProtectionEnabled = true;
var WIN32_DELAYED_CLOSE_MS = 1200;
app.on("before-quit", () => {
	appQuitting$1 = true;
});
function clearPendingCloseTimer() {
	delayedCloseToken += 1;
	if (pendingCloseTimer) {
		clearTimeout(pendingCloseTimer);
		pendingCloseTimer = null;
	}
}
function applyOverlayInteractionMode(window, mode) {
	currentOverlayInteractionMode = mode;
	const focusable = mode === "normal";
	if (window.isFocusable() !== focusable) window.setFocusable(focusable);
	if (process.platform === "win32") window.setSkipTaskbar(true);
	// Forward motion over the transparent desktop; the renderer enables clicks over controls.
	window.setIgnoreMouseEvents(true, { forward: mode === "normal" });
	window.setAlwaysOnTop(true, "screen-saver");
	if (!window.webContents.isDestroyed()) window.webContents.send(IPC_SHORTCUT.OVERLAY_ACTION, "sync_interaction_mode");
}
function applyOverlayContentProtection(window) {
	window.setContentProtection(desiredContentProtectionEnabled);
	return window.isContentProtected();
}
function getCurrentOverlayInteractionMode() {
	return currentOverlayInteractionMode;
}
function resetOverlayInteractionMode() {
	currentOverlayInteractionMode = DEFAULT_OVERLAY_INTERACTION_MODE;
}
function getOverlayContentProtection() {
	if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow.isContentProtected();
	return desiredContentProtectionEnabled;
}
function setOverlayContentProtection(enabled) {
	// Interview content is always protected from screen sharing/capture. The
	// renderer may request a toggle for compatibility, but a live overlay never
	// exposes its contents.
	desiredContentProtectionEnabled = true;
	if (overlayWindow && !overlayWindow.isDestroyed()) return applyOverlayContentProtection(overlayWindow);
	return desiredContentProtectionEnabled;
}
function resetOverlayContentProtection() {
	desiredContentProtectionEnabled = true;
	if (overlayWindow && !overlayWindow.isDestroyed()) applyOverlayContentProtection(overlayWindow);
}
function createOverlayWindow(mode = DEFAULT_OVERLAY_INTERACTION_MODE) {
	clearPendingCloseTimer();
	if (overlayWindow && !overlayWindow.isDestroyed()) {
		closeAllowed = false;
		applyOverlayInteractionMode(overlayWindow, mode);
		applyOverlayContentProtection(overlayWindow);
		return overlayWindow;
	}
	currentOverlayInteractionMode = mode;
	overlayWindow = new BrowserWindow(getOverlayOptions(mode));
	closeAllowed = false;
	const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
	overlayWindow.setBounds({
		x,
		y,
		width,
		height
	});
	overlayWindow.setAlwaysOnTop(true, "screen-saver");
	if (process.platform === "darwin") overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	overlayWindow.on("always-on-top-changed", (_event, isAlwaysOnTop) => {
		if (!isAlwaysOnTop && overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setAlwaysOnTop(true, "screen-saver");
	});
	applyOverlayInteractionMode(overlayWindow, mode);
	applyOverlayContentProtection(overlayWindow);
	overlayWindow.on("ready-to-show", () => {
		showOverlayWindow(currentOverlayInteractionMode);
	});
	overlayWindow.on("close", (event) => {
		if (!closeAllowed && !appQuitting$1) event.preventDefault();
	});
	overlayWindow.on("closed", () => {
		overlayWindow = null;
		closeAllowed = false;
		resetOverlayInteractionMode();
		clearPendingCloseTimer();
	});
	installNavigationGuard(overlayWindow.webContents, {
		windowName: "overlay",
		openExternal: (url) => shell.openExternal(url)
	});
	overlayWindow.loadURL(getRendererURL("/overlay"));
	return overlayWindow;
}
function getOverlayWindow() {
	return overlayWindow;
}
function showOverlayWindow(mode = currentOverlayInteractionMode) {
	if (overlayWindow && !overlayWindow.isDestroyed()) {
		clearPendingCloseTimer();
		closeAllowed = false;
		applyOverlayInteractionMode(overlayWindow, mode);
		applyOverlayContentProtection(overlayWindow);
		overlayWindow.showInactive();
	}
}
function closeOverlayWindow() {
	if (overlayWindow && !overlayWindow.isDestroyed()) {
		if (process.platform === "win32") {
			closeAllowed = true;
			overlayWindow.hide();
			clearPendingCloseTimer();
			const windowRef = overlayWindow;
			const token = delayedCloseToken;
			pendingCloseTimer = setTimeout(() => {
				pendingCloseTimer = null;
				if (token !== delayedCloseToken) return;
				if (!windowRef || windowRef.isDestroyed()) return;
				windowRef.close();
			}, WIN32_DELAYED_CLOSE_MS);
			return;
		}
		closeAllowed = true;
		overlayWindow.close();
	}
}
//#endregion
//#region src/main/windows/index.ts
function shouldOpenMainWindow() {
	if (onboardStore.isCompleted()) return true;
	const milestones = onboardStore.getMilestones();
	if (!(milestones.welcome && milestones.account && (process.platform !== "darwin" || milestones.permissions))) return false;
	onboardStore.setCompleted(true);
	return true;
}
/**
* Initialize windows based on onboard completion status.
* Windows auto-show after renderer bootstrap completes.
*/
function initializeWindows() {
	createMainWindow();
}
/**
* Transition from onboard to main window.
* Called when onboard is completed.
*/
function completeOnboardAndShowMain() {
	onboardStore.setCompleted(true);
	const existingMainWindow = getMainWindow();
	if (existingMainWindow && !existingMainWindow.isDestroyed()) {
		showMainWindow();
		closeOnboardWindow();
		return;
	}
	const mainWindow = createMainWindow();
	if (mainWindow.isVisible()) {
		closeOnboardWindow();
		return;
	}
	mainWindow.once("show", () => {
		closeOnboardWindow();
	});
}
/**
* Reset onboard and show onboard window.
* Useful for debugging/testing.
*/
function resetOnboardAndShow() {
	onboardStore.setCompleted(true);
	showMainWindow();
}
//#endregion
//#region src/main/ipc/onboard.ts
/**
* Determine which onboard step the renderer should start at.
*
* Resolution order:
* 1. welcome not done → step 0 (welcome)
* 2. account not done → check auth token; if present, auto-complete and advance
* 3. darwin + permissions not done → permissions step
* 4. All milestones complete → mark completed, return last step
*/
function resolveInitialStep() {
	const milestones = onboardStore.getMilestones();
	const isDarwin = process.platform === "darwin";
	const steps = ["welcome", "account"];
	if (isDarwin) steps.push("permissions");
	if (!milestones.welcome) return {
		stepIndex: 0,
		stepId: "welcome",
		platform: process.platform,
		milestones
	};
	if (!milestones.account) if (authStore.getTokens()?.access_token) {
		onboardStore.setMilestone("account", true);
		milestones.account = true;
	} else return {
		stepIndex: 1,
		stepId: "account",
		platform: process.platform,
		milestones
	};
	if (isDarwin && !milestones.permissions) return {
		stepIndex: steps.indexOf("permissions"),
		stepId: "permissions",
		platform: process.platform,
		milestones
	};
	if (!onboardStore.isCompleted()) onboardStore.setCompleted(true);
	const lastIdx = steps.length - 1;
	return {
		stepIndex: lastIdx,
		stepId: steps[lastIdx],
		platform: process.platform,
		milestones
	};
}
/**
* Register onboard IPC handlers
*/
function registerOnboardIpc() {
	ipcMain.handle(IPC_ONBOARD.GET_STATUS, () => {
		return { completed: onboardStore.isCompleted() };
	});
	ipcMain.handle(IPC_ONBOARD.GET_INITIAL_STEP, () => {
		return resolveInitialStep();
	});
	ipcMain.handle(IPC_ONBOARD.SET_MILESTONE, (_event, milestone, value) => {
		onboardStore.setMilestone(milestone, value);
		return onboardStore.getMilestones();
	});
	ipcMain.handle(IPC_ONBOARD.COMPLETE, () => {
		completeOnboardAndShowMain();
		return { completed: true };
	});
	ipcMain.handle(IPC_ONBOARD.RESET, () => {
		resetOnboardAndShow();
		return { completed: false };
	});
}
//#endregion
//#region src/main/ipc/overlay-capture-authorization.ts
function authorizeOverlayCapture(input) {
	if (input.senderWindowId === null) return {
		ok: false,
		reason: "sender_not_window"
	};
	if (input.overlayWindowId === null || input.senderWindowId !== input.overlayWindowId) return {
		ok: false,
		reason: "sender_not_overlay"
	};
	if (!input.hasActiveRealtimeSession) return {
		ok: false,
		reason: "no_active_realtime_session"
	};
	return { ok: true };
}
//#endregion
//#region src/shared/interview-session.ts
var POSTGRES_INTEGER_MAX = 2147483647;
var ANSWER_SCREENSHOT_IMAGE_DATA_MAX_LENGTH = 16 * 1024 * 1024;
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
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
		"screenshot"
	]) && isUuid(value.requestId) && (value.parentMessageId === void 0 || isUuid(value.parentMessageId)) && (value.text === void 0 || typeof value.text === "string") && typeof value.useLatestMediaTranscript === "boolean" && typeof value.includeScreenshot === "boolean" && (value.screenshot === void 0 || isAnswerScreenshot(value.screenshot));
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
	return isRecord(value) && hasOnlyKeys(value, ["automationMode", "answerLength"]) && isStringMember(value.automationMode, ANSWER_AUTOMATION_MODES) && (value.answerLength === void 0 || ["quick", "standard", "deep"].includes(value.answerLength));
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
	return isRecord(value) && hasOnlyKeys(value, [
		"requestId",
		"turnId",
		"revisionId",
		"text"
	]) && isUuid(value.requestId) && isNonEmptyString(value.turnId) && isPositiveInteger(value.revisionId) && isNonEmptyString(value.text);
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
//#region src/main/interview-session/interview-reconnect-policy.ts
var DEFAULT_INTERVIEW_RECONNECT_POLICY = {
	maxAttempts: 4,
	totalBudgetMs: 2e4,
	baseDelayMs: 500,
	maxDelayMs: 5e3,
	jitterRatio: .2
};
function decideInterviewReconnect(input) {
	assertReconnectPolicy(input.policy);
	if (!Number.isInteger(input.nextAttempt) || input.nextAttempt < 1) throw new Error("nextAttempt must be a positive integer");
	if (input.nextAttempt > input.policy.maxAttempts) return {
		kind: "exhausted",
		reason: "attempt_cap"
	};
	const elapsedMs = Math.max(0, input.nowMs - input.reconnectStartedAtMs);
	if (elapsedMs >= input.policy.totalBudgetMs) return {
		kind: "exhausted",
		reason: "time_budget"
	};
	const exponentialDelayMs = Math.min(input.policy.maxDelayMs, input.policy.baseDelayMs * 2 ** (input.nextAttempt - 1));
	const boundedRandom = Number.isFinite(input.randomValue) ? Math.min(1, Math.max(0, input.randomValue)) : .5;
	const jitterFactor = 1 - input.policy.jitterRatio + boundedRandom * input.policy.jitterRatio * 2;
	const delayMs = Math.max(0, Math.round(exponentialDelayMs * jitterFactor));
	if (elapsedMs + delayMs > input.policy.totalBudgetMs) return {
		kind: "exhausted",
		reason: "time_budget"
	};
	return {
		kind: "retry",
		attempt: input.nextAttempt,
		delayMs
	};
}
function assertReconnectPolicy(policy) {
	if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 0) throw new Error("maxAttempts must be a non-negative integer");
	if (!Number.isFinite(policy.totalBudgetMs) || policy.totalBudgetMs < 0) throw new Error("totalBudgetMs must be non-negative");
	if (!Number.isFinite(policy.baseDelayMs) || policy.baseDelayMs < 0 || !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) throw new Error("reconnect delays are invalid");
	if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) throw new Error("jitterRatio must be between 0 and 1");
}
//#endregion
//#region src/main/interview-session/interview-session-state.ts
function createInterviewSessionState(clientSessionId) {
	assertNonEmpty(clientSessionId, "clientSessionId");
	return {
		clientSessionId,
		interviewId: null,
		status: "connecting",
		localGeneration: 1,
		connectionId: null,
		connection: null
	};
}
function resolveInterviewCreate(state, input) {
	assertNonEmpty(input.interviewId, "interviewId");
	if (state.clientSessionId !== input.clientSessionId) return {
		state,
		shouldContinueStart: false,
		shouldEndRemotely: false
	};
	const nextState = state.interviewId === input.interviewId ? state : {
		...state,
		interviewId: input.interviewId
	};
	return {
		state: nextState,
		shouldContinueStart: nextState.status === "connecting" || nextState.status === "reconnecting",
		shouldEndRemotely: nextState.status === "ending" || nextState.status === "ended"
	};
}
function beginInterviewConnectionAttempt(state, connectionId) {
	assertNonEmpty(connectionId, "connectionId");
	if (state.status === "ending" || state.status === "ended" || state.status === "failed") return {
		state,
		decision: "terminal"
	};
	const canUseReservedGeneration = state.connectionId === null && (state.status === "connecting" || state.status === "reconnecting");
	return {
		state: {
			...state,
			status: state.status === "connecting" ? "connecting" : "reconnecting",
			localGeneration: canUseReservedGeneration ? state.localGeneration : state.localGeneration + 1,
			connectionId,
			connection: null
		},
		decision: "accepted"
	};
}
function bindInterviewConnection(state, token, connection) {
	if (!isCurrentInterviewContinuation(state, token)) return {
		state,
		decision: "stale"
	};
	if (state.interviewId !== connection.interviewId || state.clientSessionId !== connection.clientSessionId || token.connectionId !== connection.connectionId) return {
		state,
		decision: "stale"
	};
	if (state.connection) return connectionsEqual(state.connection, connection) ? {
		state,
		decision: "idempotent"
	} : {
		state,
		decision: "stale"
	};
	return {
		state: {
			...state,
			connection
		},
		decision: "accepted"
	};
}
function markInterviewConnectionReady(state, token) {
	if (!isCurrentInterviewContinuation(state, token)) return {
		state,
		decision: "stale"
	};
	if (state.status === "active") return {
		state,
		decision: "idempotent"
	};
	if (state.status !== "connecting" && state.status !== "reconnecting" || !state.connection) return {
		state,
		decision: "terminal"
	};
	return {
		state: {
			...state,
			status: "active"
		},
		decision: "accepted"
	};
}
function invalidateInterviewConnection(state, token) {
	if (!isCurrentInterviewContinuation(state, token)) return {
		state,
		decision: "stale"
	};
	return {
		state: {
			...state,
			status: "reconnecting",
			localGeneration: state.localGeneration + 1,
			connectionId: null,
			connection: null
		},
		decision: "accepted"
	};
}
function beginInterviewSessionEnd(state, input) {
	if (state.clientSessionId !== input.clientSessionId) return {
		state,
		decision: "stale"
	};
	if (state.status === "ending" || state.status === "ended") return {
		state,
		decision: "idempotent"
	};
	if (state.localGeneration !== input.localGeneration || input.connectionId !== void 0 && state.connectionId !== input.connectionId) return {
		state,
		decision: "stale"
	};
	return {
		state: {
			...state,
			status: "ending",
			localGeneration: state.localGeneration + 1,
			connectionId: null,
			connection: null,
			endedReason: input.reason
		},
		decision: "accepted"
	};
}
function completeInterviewSessionEnd(state) {
	if (state.status === "ended") return {
		state,
		decision: "idempotent"
	};
	if (state.status !== "ending") return {
		state,
		decision: "stale"
	};
	return {
		state: {
			...state,
			status: "ended",
			connectionId: null,
			connection: null
		},
		decision: "accepted"
	};
}
function failInterviewSession(state, reason) {
	if (state.status === "ending" || state.status === "ended") return {
		state,
		decision: "terminal"
	};
	if (state.status === "failed") return {
		state,
		decision: "idempotent"
	};
	return {
		state: {
			...state,
			status: "failed",
			localGeneration: state.localGeneration + 1,
			connectionId: null,
			connection: null,
			endedReason: reason
		},
		decision: "accepted"
	};
}
/** Mark a failed canonical end attempt without reopening an established terminal barrier. */
function failInterviewSessionCleanup(state, reason) {
	if (state.status === "ended") return {
		state,
		decision: "terminal"
	};
	if (state.status === "failed") return {
		state,
		decision: "idempotent"
	};
	if (state.status !== "ending") return {
		state,
		decision: "stale"
	};
	return {
		state: {
			...state,
			status: "failed",
			connectionId: null,
			connection: null,
			endedReason: reason
		},
		decision: "accepted"
	};
}
function isCurrentInterviewContinuation(state, token) {
	return state.clientSessionId === token.clientSessionId && state.localGeneration === token.localGeneration && state.connectionId === token.connectionId && state.status !== "ending" && state.status !== "ended" && state.status !== "failed";
}
function toInterviewSessionSnapshot(state) {
	return {
		clientSessionId: state.clientSessionId,
		interviewId: state.interviewId,
		status: state.status,
		localGeneration: state.localGeneration,
		...state.connection ? { connection: state.connection } : {},
		...state.endedReason ? { endedReason: state.endedReason } : {}
	};
}
function connectionsEqual(left, right) {
	return left.interviewId === right.interviewId && left.clientSessionId === right.clientSessionId && left.connectionId === right.connectionId && left.leaseGeneration === right.leaseGeneration;
}
function assertNonEmpty(value, field) {
	if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
}
//#endregion
//#region src/main/interview-session/interview-session-transport.ts
var InterviewSessionTransportError = class extends Error {
	kind;
	endedReason;
	code;
	constructor(input) {
		super(input.message, input.cause === void 0 ? void 0 : { cause: input.cause });
		this.name = "InterviewSessionTransportError";
		this.kind = input.kind;
		this.endedReason = input.endedReason ?? "desktop_ws_failed";
		this.code = input.code;
	}
};
function classifyInterviewSessionTransportError(error) {
	if (error instanceof InterviewSessionTransportError) return error;
	if (isAbortError$1(error)) return new InterviewSessionTransportError({
		kind: "aborted",
		message: error instanceof Error ? error.message : "Interview session operation aborted",
		cause: error
	});
	return new InterviewSessionTransportError({
		kind: "retryable",
		message: error instanceof Error ? error.message : String(error),
		cause: error
	});
}
/** Close a physical socket unless its open completed and ownership can transfer to the actor. */
async function establishInterviewRealtimeConnection(connection, signal) {
	try {
		await connection.waitUntilOpen(signal);
		return connection;
	} catch (error) {
		connection.close("Interview WebSocket failed before open");
		throw error;
	}
}
function classifyInterviewHttpStatus(status) {
	return status === 408 || status === 425 || status === 429 || status >= 500 ? "retryable" : "terminal";
}
function classifyInterviewConnectionClose(event, terminalReason) {
	if (terminalReason) return {
		code: event.code,
		reason: event.reason || null,
		wasClean: event.wasClean,
		kind: "remote_terminal",
		endedReason: terminalReason
	};
	if (event.code === 1002) return {
		code: event.code,
		reason: event.reason || null,
		wasClean: event.wasClean,
		kind: "protocol_error"
	};
	const normalizedReason = event.reason.toLowerCase();
	if (event.code === 4001 || normalizedReason.includes("ownership") || normalizedReason.includes("identity mismatch") || normalizedReason.includes("reservation could not be attached")) return {
		code: event.code,
		reason: event.reason || null,
		wasClean: event.wasClean,
		kind: "ownership_lost",
		endedReason: "ownership_lost"
	};
	if (event.code === 1008 || normalizedReason.includes("auth") || normalizedReason.includes("ticket")) return {
		code: event.code,
		reason: event.reason || null,
		wasClean: event.wasClean,
		kind: "authentication_failed"
	};
	return {
		code: event.code,
		reason: event.reason || null,
		wasClean: event.wasClean,
		kind: "retryable"
	};
}
function isInterviewSessionProtocolError(error) {
	return error instanceof InterviewSessionTransportError && error.code === "protocol_error";
}
function isAbortError$1(error) {
	return error instanceof Error && error.name === "AbortError";
}
//#endregion
//#region src/main/interview-session/interview-session-actor.ts
var InterviewSessionActor = class {
	startInput;
	transport;
	emitEvent;
	idFactory;
	clock;
	scheduler;
	heartbeatScheduler;
	random;
	reconnectPolicy;
	state;
	createController = null;
	reconnectController = null;
	endController = null;
	currentAttempt = null;
	lastKnownConnection = null;
	lastKnownActivitySequence;
	startPromise = null;
	connectPromise = null;
	endPromise = null;
	endRequestId = null;
	hasReachedActive = false;
	bootstrapProtocolFailure = null;
	constructor(options) {
		this.startInput = options.startInput;
		this.transport = options.transport;
		this.emitEvent = options.emitEvent ?? noopEventSink;
		this.idFactory = options.idFactory ?? randomUUID;
		this.clock = options.clock ?? systemInterviewSessionClock;
		this.scheduler = options.scheduler ?? systemInterviewSessionScheduler;
		this.heartbeatScheduler = options.heartbeatScheduler ?? systemInterviewSessionScheduler;
		this.random = options.random ?? Math.random;
		this.reconnectPolicy = options.reconnectPolicy ?? DEFAULT_INTERVIEW_RECONNECT_POLICY;
		this.state = createInterviewSessionState(this.idFactory());
		this.emitSnapshot();
	}
	getSnapshot() {
		return toInterviewSessionSnapshot(this.state);
	}
	start() {
		if (this.startPromise) return this.startPromise;
		if (this.state.status === "active" || this.state.status === "ended" || this.state.status === "failed") return Promise.resolve(this.getSnapshot());
		const operation = this.startInternal();
		this.startPromise = operation;
		operation.then(noopResolvedOperation, () => {
			if (this.startPromise === operation && !this.isTerminalBarrierEstablished()) this.startPromise = null;
		});
		return operation;
	}
	end(input) {
		const expectedConnection = this.currentEndEvidence();
		const transition = beginInterviewSessionEnd(this.state, {
			...input.expected,
			reason: input.reason
		});
		if (transition.decision === "stale" || transition.decision === "terminal") return Promise.resolve(this.getSnapshot());
		if (transition.decision === "idempotent") {
			if (this.endPromise || this.state.status === "ended") return this.endPromise ?? Promise.resolve(this.getSnapshot());
			return this.startEndOperation(this.state.endedReason ?? input.reason, expectedConnection);
		}
		this.setState(transition.state);
		this.createController?.abort(createAbortError$1("Interview session ended during create"));
		this.reconnectController?.abort(createAbortError$1("Interview session ended during reconnect"));
		this.cleanupAttempt(this.currentAttempt, "interview session ending");
		return this.startEndOperation(input.reason, expectedConnection);
	}
	send(input) {
		const attempt = this.currentAttempt;
		if (!attempt || !this.matchesExpectedIdentity(input.expected) || !this.isAttemptCurrent(attempt) || this.state.status !== "active" || !attempt.identity || !attempt.connection) return false;
		const frame = stampClientCommand(input.command, attempt.identity);
		return attempt.connection.send(frame);
	}
	shutdown(reason = "desktop_ws_failed") {
		return this.endFromCurrent(reason);
	}
	async startInternal() {
		this.createController = new AbortController();
		try {
			const response = await this.createCanonicalSession(this.createController.signal);
			if (!this.resolveCreateResponse(response).shouldContinueStart) return await this.awaitEndIfPresent();
			await this.ensureConnected();
			if (this.bootstrapProtocolFailure) {
				await this.awaitEndIfPresent().catch(noopRejectedOperation);
				throw this.bootstrapProtocolFailure;
			}
			return this.getSnapshot();
		} catch (error) {
			if (this.bootstrapProtocolFailure) {
				await this.awaitEndIfPresent().catch(noopRejectedOperation);
				throw this.bootstrapProtocolFailure;
			}
			if (this.isTerminalBarrierEstablished()) return await this.awaitEndIfPresent();
			const transportError = classifyInterviewSessionTransportError(error);
			if (transportError.kind === "terminal") this.transitionToFailed(transportError.endedReason);
			throw transportError;
		} finally {
			this.createController = null;
		}
	}
	async createCanonicalSession(signal) {
		const request = this.startInput;
		return await this.transport.createSession({
			clientSessionId: this.state.clientSessionId,
			request,
			signal
		});
	}
	resolveCreateResponse(response) {
		if (response.clientSessionId !== this.state.clientSessionId) throw new InterviewSessionTransportError({
			kind: "terminal",
			message: "Interview create response identity does not match the actor",
			endedReason: "ownership_lost"
		});
		const resolution = resolveInterviewCreate(this.state, {
			clientSessionId: response.clientSessionId,
			interviewId: response.interview.id
		});
		this.setState(resolution.state);
		return {
			shouldContinueStart: resolution.shouldContinueStart,
			shouldEndRemotely: resolution.shouldEndRemotely
		};
	}
	ensureConnected() {
		if (this.connectPromise) return this.connectPromise;
		if (this.state.status === "active") return Promise.resolve();
		this.reconnectController = new AbortController();
		const operation = this.connectWithBudget(this.reconnectController);
		this.connectPromise = operation;
		operation.then(() => this.clearConnectOperation(operation), () => this.clearConnectOperation(operation));
		return operation;
	}
	async connectWithBudget(controller) {
		const reconnectStartedAtMs = this.clock.now();
		let nextReconnectAttempt = 1;
		while (!controller.signal.aborted && !this.isTerminalBarrierEstablished()) try {
			await this.runConnectionAttempt();
			return;
		} catch (error) {
			if (controller.signal.aborted || this.isTerminalBarrierEstablished()) return;
			const transportError = classifyInterviewSessionTransportError(error);
			if (transportError.kind === "terminal") {
				if (isInterviewSessionProtocolError(transportError)) {
					if (this.hasReachedActive) {
						await this.endFromCurrent("desktop_ws_failed");
						return;
					}
					await this.endBootstrapAfterProtocolFailure(transportError);
				}
				this.transitionToFailed(transportError.endedReason);
				throw transportError;
			}
			const decision = decideInterviewReconnect({
				policy: this.reconnectPolicy,
				reconnectStartedAtMs,
				nowMs: this.clock.now(),
				nextAttempt: nextReconnectAttempt,
				randomValue: this.random()
			});
			if (decision.kind === "exhausted") {
				await this.endFromCurrent("desktop_ws_failed");
				return;
			}
			nextReconnectAttempt += 1;
			await this.clock.sleep(decision.delayMs, controller.signal);
			if (controller.signal.aborted || this.isTerminalBarrierEstablished()) return;
		}
	}
	async runConnectionAttempt() {
		const interviewId = this.state.interviewId;
		if (!interviewId) throw new InterviewSessionTransportError({
			kind: "terminal",
			message: "Cannot connect before the canonical Interview is known",
			endedReason: "ownership_lost"
		});
		const connectionId = this.idFactory();
		const begin = beginInterviewConnectionAttempt(this.state, connectionId);
		if (begin.decision !== "accepted") throw createAbortError$1("Interview connection attempt is no longer current");
		this.setState(begin.state);
		const attempt = {
			token: {
				clientSessionId: this.state.clientSessionId,
				localGeneration: this.state.localGeneration,
				connectionId
			},
			controller: new AbortController(),
			identity: null,
			connection: null,
			audio: null,
			heartbeatTimer: null,
			heartbeatSequence: 0,
			heartbeatOutstanding: null,
			activityTimer: null,
			activitySequence: 0,
			activityLastSentSequence: void 0,
			activityLastAckedSequence: void 0,
			closed: false
		};
		this.currentAttempt = attempt;
		try {
			const ticket = await this.transport.requestTicket({
				interviewId,
				request: {
					clientSessionId: this.state.clientSessionId,
					connectionId
				},
				signal: attempt.controller.signal
			});
			this.assertAttemptCurrent(attempt);
			this.assertTicketIdentity(ticket, interviewId, attempt);
			const identity = toPhysicalConnectionIdentity(ticket.reservation);
			attempt.identity = identity;
			this.lastKnownConnection = identity;
			this.lastKnownActivitySequence = void 0;
			const bound = bindInterviewConnection(this.state, attempt.token, identity);
			if (bound.decision !== "accepted" && bound.decision !== "idempotent") throw createAbortError$1("Interview ticket resolved for a stale connection attempt");
			this.setState(bound.state);
			const connection = await this.transport.openConnection({
				interviewId,
				ticket,
				signal: attempt.controller.signal,
				handlers: {
					onFrame: (frame) => this.handleServerFrame(attempt, frame),
					onClose: (event) => this.handleConnectionClose(attempt, event),
					onError: (error) => this.handleConnectionError(attempt, error)
				}
			});
			if (!this.isAttemptCurrent(attempt)) {
				connection.close("stale connection attempt");
				throw createAbortError$1("Interview socket opened after its attempt was invalidated");
			}
			attempt.connection = connection;
			const readyFrame = await connection.waitUntilReady(attempt.controller.signal);
			this.assertAttemptCurrent(attempt);
			this.assertServerFrameIdentity(readyFrame, attempt);
			this.startHeartbeat(attempt, readyFrame.payload.heartbeatIntervalMs);
			this.startClientActivity(attempt, readyFrame.payload.activityIntervalMs);
			this.assertAttemptCurrent(attempt);
			const audio = await this.transport.startAudio({
				connection,
				identity,
				signal: attempt.controller.signal,
				onFailure: (error) => this.handleAudioFailure(attempt, error)
			});
			if (!this.isAttemptCurrent(attempt)) {
				audio.stop();
				throw createAbortError$1("Interview audio became ready after its attempt was invalidated");
			}
			attempt.audio = audio;
			const ready = markInterviewConnectionReady(this.state, attempt.token);
			if (ready.decision !== "accepted" && ready.decision !== "idempotent") throw createAbortError$1("Interview connection became ready after its attempt was invalidated");
			this.hasReachedActive = true;
			this.setState(ready.state);
			this.emitServerFrame(attempt, readyFrame);
			this.assertAttemptCurrent(attempt);
		} catch (error) {
			const wasCurrent = this.isAttemptCurrent(attempt);
			this.cleanupAttempt(attempt, "connection attempt failed");
			if (wasCurrent) {
				const invalidated = invalidateInterviewConnection(this.state, attempt.token);
				if (invalidated.decision === "accepted") this.setState(invalidated.state);
			}
			throw error;
		}
	}
	async endInternal(reason, expectedConnection, signal) {
		let interviewId = this.state.interviewId;
		if (!interviewId) {
			const response = await this.createCanonicalSession(signal);
			this.resolveCreateResponse(response);
			interviewId = this.state.interviewId;
		}
		if (!interviewId || !this.endRequestId) throw new InterviewSessionTransportError({
			kind: "terminal",
			message: "Cannot end Interview without canonical identity",
			endedReason: "ownership_lost"
		});
		const result = await this.transport.endSession({
			interviewId,
			request: {
				clientSessionId: this.state.clientSessionId,
				endRequestId: this.endRequestId,
				reason,
				...expectedConnection ? { expectedConnection: {
					connectionId: expectedConnection.identity.connectionId,
					leaseGeneration: expectedConnection.identity.leaseGeneration,
					...expectedConnection.lastActivitySequence === void 0 ? {} : { lastActivitySequence: expectedConnection.lastActivitySequence }
				} } : {}
			},
			signal
		});
		if (result.session.interviewId !== interviewId || result.session.clientSessionId !== this.state.clientSessionId || result.endRequestId !== this.endRequestId) throw new InterviewSessionTransportError({
			kind: "terminal",
			message: "Interview end response identity does not match the actor",
			endedReason: "ownership_lost"
		});
		const completed = completeInterviewSessionEnd(this.state);
		if (completed.decision === "accepted" || completed.decision === "idempotent") {
			this.setState(completed.state);
			this.safeEmit({
				type: "ended",
				clientSessionId: this.state.clientSessionId,
				localGeneration: this.state.localGeneration,
				reason: this.state.endedReason ?? reason
			});
		}
		return this.getSnapshot();
	}
	startEndOperation(reason, expectedConnection) {
		this.endRequestId ??= this.idFactory();
		this.endController?.abort(createAbortError$1("Interview end operation superseded by retry"));
		this.endController = new AbortController();
		const operation = this.endInternal(reason, expectedConnection, this.endController.signal);
		this.endPromise = operation;
		operation.catch(() => {
			if (this.endPromise === operation) this.endPromise = null;
		});
		return operation;
	}
	endFromCurrent(reason) {
		return this.end({
			expected: this.currentExpectedIdentity(),
			reason
		});
	}
	handleServerFrame(attempt, frame) {
		if (!this.isAttemptCurrent(attempt) || !attempt.identity || !physicalIdentitiesEqual(attempt.identity, frame.identity)) return;
		if (frame.type === "connection_ready") return;
		if (frame.type === "heartbeat_ack") {
			const outstanding = attempt.heartbeatOutstanding;
			if (outstanding && frame.payload.sequence === outstanding.sequence) attempt.heartbeatOutstanding = null;
		}
		if (frame.type === "client_activity_ack") {
			const lastSentSequence = attempt.activityLastSentSequence;
			if (lastSentSequence !== void 0 && frame.payload.sequence <= lastSentSequence && (attempt.activityLastAckedSequence === void 0 || frame.payload.sequence > attempt.activityLastAckedSequence)) {
				attempt.activityLastAckedSequence = frame.payload.sequence;
				if (this.lastKnownConnection && physicalIdentitiesEqual(this.lastKnownConnection, attempt.identity)) this.lastKnownActivitySequence = frame.payload.sequence;
			}
		}
		this.emitServerFrame(attempt, frame);
		if (frame.type === "session_terminal") {
			this.endFromCurrent(frame.payload.reason).catch(noopRejectedOperation);
			return;
		}
		if (frame.type === "quota_exhausted") {
			this.endFromCurrent("quota_exhausted").catch(noopRejectedOperation);
			return;
		}
		if (frame.type === "runtime_error" && !frame.payload.retryable) {
			this.endFromCurrent("provider_failed").catch(noopRejectedOperation);
			return;
		}
		// ASR is an optional input channel. Permanent recognition failures degrade
		// to manual/screenshot questions and must never terminate the interview.
	}
	handleConnectionClose(attempt, event) {
		if (event.kind === "remote_terminal") {
			if (this.isAttemptCurrent(attempt)) this.endFromCurrent(event.endedReason ?? "unknown").catch(noopRejectedOperation);
			return;
		}
		if (event.kind === "ownership_lost" || event.kind === "authentication_failed") {
			if (this.isAttemptCurrent(attempt)) this.transitionToFailed(event.kind === "ownership_lost" ? "ownership_lost" : "unknown");
			return;
		}
		if (event.kind === "protocol_error") {
			if (this.isAttemptCurrent(attempt)) this.handleProtocolFailure(attempt, new InterviewSessionTransportError({
				kind: "terminal",
				code: "protocol_error",
				message: `Interview WebSocket protocol close: ${event.code ?? "unknown"}`
			}));
			return;
		}
		this.handleConnectionLoss(attempt, "socket closed");
	}
	handleConnectionError(attempt, error) {
		const transportError = classifyInterviewSessionTransportError(error);
		if (transportError.kind === "terminal") {
			if (this.isAttemptCurrent(attempt)) if (isInterviewSessionProtocolError(transportError)) this.handleProtocolFailure(attempt, transportError);
			else this.transitionToFailed(transportError.endedReason);
			return;
		}
		this.handleConnectionLoss(attempt, "socket error");
	}
	handleAudioFailure(attempt, _error) {
		if (this.isAttemptCurrent(attempt)) this.endFromCurrent("sidecar_failed").catch(noopRejectedOperation);
	}
	handleProtocolFailure(attempt, error) {
		if (!this.isAttemptCurrent(attempt)) return;
		if (this.hasReachedActive) {
			this.endFromCurrent("desktop_ws_failed").catch(noopRejectedOperation);
			return;
		}
		this.endBootstrapAfterProtocolFailure(error).catch(noopRejectedOperation);
	}
	async endBootstrapAfterProtocolFailure(error) {
		this.bootstrapProtocolFailure ??= error;
		try {
			await this.endFromCurrent("api_bootstrap_failed");
		} catch (cleanupError) {
			console.error("Failed to end Interview after a bootstrap protocol error", {
				clientSessionId: this.state.clientSessionId,
				interviewId: this.state.interviewId,
				protocolError: error,
				cleanupError
			});
			const failed = failInterviewSessionCleanup(this.state, "api_bootstrap_failed");
			if (failed.decision === "accepted") this.setState(failed.state);
		}
		throw this.bootstrapProtocolFailure;
	}
	handleConnectionLoss(attempt, reason) {
		if (!this.isAttemptCurrent(attempt)) return;
		const wasActive = this.state.status === "active";
		this.cleanupAttempt(attempt, reason);
		const invalidated = invalidateInterviewConnection(this.state, attempt.token);
		if (invalidated.decision === "accepted") this.setState(invalidated.state);
		if (wasActive) this.scheduleReconnectAfterLoss();
	}
	assertAttemptCurrent(attempt) {
		if (!this.isAttemptCurrent(attempt)) throw createAbortError$1("Interview connection continuation is stale");
	}
	isAttemptCurrent(attempt) {
		return !attempt.closed && !attempt.controller.signal.aborted && this.currentAttempt === attempt && isCurrentInterviewContinuation(this.state, attempt.token);
	}
	assertTicketIdentity(ticket, interviewId, attempt) {
		if (ticket.reservation.interviewId !== interviewId || ticket.reservation.clientSessionId !== this.state.clientSessionId || ticket.reservation.connectionId !== attempt.token.connectionId) throw new InterviewSessionTransportError({
			kind: "terminal",
			message: "Interview ticket identity does not match the connection attempt",
			endedReason: "ownership_lost"
		});
	}
	assertServerFrameIdentity(frame, attempt) {
		if (!attempt.identity || !physicalIdentitiesEqual(frame.identity, attempt.identity)) throw new InterviewSessionTransportError({
			kind: "terminal",
			message: "Interview ready frame identity does not match the connection attempt",
			endedReason: "ownership_lost"
		});
	}
	cleanupAttempt(attempt, reason) {
		if (!attempt || attempt.closed) return;
		attempt.closed = true;
		if (attempt.heartbeatTimer) {
			attempt.heartbeatTimer.cancel();
			attempt.heartbeatTimer = null;
		}
		attempt.heartbeatOutstanding = null;
		attempt.activityTimer?.cancel();
		attempt.activityTimer = null;
		attempt.controller.abort(createAbortError$1(reason));
		if (this.currentAttempt === attempt) this.currentAttempt = null;
		attempt.audio?.stop();
		attempt.audio = null;
		attempt.connection?.close(reason);
		attempt.connection = null;
	}
	startHeartbeat(attempt, intervalMs) {
		this.sendHeartbeat(attempt, intervalMs);
	}
	sendHeartbeat(attempt, intervalMs) {
		if (!this.isAttemptCurrent(attempt) || !attempt.identity || !attempt.connection) return;
		const outstanding = attempt.heartbeatOutstanding;
		if (outstanding && this.clock.now() - outstanding.sentAtMs >= intervalMs * 2) {
			this.handleConnectionLoss(attempt, "heartbeat acknowledgement timed out");
			return;
		}
		if (!outstanding) {
			const sequence = attempt.heartbeatSequence;
			attempt.heartbeatOutstanding = {
				sequence,
				sentAtMs: this.clock.now()
			};
			if (!attempt.connection.send(stampClientCommand({
				type: "heartbeat",
				payload: { sequence }
			}, attempt.identity))) {
				attempt.heartbeatOutstanding = null;
				this.handleConnectionLoss(attempt, "heartbeat send failed");
				return;
			}
			attempt.heartbeatSequence += 1;
		}
		attempt.heartbeatTimer = this.heartbeatScheduler.schedule(() => {
			attempt.heartbeatTimer = null;
			this.sendHeartbeat(attempt, intervalMs);
		}, intervalMs);
	}
	startClientActivity(attempt, intervalMs) {
		this.scheduleClientActivity(attempt, intervalMs);
	}
	scheduleClientActivity(attempt, intervalMs) {
		if (!this.isAttemptCurrent(attempt) || !attempt.identity || !attempt.connection || attempt.activityTimer) return;
		attempt.activityTimer = this.scheduler.schedule(() => {
			attempt.activityTimer = null;
			this.sendClientActivity(attempt, intervalMs);
		}, intervalMs);
	}
	sendClientActivity(attempt, intervalMs) {
		if (!this.isAttemptCurrent(attempt) || !attempt.identity || !attempt.connection) return;
		const sequence = attempt.activitySequence;
		if (!attempt.connection.send(stampClientCommand({
			type: "client_activity",
			payload: { sequence }
		}, attempt.identity))) {
			this.handleConnectionLoss(attempt, "client activity send failed");
			return;
		}
		attempt.activitySequence += 1;
		attempt.activityLastSentSequence = sequence;
		this.scheduleClientActivity(attempt, intervalMs);
	}
	transitionToFailed(reason) {
		this.cleanupAttempt(this.currentAttempt, "interview session failed");
		const failed = failInterviewSession(this.state, reason);
		if (failed.decision === "accepted") this.setState(failed.state);
	}
	matchesExpectedIdentity(expected) {
		return expected.clientSessionId === this.state.clientSessionId && expected.localGeneration === this.state.localGeneration && (expected.connectionId === void 0 || expected.connectionId === this.state.connectionId);
	}
	currentExpectedIdentity() {
		return {
			clientSessionId: this.state.clientSessionId,
			localGeneration: this.state.localGeneration,
			...this.state.connectionId ? { connectionId: this.state.connectionId } : {}
		};
	}
	currentEndEvidence() {
		const attempt = this.currentAttempt;
		if (attempt?.identity) return {
			identity: attempt.identity,
			...attempt.activityLastAckedSequence === void 0 ? {} : { lastActivitySequence: attempt.activityLastAckedSequence }
		};
		if (!this.lastKnownConnection) return null;
		return {
			identity: this.lastKnownConnection,
			...this.lastKnownActivitySequence === void 0 ? {} : { lastActivitySequence: this.lastKnownActivitySequence }
		};
	}
	isTerminalBarrierEstablished() {
		return this.state.status === "ending" || this.state.status === "ended" || this.state.status === "failed";
	}
	async awaitEndIfPresent() {
		if (this.endPromise) return await this.endPromise;
		return this.getSnapshot();
	}
	clearConnectOperation(operation) {
		if (this.connectPromise === operation) {
			this.connectPromise = null;
			this.reconnectController = null;
		}
	}
	scheduleReconnectAfterLoss() {
		const existingOperation = this.connectPromise;
		if (existingOperation) {
			existingOperation.then(() => this.reconnectIfStillNeeded(), () => this.reconnectIfStillNeeded());
			return;
		}
		this.reconnectIfStillNeeded();
	}
	reconnectIfStillNeeded() {
		if (this.state.status !== "reconnecting" || this.isTerminalBarrierEstablished()) return;
		this.ensureConnected().catch((error) => {
			if (!this.isTerminalBarrierEstablished()) {
				const transportError = classifyInterviewSessionTransportError(error);
				this.transitionToFailed(transportError.endedReason);
			}
		});
	}
	setState(state) {
		if (state === this.state) return;
		this.state = state;
		this.emitSnapshot();
	}
	emitSnapshot() {
		this.safeEmit({
			type: "snapshot",
			snapshot: this.getSnapshot()
		});
	}
	emitServerFrame(attempt, frame) {
		this.safeEmit({
			type: "server_frame",
			clientSessionId: this.state.clientSessionId,
			localGeneration: attempt.token.localGeneration,
			frame
		});
	}
	safeEmit(event) {
		try {
			this.emitEvent(event);
		} catch {}
	}
};
var systemInterviewSessionClock = {
	now: Date.now,
	sleep: sleepWithAbort
};
var systemInterviewSessionScheduler = { schedule(callback, delayMs) {
	const timer = setTimeout(callback, delayMs);
	timer.unref?.();
	return { cancel: () => clearTimeout(timer) };
} };
function stampClientCommand(command, identity) {
	return {
		...command,
		identity
	};
}
function physicalIdentitiesEqual(left, right) {
	return left.interviewId === right.interviewId && left.clientSessionId === right.clientSessionId && left.connectionId === right.connectionId && left.leaseGeneration === right.leaseGeneration;
}
function toPhysicalConnectionIdentity(value) {
	return {
		interviewId: value.interviewId,
		clientSessionId: value.clientSessionId,
		connectionId: value.connectionId,
		leaseGeneration: value.leaseGeneration
	};
}
function sleepWithAbort(delayMs, signal) {
	if (signal.aborted) return Promise.reject(signal.reason ?? createAbortError$1("Interview reconnect sleep aborted"));
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(handleTimeout, delayMs);
		function cleanup() {
			clearTimeout(timeout);
			signal.removeEventListener("abort", handleAbort);
		}
		function handleTimeout() {
			cleanup();
			resolve();
		}
		function handleAbort() {
			cleanup();
			reject(signal.reason ?? createAbortError$1("Interview reconnect sleep aborted"));
		}
		signal.addEventListener("abort", handleAbort, { once: true });
	});
}
function createAbortError$1(message) {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}
function noopEventSink(_event) {}
function noopRejectedOperation(_error) {}
function noopResolvedOperation(_snapshot) {}
//#endregion
//#region ../../node_modules/.bun/@elysiajs+eden@1.4.9+0165d009a1be670a/node_modules/@elysiajs/eden/dist/chunk-I5KHAGLL.mjs
var d = class extends Error {
	constructor(e, s) {
		super(s + "");
		this.status = e;
		this.value = s;
	}
};
var i = /(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/;
var o = /(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT(?:\+|-)\d{4}\s\([^)]+\)/;
var u = /^(?:(?:(?:(?:0?[1-9]|[12][0-9]|3[01])[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:19|20)\d{2})|(?:(?:19|20)\d{2}[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:0?[1-9]|[12][0-9]|3[01]))))(?:\s(?:1[012]|0?[1-9]):[0-5][0-9](?::[0-5][0-9])?(?:\s[AP]M)?)?$/;
var c = (t) => t.trim().length !== 0 && !Number.isNaN(Number(t));
var a = (t, r) => {
	if (typeof t != "string" || r?.parseDate === !1) return null;
	let e = t.replace(/"/g, "");
	if (i.test(e) || o.test(e) || u.test(e)) {
		let s = new Date(e);
		if (!Number.isNaN(s.getTime())) return s;
	}
	return null;
};
var p = (t) => {
	let r = t.charCodeAt(0), e = t.charCodeAt(t.length - 1);
	return r === 123 && e === 125 || r === 91 && e === 93;
};
var f = (t, r) => JSON.parse(t, (e, s) => {
	return a(s, r) || s;
});
var g = (t, r) => {
	if (!t) return t;
	if (c(t)) return +t;
	if (t === "true") return !0;
	if (t === "false") return !1;
	if (r?.parseDate !== !1) {
		let e = a(t, r);
		if (e) return e;
	}
	if (p(t)) try {
		return f(t, r);
	} catch {}
	return t;
};
var S = (t, r) => {
	let e = t.data.toString();
	return e === "null" ? null : g(e, r);
};
//#endregion
//#region ../../node_modules/.bun/@elysiajs+eden@1.4.9+0165d009a1be670a/node_modules/@elysiajs/eden/dist/chunk-TTKI5TQ7.mjs
var C = class {
	constructor(t) {
		this.url = t;
		this.ws = new WebSocket(t);
	}
	ws;
	send(t) {
		return Array.isArray(t) ? (t.forEach((n) => this.send(n)), this) : (this.ws.send(typeof t == "object" ? JSON.stringify(t) : t.toString()), this);
	}
	on(t, n, r) {
		return this.addEventListener(t, n, r);
	}
	off(t, n, r) {
		return this.ws.removeEventListener(t, n, r), this;
	}
	subscribe(t, n) {
		return this.addEventListener("message", t, n);
	}
	addEventListener(t, n, r) {
		return this.ws.addEventListener(t, (o) => {
			if (t === "message") {
				let i = S(o);
				n({
					...o,
					data: i
				});
			} else n(o);
		}, r), this;
	}
	removeEventListener(t, n, r) {
		return this.off(t, n, r), this;
	}
	close() {
		return this.ws.close(), this;
	}
};
var X = [
	"get",
	"post",
	"put",
	"delete",
	"patch",
	"options",
	"head",
	"connect",
	"subscribe"
];
var P = (e, t) => typeof t == "function" ? t(e) : t === !0;
var _ = [
	"localhost",
	"127.0.0.1",
	"0.0.0.0"
];
var q = typeof FileList > "u";
var H = (e) => q ? e instanceof Blob : e instanceof FileList || e instanceof File;
var Y = (e) => {
	if (!e) return !1;
	for (let t in e) if (H(e[t]) || Array.isArray(e[t]) && e[t].find(H)) return !0;
	return !1;
};
var K = (e) => q ? e : new Promise((t) => {
	let n = new FileReader();
	n.onload = () => {
		t(new File([n.result], e.name, {
			lastModified: e.lastModified,
			type: e.type
		}));
	}, n.readAsArrayBuffer(e);
});
var A = async (e, t, n = {}, r = {}) => {
	if (Array.isArray(e)) {
		for (let o of e) if (!Array.isArray(o)) r = await A(o, t, n, r);
		else {
			let i = o[0];
			if (typeof i == "string") r[i.toLowerCase()] = o[1];
			else for (let [s, u] of i) r[s.toLowerCase()] = u;
		}
		return r;
	}
	if (!e) return r;
	switch (typeof e) {
		case "function":
			if (e instanceof Headers) return A(e, t, n, r);
			let o = await e(t, n);
			return o ? A(o, t, n, r) : r;
		case "object":
			if (e instanceof Headers) return e.forEach((i, s) => {
				r[s.toLowerCase()] = i;
			}), r;
			for (let [i, s] of Object.entries(e)) r[i.toLowerCase()] = s;
			return r;
		default: return r;
	}
};
function V(e, t) {
	let n = e.split(`
`), r = {};
	for (let o of n) {
		if (!o || o.startsWith(":")) continue;
		let i = o.indexOf(":");
		if (i > 0) {
			let s = o.slice(0, i).trim(), u = o.slice(i + 1).replace(/^ /, "");
			r[s] = u && g(u, t);
		}
	}
	return Object.keys(r).length > 0 ? r : null;
}
function* B(e, t) {
	let n;
	for (; (n = e.value.indexOf(`

`)) !== -1;) {
		let r = e.value.slice(0, n);
		if (e.value = e.value.slice(n + 2), r.trim()) {
			let o = V(r, t);
			o && (yield o);
		}
	}
}
async function* U(e, t) {
	let n = e.body;
	if (!n) return;
	let r = n.getReader(), o = new TextDecoder("utf-8");
	if (e.headers.get("Content-Type")?.startsWith("text/event-stream")) {
		let i = { value: "" };
		try {
			for (;;) {
				let { done: u, value: x } = await r.read();
				if (u) break;
				let m = typeof x == "string" ? x : o.decode(x, { stream: !0 });
				i.value += m, yield* B(i, t);
			}
			let s = o.decode();
			if (s && (i.value += s), yield* B(i, t), i.value.trim()) {
				let u = V(i.value, t);
				u && (yield u);
			}
		} finally {
			r.releaseLock();
		}
	} else try {
		for (;;) {
			let { done: i, value: s } = await r.read();
			if (i) break;
			yield g(typeof s == "string" ? s : o.decode(s, { stream: !0 }), { parseDate: t?.parseDate });
		}
	} finally {
		r.releaseLock();
	}
}
var L = (e, t, n = [], r) => new Proxy(() => {}, {
	get(o, i) {
		if (i === "~path") return "/" + n.join("/");
		if (!(n.length === 0 && (i === "then" || i === "catch" || i === "finally"))) return L(e, t, [...n, i], r);
	},
	apply(o, i, [s, u]) {
		if (!s || u || typeof s == "object" && Object.keys(s).length !== 1 || X.includes(n.at(-1))) {
			let x = [...n], m = x.pop(), b = "/" + x.join("/"), { fetcher: G = fetch, headers: R, onRequest: g$1, onResponse: D, fetch: $ } = t, E = m === "get" || m === "head" || m === "subscribe", M = E ? s?.query : u?.query, F = "";
			if (M) {
				let a = (k, d) => {
					d != null && (d instanceof Date && (d = d.toISOString()), F += (F ? "&" : "?") + `${encodeURIComponent(k)}=${encodeURIComponent(typeof d == "object" ? JSON.stringify(d) : d + "")}`);
				};
				for (let [k, d] of Object.entries(M)) {
					if (Array.isArray(d)) {
						for (let T of d) a(k, T);
						continue;
					}
					a(k, d);
				}
			}
			if (m === "subscribe") return new C(e.replace(/^([^]+):\/\//, e.startsWith("https://") ? "wss://" : e.startsWith("http://") || _.find((k) => e.includes(k)) ? "ws://" : "wss://") + b + F);
			return (async () => {
				R = await A(R, b, u);
				let a$1 = {
					method: m?.toUpperCase(),
					body: s,
					...$,
					headers: R
				};
				a$1.headers = {
					...R,
					...await A(E ? s?.headers : u?.headers, b, a$1)
				};
				let k = E && typeof s == "object" ? s.fetch : u?.fetch, T = (E && typeof s == "object" ? s.throwHttpError : u?.throwHttpError) ?? t.throwHttpError;
				if (a$1 = {
					...a$1,
					...k
				}, E && delete a$1.body, g$1) {
					Array.isArray(g$1) || (g$1 = [g$1]);
					for (let y of g$1) {
						let c = await y(b, a$1);
						typeof c == "object" && (a$1 = {
							...a$1,
							...c,
							headers: {
								...a$1.headers,
								...await A(c.headers, b, a$1)
							}
						});
					}
				}
				if (E && delete a$1.body, Y(s)) {
					let y = new FormData(), c = (f) => {
						if (typeof f == "string" || H(f)) return !1;
						if (typeof f == "object") {
							if (f !== null) return !0;
							if (f instanceof Date) return !1;
						}
						return !1;
					}, w = async (f) => f instanceof File ? await K(f) : c(f) ? JSON.stringify(f) : f;
					for (let [f, p] of Object.entries(a$1.body)) {
						if (Array.isArray(p)) {
							if (p.some((S) => typeof S == "object" && S !== null && !H(S))) y.append(f, JSON.stringify(p));
							else for (let S = 0; S < p.length; S++) {
								let z = p[S], Q = await w(z);
								y.append(f, Q);
							}
							continue;
						}
						if (q) {
							if (Array.isArray(p)) for (let O of p) y.append(f, await w(O));
							else y.append(f, await w(p));
							continue;
						}
						if (p instanceof File) {
							y.append(f, await K(p));
							continue;
						}
						if (p instanceof FileList) {
							for (let O = 0; O < p.length; O++) y.append(f, await K(p[O]));
							continue;
						}
						y.append(f, await w(p));
					}
					a$1.body = y;
				} else typeof s == "object" ? (a$1.headers["content-type"] = "application/json", a$1.body = JSON.stringify(s)) : s != null && (a$1.headers["content-type"] = "text/plain");
				if (E && delete a$1.body, g$1) {
					Array.isArray(g$1) || (g$1 = [g$1]);
					for (let y of g$1) {
						let c = await y(b, a$1);
						typeof c == "object" && (a$1 = {
							...a$1,
							...c,
							headers: {
								...a$1.headers,
								...await A(c.headers, b, a$1)
							}
						});
					}
				}
				u?.headers?.["content-type"] && (a$1.headers["content-type"] = u?.headers["content-type"]);
				let I = e + b + F, l;
				try {
					l = await (r?.handle(new Request(I, a$1)) ?? G(I, a$1));
				} catch (y) {
					let c = new d(503, y);
					if (P(c, T)) throw c;
					return {
						data: null,
						error: c,
						response: void 0,
						status: 503,
						headers: void 0
					};
				}
				let h = null, v = null;
				if (D) {
					Array.isArray(D) || (D = [D]);
					for (let y of D) try {
						let c = await y(l.clone());
						if (c != null) {
							h = c;
							break;
						}
					} catch (c) {
						c instanceof d ? v = c : v = new d(422, c);
						break;
					}
				}
				if (h !== null) return {
					data: h,
					error: v,
					response: l,
					status: l.status,
					headers: l.headers
				};
				switch (l.headers.get("Content-Type")?.split(";")[0]) {
					case "text/event-stream":
						h = U(l, { parseDate: t.parseDate });
						break;
					case "application/json":
						h = JSON.parse(await l.text(), (c, w) => {
							if (typeof w != "string") return w;
							return a(w, { parseDate: t.parseDate }) || w;
						});
						break;
					case "application/octet-stream":
						h = await l.arrayBuffer();
						break;
					case "multipart/form-data":
						let y = await l.formData();
						h = {}, y.forEach((c, w) => {
							h[w] = c;
						});
						break;
					default: l.headers.get("content-type")?.startsWith("text/") && l.headers.get("transfer-encoding") === "chunked" && !l.headers.has("content-length") ? h = U(l, { parseDate: t.parseDate }) : h = await l.text().then((c) => g(c, { parseDate: t.parseDate }));
				}
				if (l.status >= 300 || l.status < 200) {
					if (v = new d(l.status, h), P(v, T)) throw v;
					h = null;
				}
				return {
					data: h,
					error: v,
					response: l,
					status: l.status,
					headers: l.headers
				};
			})();
		}
		return typeof s == "object" ? L(e, t, [...n, Object.values(s)[0]], r) : L(e, t, n);
	}
});
var se = (e, t = {}) => typeof e == "string" ? (t.keepDomain || (e.includes("://") || (e = (_.find((n) => e.includes(n)) ? "http://" : "https://") + e), e.endsWith("/") && (e = e.slice(0, -1))), L(e, t)) : (typeof window < "u" && console.warn("Elysia instance server found on client side, this is not recommended for security reason. Use generic type instead."), L("http://e.ly", t, [], e));
//#endregion
//#region ../../packages/client/dist/client.mjs
/** Structured failure emitted when an Eden socket cannot decode a JSON server message. */
var EdenWebSocketDecodeError = class extends Error {
	code;
	constructor(code, message, cause) {
		super(message, cause === void 0 ? void 0 : { cause });
		this.name = "EdenWebSocketDecodeError";
		this.code = code;
	}
};
/** Open the canonical Interview route without exposing Eden's binary-unsafe high-level sender. */
function subscribeInterviewRealtime(client, input) {
	return client.realtime({ interviewId: input.interviewId }).subscribe({ query: { ticket: input.ticket } });
}
/**
* Send raw bytes through the native socket owned by an Eden WebSocket.
*
* Eden 1.4.9 JSON-stringifies typed arrays passed to its high-level `send`.
* Keep this as the only `.ws.send` escape hatch until a verified Eden upgrade
* supports binary frames without changing their bytes.
*/
function sendInterviewRealtimeAudio(socket, bytes) {
	socket.ws.send(Uint8Array.from(bytes).buffer);
}
/**
* Listen to raw JSON messages without Eden 1.4.9's unconditional ISO-to-Date
* conversion. The API response schema remains the runtime validator and `T`
* remains route-derived; this adapter only preserves the wire representation.
*/
function listenInterviewRealtimeJson(socket, handlers) {
	return listenEdenWebSocketJson(socket, handlers);
}
function listenEdenWebSocketJson(socket, handlers) {
	function handleMessage(event) {
		if (typeof event.data !== "string") {
			handlers.onInvalid(new EdenWebSocketDecodeError("non_text_frame", "Eden WebSocket returned a non-text JSON frame"));
			return;
		}
		let value;
		try {
			value = JSON.parse(event.data);
		} catch (error) {
			handlers.onInvalid(new EdenWebSocketDecodeError("invalid_json", "Eden WebSocket returned invalid JSON", error));
			return;
		}
		if (!isJsonObject(value)) {
			handlers.onInvalid(new EdenWebSocketDecodeError("invalid_payload", "Eden WebSocket returned a non-object JSON payload"));
			return;
		}
		if (value.type === "validation") {
			handlers.onInvalid(new EdenWebSocketDecodeError("response_validation", "Eden WebSocket returned a server frame rejected by Elysia response validation"));
			return;
		}
		handlers.onMessage(value);
	}
	socket.ws.addEventListener("message", handleMessage);
	return function removeEdenWebSocketJsonListener() {
		socket.ws.removeEventListener("message", handleMessage);
	};
}
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Create the type-safe Eden Treaty client for the Aether API.
*
* Use `getAccessToken` for long-lived clients so token rotation is observed at
* request time. WebSocket routes authenticate with their short-lived ticket;
* Eden does not forward these HTTP headers during a WebSocket upgrade.
*/
function createApiClient(options) {
	return se(options.baseUrl, {
		fetch: options.fetch,
		parseDate: false,
		headers: async function resolveRequestHeaders() {
			const headers = new Headers(options.headers);
			const accessToken = options.getAccessToken ? await options.getAccessToken() : options.accessToken;
			if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
			return headers;
		}
	});
}
//#endregion
//#region src/main/config.ts
/**
* Centralized runtime configuration for the main process.
* All values are resolved at build time by scripts/desktop-vite-config.ts.
*/
var config = {
	/** Current partition: "cn" or "global" */
	partition: "cn",
	/** Local HTTP API base URL. */
	apiBaseUrl: "http://127.0.0.1:43149",
	/** Cloud updates are intentionally disabled in the local-only edition. */
	cdnBaseUrl: null
};
//#endregion
//#region src/main/api.ts
var apiClient = createApiClient({
	baseUrl: config.apiBaseUrl,
	getAccessToken: readMainAccessToken
});
/** Return the single long-lived Treaty proxy used by Desktop Main. */
function getMainApiClient() {
	return apiClient;
}
/** Fail before a control-plane request when Desktop has no authenticated user. */
function requireMainAccessToken() {
	if (!readMainAccessToken()) throw new MissingMainAccessTokenError();
}
var MissingMainAccessTokenError = class extends Error {
	constructor() {
		super("Not authenticated. Please sign in first.");
		this.name = "MissingMainAccessTokenError";
	}
};
function readMainAccessToken() {
	return authStore.getTokens()?.access_token?.trim() || null;
}
//#endregion
//#region src/main/realtime/interview-buffered-amount.ts
var InterviewBufferedAmountTracker = class {
	segments = [];
	bufferedBytes = 0;
	audioBytes = 0;
	getAudioBytes() {
		return this.audioBytes;
	}
	observe(bufferedBytes) {
		this.reconcile(bufferedBytes);
	}
	recordAudio(bytes, bufferedBytes) {
		this.record("audio", bytes, bufferedBytes);
	}
	recordControl(bytes, bufferedBytes) {
		this.record("control", bytes, bufferedBytes);
	}
	record(kind, bytes, bufferedBytes) {
		if (bytes > 0) {
			const last = this.segments.at(-1);
			if (last?.kind === kind) last.bytes += bytes;
			else this.segments.push({
				bytes,
				kind
			});
			this.bufferedBytes += bytes;
			if (kind === "audio") this.audioBytes += bytes;
		}
		this.reconcile(bufferedBytes);
	}
	reconcile(bufferedBytes) {
		let drainedBytes = Math.max(0, this.bufferedBytes - bufferedBytes);
		while (drainedBytes > 0) {
			const segment = this.segments[0];
			if (!segment) break;
			const consumedBytes = Math.min(segment.bytes, drainedBytes);
			segment.bytes -= consumedBytes;
			drainedBytes -= consumedBytes;
			if (segment.kind === "audio") this.audioBytes -= consumedBytes;
			if (segment.bytes === 0) this.segments.shift();
		}
		if (bufferedBytes > this.bufferedBytes) this.segments.push({
			bytes: bufferedBytes - this.bufferedBytes,
			kind: "control"
		});
		this.bufferedBytes = bufferedBytes;
	}
};
//#endregion
//#region src/main/realtime/interview-session-transport.ts
var WEB_SOCKET_OPEN_STATE = 1;
var WEB_SOCKET_OPEN_TIMEOUT_MS = 1e4;
var WEB_SOCKET_READY_TIMEOUT_MS = 15e3;
var MAX_AUDIO_BUFFERED_AMOUNT_BYTES = REALTIME_WS_CHUNK_BYTES * (1e3 / 40);
var ElectronInterviewSessionTransport = class {
	async createSession(input) {
		return requestInterviewApi({
			request: async () => await getMainApiClient().api.interviews.post(input.request, {
				headers: { "idempotency-key": input.clientSessionId },
				fetch: { signal: input.signal }
			}),
			signal: input.signal,
			operation: "create Interview session",
			terminalReason: "api_bootstrap_failed"
		});
	}
	async requestTicket(input) {
		return requestInterviewApi({
			request: async () => await getMainApiClient().api.realtime({ interviewId: input.interviewId })["ws-ticket"].post(input.request, { fetch: { signal: input.signal } }),
			signal: input.signal,
			operation: "reserve Interview realtime connection",
			terminalReason: "ownership_lost"
		});
	}
	async openConnection(input) {
		return await establishInterviewRealtimeConnection(new ElectronInterviewRealtimeConnection(subscribeInterviewRealtime(getMainApiClient(), {
			interviewId: input.interviewId,
			ticket: input.ticket.ticket
		}), input.handlers, input.signal), input.signal);
	}
	async startAudio(input) {
		if (input.signal.aborted) throw createAbortError("Interview audio start aborted");
		let failureReported = false;
		function reportFailure(error) {
			if (failureReported || input.signal.aborted) return;
			failureReported = true;
			input.onFailure(error);
		}
		const audio = startSidecarAudioStream((chunk) => input.connection.sendAudio(chunk), noopAudioDiagnostic, reportFailure, (health) => {
			if (!health.recoverable) reportFailure(/* @__PURE__ */ new Error(`Audio sidecar health failure: ${health.code} ${health.message}`));
		}, audioDevicesStore.getSelection());
		try {
			await raceWithAbort(waitForAudioStreamReady(audio), input.signal);
		} catch (error) {
			stopAudioStreamInternal(audio);
			throw error;
		}
		if (input.signal.aborted) {
			stopAudioStreamInternal(audio);
			throw createAbortError("Interview audio start aborted");
		}
		return { stop: function stopInterviewAudio() {
			stopAudioStreamInternal(audio);
		} };
	}
	async endSession(input) {
		return requestInterviewApi({
			request: async () => await getMainApiClient().api.interviews({ id: input.interviewId }).end.post(input.request, { fetch: { signal: input.signal } }),
			signal: input.signal,
			operation: "end Interview session",
			terminalReason: "ownership_lost"
		});
	}
};
var ElectronInterviewRealtimeConnection = class {
	socket;
	handlers;
	openPromise;
	readyPromise;
	resolveOpen = null;
	rejectOpen = null;
	resolveReady = null;
	rejectReady = null;
	opened = false;
	readyReceived = false;
	closed = false;
	audioBackpressureClosing = false;
	bufferedAmountTracker = new InterviewBufferedAmountTracker();
	protocolReported = false;
	terminalReason = null;
	removeAbortListener;
	removeMessageListener;
	constructor(socket, handlers, signal) {
		this.socket = socket;
		this.handlers = handlers;
		this.openPromise = new Promise((resolve, reject) => {
			this.resolveOpen = resolve;
			this.rejectOpen = reject;
		});
		this.readyPromise = new Promise((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		this.readyPromise.catch(noopRejectedPromise);
		this.socket.ws.binaryType = "arraybuffer";
		this.socket.addEventListener("open", this.handleOpen);
		this.removeMessageListener = listenInterviewRealtimeJson(this.socket, {
			onMessage: this.handleMessage,
			onInvalid: this.handleInvalidMessage
		});
		this.socket.addEventListener("error", this.handleError);
		this.socket.addEventListener("close", this.handleClose);
		const handleAbort = () => this.close("Interview connection aborted");
		signal.addEventListener("abort", handleAbort, { once: true });
		this.removeAbortListener = () => signal.removeEventListener("abort", handleAbort);
		if (signal.aborted) handleAbort();
	}
	async waitUntilOpen(signal) {
		await raceWithAbortAndTimeout(this.openPromise, signal, WEB_SOCKET_OPEN_TIMEOUT_MS, "Timed out opening Interview WebSocket");
	}
	async waitUntilReady(signal) {
		return raceWithAbortAndTimeout(this.readyPromise, signal, WEB_SOCKET_READY_TIMEOUT_MS, "Timed out waiting for Interview WebSocket ready frame");
	}
	send(frame) {
		if (!this.isOpen()) return false;
		this.bufferedAmountTracker.observe(this.socket.ws.bufferedAmount);
		try {
			this.socket.send(frame);
			this.bufferedAmountTracker.recordControl(Buffer.byteLength(JSON.stringify(frame)), this.socket.ws.bufferedAmount);
			return true;
		} catch {
			this.bufferedAmountTracker.observe(this.socket.ws.bufferedAmount);
			return false;
		}
	}
	sendAudio(chunk) {
		if (!this.isOpen()) return false;
		const bufferedAmount = this.socket.ws.bufferedAmount;
		this.bufferedAmountTracker.observe(bufferedAmount);
		const queuedAudioBytes = this.bufferedAmountTracker.getAudioBytes();
		if (queuedAudioBytes >= MAX_AUDIO_BUFFERED_AMOUNT_BYTES) {
			if (!this.audioBackpressureClosing) {
				this.audioBackpressureClosing = true;
				console.warn("[interview_realtime_audio_backpressure]", {
					bufferedAmount,
					queuedAudioBytes,
					maxBufferedAmountBytes: MAX_AUDIO_BUFFERED_AMOUNT_BYTES,
					queuedAudioMs: Math.round(queuedAudioBytes / REALTIME_WS_CHUNK_BYTES * 40)
				});
				try {
					this.socket.ws.close(1011, "Interview audio backlog exceeded");
				} catch (error) {
					this.handlers.onError(error);
				}
			}
			return false;
		}
		try {
			sendInterviewRealtimeAudio(this.socket, chunk);
			this.bufferedAmountTracker.recordAudio(chunk.byteLength, this.socket.ws.bufferedAmount);
			return true;
		} catch {
			this.bufferedAmountTracker.observe(this.socket.ws.bufferedAmount);
			return false;
		}
	}
	close(reason) {
		if (this.closed) return;
		this.closed = true;
		this.removeAbortListener();
		this.removeMessageListener();
		const error = createAbortError(reason);
		this.rejectOpen?.(error);
		this.rejectReady?.(error);
		this.clearDeferredCallbacks();
		try {
			const closeCode = this.protocolReported ? 1002 : 1e3;
			const closeReason = this.protocolReported ? "Interview WebSocket protocol error" : reason;
			this.socket.ws.close(closeCode, truncateWebSocketCloseReason(closeReason));
		} catch {}
	}
	handleOpen = () => {
		if (this.closed) return;
		this.opened = true;
		this.resolveOpen?.();
		this.resolveOpen = null;
		this.rejectOpen = null;
	};
	handleMessage = (value) => {
		if (this.closed) return;
		if (!isInterviewRealtimeServerFrame(value)) {
			this.handleProtocolFailure(/* @__PURE__ */ new Error("Interview WebSocket returned a frame outside the canonical schema"));
			return;
		}
		const frame = value;
		if (frame.type === "connection_ready") {
			this.readyReceived = true;
			this.resolveReady?.(frame);
			this.resolveReady = null;
			this.rejectReady = null;
			return;
		}
		if (frame.type === "session_terminal") this.terminalReason = frame.payload.reason;
		this.handlers.onFrame(frame);
	};
	handleInvalidMessage = (error) => {
		if (!this.closed) this.handleProtocolFailure(error);
	};
	handleProtocolFailure(error) {
		if (this.protocolReported || this.closed) return;
		this.protocolReported = true;
		const transportError = new InterviewSessionTransportError({
			kind: "terminal",
			code: "protocol_error",
			message: error.message,
			cause: error
		});
		if (this.rejectBeforeReady(transportError)) {
			this.close("Interview WebSocket protocol error");
			return;
		}
		this.handlers.onError(transportError);
		this.close("Interview WebSocket protocol error");
	}
	handleError = () => {};
	handleClose = (event) => {
		const wasActorClosed = this.closed;
		const closeEvent = classifyInterviewConnectionClose(event, this.terminalReason);
		const wasWaitingForReady = !this.readyReceived;
		this.closed = true;
		this.removeAbortListener();
		this.removeMessageListener();
		const closeError = createConnectionCloseError(closeEvent);
		this.rejectOpen?.(closeError);
		this.rejectReady?.(closeError);
		this.clearDeferredCallbacks();
		if (!wasActorClosed && this.opened && !wasWaitingForReady) this.handlers.onClose(closeEvent);
	};
	isOpen() {
		return !this.closed && this.socket.ws.readyState === WEB_SOCKET_OPEN_STATE;
	}
	rejectBeforeReady(error) {
		if (this.readyReceived) return false;
		const rejectReady = this.rejectReady;
		this.resolveReady = null;
		this.rejectReady = null;
		rejectReady?.(error);
		return true;
	}
	clearDeferredCallbacks() {
		this.resolveOpen = null;
		this.rejectOpen = null;
		this.resolveReady = null;
		this.rejectReady = null;
	}
};
async function requestInterviewApi(input) {
	let response;
	try {
		requireMainAccessToken();
		response = await input.request();
	} catch (error) {
		if (input.signal.aborted || isAbortError(error)) throw createAbortError(`${input.operation} aborted`);
		if (error instanceof MissingMainAccessTokenError) throw new InterviewSessionTransportError({
			kind: "terminal",
			message: "Missing access token",
			endedReason: "api_bootstrap_failed",
			cause: error
		});
		throw new InterviewSessionTransportError({
			kind: "retryable",
			message: `Failed to ${input.operation}`,
			cause: error
		});
	}
	if (input.signal.aborted) throw createAbortError(`${input.operation} aborted`);
	if (response.error || response.data === null) throw createHttpTransportError(response.status, readEdenErrorValue(response.error), input.operation, input.terminalReason);
	return response.data;
}
function readEdenErrorValue(error) {
	return error?.value ?? null;
}
function createHttpTransportError(status, payload, operation, terminalReason) {
	const message = readErrorMessage(payload) ?? `HTTP ${status}`;
	return new InterviewSessionTransportError({
		kind: classifyInterviewHttpStatus(status),
		message: `Failed to ${operation}: ${message}`,
		endedReason: terminalReason
	});
}
function readErrorMessage(payload) {
	if (!payload || typeof payload !== "object") return null;
	for (const key of [
		"message",
		"error",
		"code"
	]) {
		const value = payload[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}
function createConnectionCloseError(event) {
	const message = `Interview WebSocket closed: ${event.code ?? "unknown"} ${event.reason ?? ""}`.trim();
	if (event.kind === "protocol_error") return new InterviewSessionTransportError({
		kind: "terminal",
		code: "protocol_error",
		message
	});
	if (event.kind === "ownership_lost") return new InterviewSessionTransportError({
		kind: "terminal",
		endedReason: "ownership_lost",
		message
	});
	if (event.kind === "authentication_failed") return new InterviewSessionTransportError({
		kind: "terminal",
		endedReason: "unknown",
		message
	});
	return new Error(message);
}
async function raceWithAbort(promise, signal) {
	if (signal.aborted) throw createAbortError("Interview operation aborted");
	return new Promise((resolve, reject) => {
		function handleAbort() {
			cleanup();
			reject(createAbortError("Interview operation aborted"));
		}
		function cleanup() {
			signal.removeEventListener("abort", handleAbort);
		}
		signal.addEventListener("abort", handleAbort, { once: true });
		promise.then((value) => {
			cleanup();
			resolve(value);
		}, (error) => {
			cleanup();
			reject(error);
		});
	});
}
async function raceWithAbortAndTimeout(promise, signal, timeoutMs, timeoutMessage) {
	let timeout = null;
	try {
		return await raceWithAbort(Promise.race([promise, new Promise((_resolve, reject) => {
			timeout = setTimeout(() => reject(new InterviewSessionTransportError({
				kind: "retryable",
				message: timeoutMessage
			})), timeoutMs);
		})]), signal);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
function createAbortError(message) {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}
function isAbortError(error) {
	return error instanceof Error && error.name === "AbortError";
}
function truncateWebSocketCloseReason(reason) {
	return Buffer.from(reason).subarray(0, 120).toString();
}
function noopAudioDiagnostic(_message) {}
function noopRejectedPromise() {}
//#endregion
//#region src/main/ipc/shortcuts.ts
var lastRegistrationResults = /* @__PURE__ */ new Map();
var sessionShortcutsActive = false;
function getEffectiveShortcuts() {
	return resolveOverlayShortcuts(shortcutStore.getOverrides()).filter(({ action }) => shouldRegisterOverlayShortcut(action));
}
function toBinding(accelerator, action, registered) {
	return {
		action,
		accelerator,
		isDefault: shortcutStore.getOverrides()[action] === void 0,
		registered
	};
}
function getOverlayShortcutBindings() {
	return getEffectiveShortcuts().map(({ accelerator, action }) => toBinding(accelerator, action, lastRegistrationResults.get(action) ?? null));
}
/**
* Probe which effective accelerators are currently available by
* trial-registering and immediately unregistering each one. While a session
* holds the shortcuts this reports the last real registration results instead
* of stealing the keys from ourselves.
*/
function checkOverlayShortcutConflicts() {
	const shortcuts = getEffectiveShortcuts();
	if (sessionShortcutsActive) return getOverlayShortcutBindings();
	return shortcuts.map(({ accelerator, action }) => {
		let ok = false;
		try {
			ok = globalShortcut.register(accelerator, () => {});
		} catch {
			ok = false;
		}
		if (ok) globalShortcut.unregister(accelerator);
		return toBinding(accelerator, action, ok);
	});
}
/**
* Register global shortcuts for overlay actions.
* Should be called when a realtime session starts (overlay is visible).
*/
function registerOverlayShortcuts() {
	lastRegistrationResults.clear();
	sessionShortcutsActive = true;
	for (const { accelerator, action } of getEffectiveShortcuts()) try {
		const registered = globalShortcut.register(accelerator, () => {
			const overlay = getOverlayWindow();
			if (!overlay || overlay.isDestroyed()) return;
			// Emergency exit stays available even if the renderer stops responding.
			if (action === "quit_app") { quitAppFromOverlay(); return; }
			if (action === "toggle_interaction") {
				const nextMode = getCurrentOverlayInteractionMode() === "passive" ? "normal" : "passive";
				showOverlayWindow(nextMode);
				return;
			}
			overlay.webContents.send(IPC_SHORTCUT.OVERLAY_ACTION, action);
		});
		lastRegistrationResults.set(action, registered);
		if (!registered) console.warn(`[shortcut] Failed to register ${accelerator}`);
	} catch (error) {
		lastRegistrationResults.set(action, false);
		console.warn(`[shortcut] Failed to register ${accelerator}:`, error);
	}
}
/**
* Unregister all overlay global shortcuts.
* Should be called when the realtime session ends.
*/
function unregisterOverlayShortcuts() {
	sessionShortcutsActive = false;
	for (const { accelerator } of getEffectiveShortcuts()) globalShortcut.unregister(accelerator);
}
function setOverlayShortcutBinding(action, accelerator) {
	if (!shouldRegisterOverlayShortcut(action)) throw new TypeError(`Unknown overlay shortcut action: ${action}`);
	if (accelerator !== null && !isValidOverlayAccelerator(accelerator)) throw new TypeError(`Invalid overlay shortcut accelerator: ${accelerator}`);
	const previous = shortcutStore.getOverrides()[action] ?? null;
	const activeBefore = sessionShortcutsActive;
	const previousAccelerators = getEffectiveShortcuts().map(s => s.accelerator);
	shortcutStore.setOverride(action, accelerator);
	const duplicates = findDuplicateOverlayAccelerators(resolveOverlayShortcuts(shortcutStore.getOverrides()));
	if (duplicates.length > 0) {
		shortcutStore.setOverride(action, previous);
		throw new TypeError(`Overlay shortcut accelerator already in use: ${duplicates[0]}`);
	}
	if (activeBefore) {
		for (const key of previousAccelerators) globalShortcut.unregister(key);
		registerOverlayShortcuts();
		if (lastRegistrationResults.get(action) === false) {
			unregisterOverlayShortcuts();
			shortcutStore.setOverride(action, previous);
			registerOverlayShortcuts();
			throw new Error("该快捷键已被其他程序占用，已恢复原按键。");
		}
	}
	const updated = getOverlayShortcutBindings();
	for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("shortcut:bindings-changed", updated);
	return updated;
}
function registerShortcutIpc() {
	ipcMain.handle(IPC_SHORTCUT.GET_BINDINGS, () => {
		return getOverlayShortcutBindings();
	});
	ipcMain.handle(IPC_SHORTCUT.SET_BINDING, (_event, action, accelerator) => {
		return setOverlayShortcutBinding(action, accelerator);
	});
	ipcMain.handle(IPC_SHORTCUT.RESET_BINDINGS, () => {
		const wasActive = sessionShortcutsActive;
		if (wasActive) unregisterOverlayShortcuts();
		shortcutStore.reset();
		if (wasActive) registerOverlayShortcuts();
		for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("shortcut:bindings-changed", getOverlayShortcutBindings());
		return getOverlayShortcutBindings();
	});
	ipcMain.handle(IPC_SHORTCUT.CHECK_CONFLICTS, () => {
		return checkOverlayShortcutConflicts();
	});
}
//#endregion
//#region src/main/ipc/session.ts
var transport = new ElectronInterviewSessionTransport();
var currentActor = null;
var currentStartInput = null;
var overlayClosedListenerWindowId = null;
var sessionWindowsActive = false;
var appQuitting = false;
var startQueueTail = null;
app.on("before-quit", () => {
	appQuitting = true;
});
function registerSessionIpc() {
	ipcMain.handle(IPC_SESSION.START, async (_event, input, options) => {
		if (!isInterviewSessionStartInput(input)) throw new TypeError("Invalid Interview session start input");
		return queueInterviewSessionStart(input, options);
	});
	ipcMain.handle(IPC_SESSION.END, async (_event, input) => {
		if (!isInterviewSessionEndInput(input)) throw new TypeError("Invalid Interview session end input");
		return endInterviewSession(input);
	});
	ipcMain.handle(IPC_SESSION.SEND, (_event, input) => {
		if (!isInterviewSessionCommandInput(input)) return false;
		return sendInterviewSessionCommand(input);
	});
	ipcMain.handle(IPC_SESSION.SNAPSHOT, () => currentActor?.getSnapshot() ?? null);
}
function hasActiveInterviewSession() {
	return currentActor?.getSnapshot().status === "active";
}
async function shutdownInterviewSession(reason = "desktop_ws_failed") {
	const actor = currentActor;
	if (!actor) return;
	try {
		await actor.shutdown(reason);
	} finally {
		if (actor === currentActor) restoreSessionWindows();
	}
}
async function startInterviewSession(input, options = {}) {
	if (appQuitting) throw new Error("Cannot start an Interview session while the app is quitting");
	const interactionMode = normalizeOverlayInteractionMode(options.interactionMode ?? DEFAULT_OVERLAY_INTERACTION_MODE);
	const actor = await getOrCreateInterviewSessionActor(input);
	const snapshot = await actor.start();
	if (actor !== currentActor) return snapshot;
	if (snapshot.status === "active") try {
		activateSessionWindows(interactionMode, actor);
	} catch (error) {
		await actor.shutdown("unknown").catch(() => {});
		restoreSessionWindows();
		throw error;
	}
	return actor.getSnapshot();
}
function queueInterviewSessionStart(input, options) {
	const predecessor = startQueueTail;
	const operation = predecessor ? predecessor.then(() => startInterviewSession(input, options), () => startInterviewSession(input, options)) : startInterviewSession(input, options);
	const tail = operation.then(noopStartQueue, noopStartQueue);
	startQueueTail = tail;
	tail.then(() => {
		if (startQueueTail === tail) startQueueTail = null;
	});
	return operation;
}
async function getOrCreateInterviewSessionActor(input) {
	const existing = currentActor;
	if (existing) {
		const snapshot = existing.getSnapshot();
		if (snapshot.status === "ending") await existing.shutdown(snapshot.endedReason ?? "user_ended");
		else if (snapshot.status !== "ended" && snapshot.status !== "failed") {
			if (areStartInputsEqual(currentStartInput, input)) return existing;
			await existing.shutdown("user_ended");
		}
		if (existing === currentActor) restoreSessionWindows();
	}
	currentStartInput = { ...input };
	const holder = { actor: null };
	const actor = new InterviewSessionActor({
		startInput: input,
		transport,
		emitEvent: (event) => {
			if (holder.actor) handleInterviewSessionEvent(holder.actor, event);
		}
	});
	holder.actor = actor;
	currentActor = actor;
	broadcastInterviewSessionEvent({
		type: "snapshot",
		snapshot: actor.getSnapshot()
	});
	return actor;
}
async function endInterviewSession(input) {
	const actor = currentActor;
	if (!actor) throw new Error("No Interview session is available to end");
	return actor.end(input);
}
function sendInterviewSessionCommand(input) {
	return currentActor?.send(input) ?? false;
}
function handleInterviewSessionEvent(actor, event) {
	if (actor !== currentActor) return;
	broadcastInterviewSessionEvent(event);
	if (event.type !== "snapshot") return;
	if (event.snapshot.status === "ending" || event.snapshot.status === "ended" || event.snapshot.status === "failed") restoreSessionWindows();
}
function broadcastInterviewSessionEvent(event) {
	for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_SESSION.EVENT, event);
}
function activateSessionWindows(interactionMode, actor) {
	if (sessionWindowsActive || actor !== currentActor || actor.getSnapshot().status !== "active") return;
	resetOverlayContentProtection();
	ensureOverlayClosedCleanupListener(createOverlayWindow(interactionMode));
	showOverlayWindow(interactionMode);
	registerOverlayShortcuts();
	hideMainWindow();
	if (process.platform === "darwin" && app.dock) app.dock.hide();
	sessionWindowsActive = true;
}
function ensureOverlayClosedCleanupListener(overlay) {
	if (overlayClosedListenerWindowId === overlay.id) return;
	overlayClosedListenerWindowId = overlay.id;
	const attachedWindowId = overlay.id;
	overlay.once("closed", () => {
		if (overlayClosedListenerWindowId === attachedWindowId) overlayClosedListenerWindowId = null;
		const actor = currentActor;
		if (!actor) return;
		const status = actor.getSnapshot().status;
		if (status === "active" || status === "connecting" || status === "reconnecting") actor.shutdown("user_ended").catch((error) => {
			console.error("[interview-session] Failed to end after Overlay closed:", error);
		});
	});
}
function restoreSessionWindows() {
	sessionWindowsActive = false;
	unregisterOverlayShortcuts();
	const overlay = getOverlayWindow();
	if (overlay && !overlay.isDestroyed()) closeOverlayWindow();
	resetOverlayInteractionMode();
	if (appQuitting) return;
	if (process.platform === "darwin" && app.dock) app.dock.show();
	showMainWindow();
}
function areStartInputsEqual(left, right) {
	return left?.workspaceId === right.workspaceId && left?.title === right.title && left?.fallbackLanguage === right.fallbackLanguage;
}
function noopStartQueue() {}
//#endregion
//#region src/main/ipc/overlay.ts
var MAX_CAPTURE_DIMENSION = 1280;
var PNG_MAX_INLINE_BYTES = 2 * 1024 * 1024;
var JPEG_FALLBACK_QUALITY = 85;
function toOverlayRect(rect) {
	return {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height
	};
}
function getOverlayWindowForSender(sender) {
	const senderWindow = BrowserWindow.fromWebContents(sender);
	const overlayWindow = getOverlayWindow();
	if (!senderWindow || !overlayWindow || overlayWindow.isDestroyed() || senderWindow.id !== overlayWindow.id) return null;
	return overlayWindow;
}
function getOverlayDisplayMetrics() {
	const overlayWin = getOverlayWindow();
	if (overlayWin && !overlayWin.isDestroyed()) {
		const windowBounds = toOverlayRect(overlayWin.getBounds());
		const display = screen.getDisplayMatching(windowBounds);
		return {
			bounds: toOverlayRect(display.bounds),
			workArea: toOverlayRect(display.workArea),
			windowBounds
		};
	}
	const display = screen.getPrimaryDisplay();
	const bounds = toOverlayRect(display.bounds);
	return {
		bounds,
		workArea: toOverlayRect(display.workArea),
		windowBounds: bounds
	};
}
/**
* Register IPC handlers for overlay window.
* Handles click-through toggle, window dragging, content protection, and screen capture.
*/
function quitAppFromOverlay() {
	appQuitting = true;
	for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.hide();
	app.quit();
}
function registerOverlayIpc() {
	ipcMain.handle("overlay:quit-app", (event) => {
		if (!getOverlayWindowForSender(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error("Only the active overlay may quit the app");
		quitAppFromOverlay();
		return true;
	});
	ipcMain.on(IPC_OVERLAY.SET_IGNORE_MOUSE, (event, ignore, options) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (win && !win.isDestroyed()) {
			if (getOverlayWindow()?.id === win.id && getCurrentOverlayInteractionMode() === "passive") {
				win.setIgnoreMouseEvents(true);
				return;
			}
			win.setIgnoreMouseEvents(ignore, options);
		}
	});
	ipcMain.handle(IPC_OVERLAY.SET_CONTENT_PROTECTION, (event, enabled) => {
		if (typeof enabled !== "boolean") throw new TypeError("Content protection state must be a boolean");
		if (!getOverlayWindowForSender(event.sender)) throw new Error("Content protection can only be changed by the active Overlay window");
		return setOverlayContentProtection(enabled);
	});
	ipcMain.handle(IPC_OVERLAY.GET_CONTENT_PROTECTION, (event) => {
		if (!getOverlayWindowForSender(event.sender)) throw new Error("Content protection can only be read by the active Overlay window");
		return getOverlayContentProtection();
	});
	ipcMain.handle(IPC_OVERLAY.CAPTURE_SCREEN, async (event) => {
		const senderWindowId = BrowserWindow.fromWebContents(event.sender)?.id ?? null;
		const overlayWin = getOverlayWindow();
		const overlayWindowId = overlayWin && !overlayWin.isDestroyed() ? overlayWin.id : null;
		const authorization = authorizeOverlayCapture({
			senderWindowId,
			overlayWindowId,
			hasActiveRealtimeSession: hasActiveInterviewSession()
		});
		if (!authorization.ok) {
			console.warn("[overlay] capture denied", {
				senderWindowId,
				overlayWindowId,
				reason: authorization.reason
			});
			return null;
		}
		const needsHide = Boolean(overlayWin && !overlayWin.isDestroyed() && !overlayWin.isContentProtected());
		if (needsHide) {
			overlayWin?.hide();
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
		try {
			const { width, height } = screen.getPrimaryDisplay().size;
			const sources = await desktopCapturer.getSources({
				types: ["screen"],
				thumbnailSize: {
					width,
					height
				}
			});
			if (sources.length === 0) return null;
			let image = sources[0].thumbnail;
			const { width: imgW, height: imgH } = image.getSize();
			if (Math.max(imgW, imgH) > MAX_CAPTURE_DIMENSION) {
				const resizeOpts = imgW >= imgH ? { width: MAX_CAPTURE_DIMENSION } : { height: MAX_CAPTURE_DIMENSION };
				image = image.resize({
					...resizeOpts,
					quality: "best"
				});
			}
			const pngBuffer = image.toPNG();
			const jpegBuffer = pngBuffer.byteLength > PNG_MAX_INLINE_BYTES ? image.toJPEG(JPEG_FALLBACK_QUALITY) : null;
			const selected = jpegBuffer && jpegBuffer.byteLength < pngBuffer.byteLength ? {
				buffer: jpegBuffer,
				mimeType: "image/jpeg"
			} : {
				buffer: pngBuffer,
				mimeType: "image/png"
			};
			const { width: outputWidth, height: outputHeight } = image.getSize();
			return {
				imageData: selected.buffer.toString("base64"),
				mimeType: selected.mimeType,
				width: outputWidth,
				height: outputHeight,
				byteLength: selected.buffer.byteLength
			};
		} finally {
			if (needsHide && overlayWin && !overlayWin.isDestroyed()) if (getCurrentOverlayInteractionMode() === "passive") showOverlayWindow("passive");
			else overlayWin.show();
		}
	});
	ipcMain.handle(IPC_OVERLAY.GET_INTERACTION_MODE, () => getCurrentOverlayInteractionMode());
	ipcMain.handle(IPC_OVERLAY.GET_DISPLAY_METRICS, () => getOverlayDisplayMetrics());
}
//#endregion
//#region src/main/lib/core-graphics.ts
/**
* CoreGraphics FFI bindings via koffi.
*
* Loads CoreGraphics.framework at runtime to call screen-capture permission
* APIs directly from the Electron main process. This ensures TCC registers
* the Electron app bundle (not a child process) as the permission target.
*
* macOS only — callers must gate on `process.platform === "darwin"`.
* Lazily loaded so the native koffi module is never touched on non-macOS platforms.
*/
var bindings;
var nodeRequire = createRequire(import.meta.url);
function getCoreGraphics() {
	if (!bindings) {
		const cg = nodeRequire("koffi").load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
		bindings = {
			preflight: cg.func("bool CGPreflightScreenCaptureAccess()"),
			request: cg.func("bool CGRequestScreenCaptureAccess()")
		};
	}
	return bindings;
}
/** Returns true if the app already has screen capture permission. Real-time, uncached check. */
function CGPreflightScreenCaptureAccess() {
	return getCoreGraphics().preflight();
}
/** Registers the app with TCC and shows the system prompt (once per session). Returns true if already granted. */
function CGRequestScreenCaptureAccess() {
	return getCoreGraphics().request();
}
//#endregion
//#region src/main/ipc/permission.ts
/**
* macOS permission management IPC handlers.
*
* Provides permission status checking, native request dialogs, and
* System Preferences deep-links for microphone and screen recording.
*
* On non-macOS platforms all permissions are reported as "granted".
*/
var SCREEN_SETTINGS_URLS = [
	"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
	"x-apple.systempreferences:com.apple.preference.security",
	"x-apple.systempreferences:"
];
var MICROPHONE_SETTINGS_URLS = [
	"x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
	"x-apple.systempreferences:com.apple.preference.security",
	"x-apple.systempreferences:"
];
var SCREEN_PERMISSION_RECHECK_DELAY_MS = 500;
function getMicrophoneStatus() {
	if (process.platform !== "darwin") return "granted";
	return systemPreferences.getMediaAccessStatus("microphone");
}
function getScreenStatus() {
	if (process.platform !== "darwin") return "granted";
	if (CGPreflightScreenCaptureAccess()) return "granted";
	return systemPreferences.getMediaAccessStatus("screen");
}
function getPermissionState() {
	return {
		microphone: getMicrophoneStatus(),
		screen: getScreenStatus()
	};
}
function logPermissionEvent(event, details) {
	console.info("[permission]", JSON.stringify({
		event,
		...details
	}));
}
function logPermissionWarning(event, error) {
	console.warn("[permission]", event, error);
}
function shouldOpenSettings(status) {
	return status !== "granted";
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
async function openSystemSettings(urls) {
	let lastError;
	for (const url of urls) try {
		await shell.openExternal(url);
		logPermissionEvent("open-settings", { url });
		return;
	} catch (error) {
		lastError = error;
		logPermissionWarning(`Failed to open settings URL: ${url}`, error);
	}
	throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error("Failed to open System Settings");
}
/**
* Request microphone access.
*
* On macOS with "not-determined" status, `askForMediaAccess('microphone')` shows
* the native system dialog. If the user previously denied, the dialog will NOT
* re-appear — the user must grant access in System Preferences.
*/
async function requestMicrophone() {
	if (process.platform !== "darwin") return {
		granted: true,
		openSettings: false
	};
	const current = getMicrophoneStatus();
	logPermissionEvent("request-microphone-start", { current });
	if (current === "granted") return {
		granted: true,
		openSettings: false
	};
	if (current === "denied" || current === "restricted") return {
		granted: false,
		openSettings: true
	};
	try {
		await systemPreferences.askForMediaAccess("microphone");
	} catch (error) {
		logPermissionWarning("Microphone permission request threw", error);
	}
	const actual = getMicrophoneStatus();
	const granted = actual === "granted";
	logPermissionEvent("request-microphone-complete", {
		current,
		actual,
		granted
	});
	return {
		granted,
		openSettings: shouldOpenSettings(actual)
	};
}
/**
* Request screen recording access.
*
* macOS 15+ splits TCC into "Screen Recording" (legacy CGWindowList) and
* "Screen & System Audio Recording" (ScreenCaptureKit). Our macOS audio sidecar
* uses ScreenCaptureKit with `capturesAudio`, so we need the latter category.
*
* Strategy:
* 1. Call `desktopCapturer.getSources()` — on Electron 41 / macOS 15+ this
*    uses ScreenCaptureKit internally and registers the app under the
*    "Screen & System Audio Recording" TCC category.
* 2. Call `CGRequestScreenCaptureAccess()` as a fallback for legacy TCC.
* 3. Re-check after a brief delay, then direct to System Settings if needed.
*
* Note: macOS may require an app restart after granting screen recording.
*/
async function requestScreen() {
	if (process.platform !== "darwin") return {
		granted: true,
		openSettings: false
	};
	const current = getScreenStatus();
	logPermissionEvent("request-screen-start", { current });
	if (current === "granted") return {
		granted: true,
		openSettings: false
	};
	if (current === "denied" || current === "restricted") return {
		granted: false,
		openSettings: true
	};
	try {
		await desktopCapturer.getSources({
			types: ["screen"],
			thumbnailSize: {
				width: 1,
				height: 1
			}
		});
	} catch (error) {
		logPermissionWarning("Screen permission desktopCapturer probe threw", error);
	}
	try {
		CGRequestScreenCaptureAccess();
	} catch (error) {
		logPermissionWarning("Screen permission CoreGraphics request threw", error);
	}
	await sleep(SCREEN_PERMISSION_RECHECK_DELAY_MS);
	const actual = getScreenStatus();
	const granted = actual === "granted";
	logPermissionEvent("request-screen-complete", {
		current,
		actual,
		granted
	});
	if (granted) return {
		granted: true,
		openSettings: false
	};
	return {
		granted: false,
		openSettings: shouldOpenSettings(actual)
	};
}
async function preflightDesktopCapture() {
	try {
		if ((await desktopCapturer.getSources({
			types: ["screen"],
			thumbnailSize: {
				width: 1,
				height: 1
			}
		})).length === 0) return {
			ok: false,
			status: "unavailable",
			reasonCode: "screen_source_unavailable",
			reason: "No screen source is available"
		};
		return {
			ok: true,
			status: "granted"
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : "Screen capture check failed";
		logPermissionWarning("Screen capture preflight failed", error);
		return {
			ok: false,
			status: "failed",
			reasonCode: "screen_capture_failed",
			reason
		};
	}
}
async function preflightInterviewCapture() {
	if (process.platform !== "darwin" && process.platform !== "win32") return {
		ok: false,
		microphone: {
			ok: false,
			status: "failed",
			reasonCode: "platform_unsupported",
			reason: `Audio capture is not supported on ${process.platform}`
		},
		screen: {
			ok: false,
			status: "failed",
			reasonCode: "platform_unsupported",
			reason: `Screen capture is not supported on ${process.platform}`
		}
	};
	const permissionState = getPermissionState();
	const microphone = permissionState.microphone === "granted" ? {
		ok: true,
		status: "granted"
	} : {
		ok: false,
		status: permissionState.microphone
	};
	let screen = permissionState.screen === "granted" ? {
		ok: true,
		status: "granted"
	} : {
		ok: false,
		status: permissionState.screen
	};
	if (!microphone.ok || !screen.ok) return {
		ok: false,
		microphone,
		screen
	};
	screen = await preflightDesktopCapture();
	if (!screen.ok) return {
		ok: false,
		microphone,
		screen
	};
	const { probeSidecar } = await import("./assets/sidecar-probe-Dgz5fcDb.js");
	const probe = await probeSidecar({ devices: audioDevicesStore.getSelection() });
	if (probe.ok) return {
		ok: true,
		microphone,
		screen
	};
	if (probe.micState !== "ok") {
		const failure = resolveProbeFailure(probe);
		return {
			ok: false,
			microphone: {
				ok: false,
				status: probe.micState === "denied" ? "denied" : "unavailable",
				reasonCode: failure.reasonCode,
				reason: failure.reason
			},
			screen
		};
	}
	const failure = resolveProbeFailure(probe);
	return {
		ok: false,
		microphone,
		screen: {
			ok: false,
			status: probe.exitCode === 1 ? "denied" : "failed",
			reasonCode: failure.reasonCode,
			reason: failure.reason
		}
	};
}
function resolveProbeFailure(probe) {
	if (probe.exitCode === -1) return {
		reasonCode: "sidecar_probe_timeout",
		reason: "Audio capture preflight timed out"
	};
	if (probe.micState === "denied") return {
		reasonCode: "microphone_permission_denied",
		reason: "Microphone permission is not granted"
	};
	if (probe.micState === "none") return {
		reasonCode: "microphone_device_unavailable",
		reason: "No microphone device is available"
	};
	if (probe.micState === "degraded") return {
		reasonCode: "microphone_capture_failed",
		reason: "Microphone capture failed"
	};
	if (probe.exitCode === 1) return {
		reasonCode: "screen_permission_denied",
		reason: "Screen and system audio permission is not granted"
	};
	if (probe.exitCode === 2) return {
		reasonCode: "capture_device_unavailable",
		reason: "Required capture device is unavailable"
	};
	if (probe.exitCode === 3) return {
		reasonCode: "screencapturekit_failed",
		reason: "ScreenCaptureKit failed to initialize"
	};
	return {
		reasonCode: "audio_engine_failed",
		reason: "Audio capture engine failed"
	};
}
function registerPermissionIpc() {
	ipcMain.handle(IPC_PERMISSION.GET_STATUS, () => {
		return getPermissionState();
	});
	ipcMain.handle(IPC_PERMISSION.REQUEST_MICROPHONE, async () => {
		return requestMicrophone();
	});
	ipcMain.handle(IPC_PERMISSION.REQUEST_SCREEN, async () => {
		return requestScreen();
	});
	ipcMain.handle(IPC_PERMISSION.PROBE_SIDECAR, async () => {
		if (process.platform !== "darwin" && process.platform !== "win32") return {
			ok: false,
			micState: "ok",
			exitCode: 5,
			stderr: `Audio capture is not supported on ${process.platform}`
		};
		const { probeSidecar } = await import("./assets/sidecar-probe-Dgz5fcDb.js");
		return probeSidecar({ devices: audioDevicesStore.getSelection() });
	});
	ipcMain.handle(IPC_PERMISSION.PREFLIGHT_INTERVIEW_CAPTURE, async () => {
		return preflightInterviewCapture();
	});
	ipcMain.handle(IPC_PERMISSION.OPEN_SCREEN_SETTINGS, async () => {
		await openSystemSettings(SCREEN_SETTINGS_URLS);
	});
	ipcMain.handle(IPC_PERMISSION.OPEN_MIC_SETTINGS, async () => {
		await openSystemSettings(MICROPHONE_SETTINGS_URLS);
	});
}
//#endregion
//#region src/main/ipc/theme.ts
/**
* Get the current theme preference.
* Defaults to "system" if not set.
*/
function getTheme() {
	return themeStore.get();
}
/**
* Set the theme preference and apply it to the app.
* @param preference - The theme preference to set
*/
function setTheme(preference) {
	nativeTheme.themeSource = preference;
	themeStore.set(preference);
}
/**
* Apply the persisted theme on startup.
* Should be called when the app is ready.
*/
function applyStartupTheme() {
	nativeTheme.themeSource = themeStore.get();
}
/**
* Register theme IPC handlers.
*/
function registerThemeIpc() {
	ipcMain.handle(IPC_THEME.GET, () => {
		return getTheme();
	});
	ipcMain.handle(IPC_THEME.SET, (_event, preference) => {
		setTheme(preference);
	});
}
//#endregion
//#region src/main/updater.ts
var STARTUP_CHECK_DELAY_MS = 1e4;
var CHECK_INTERVAL_MS = 14400 * 1e3;
var autoUpdater = getAutoUpdater();
function getAutoUpdater() {
	const { autoUpdater: updater } = electronUpdater;
	return updater;
}
/**
* Extract the release channel from a semver version string.
* Examples:
*   "0.4.0-alpha.1" → "alpha"
*   "0.4.0-beta.2"  → "beta"
*   "0.4.0"         → "latest"
*/
function detectChannel(version) {
	return version.match(/-(alpha|beta)\b/)?.[1] ?? "latest";
}
var currentStatus = "idle";
var availableVersion = null;
var downloadProgress = null;
var checkTimer = null;
/**
* Send an update event to all renderer windows.
*/
function broadcastEvent(event) {
	for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_UPDATER.EVENT, event);
}
/**
* Get current update status snapshot.
*/
function getUpdateStatus() {
	return {
		status: currentStatus,
		channel: detectChannel(app.getVersion()),
		currentVersion: app.getVersion(),
		availableVersion,
		downloadProgress
	};
}
/**
* Manually check for updates.
* Returns the update check result.
*/
async function checkForUpdates() {
	if (process.env.CHEATER_LOCAL === "1") {
		currentStatus = "not-available";
		availableVersion = null;
		downloadProgress = null;
		return getUpdateStatus();
	}
	if (currentStatus === "downloading" || currentStatus === "downloaded") return getUpdateStatus();
	try {
		await autoUpdater.checkForUpdates();
	} catch {}
	return getUpdateStatus();
}
/**
* Quit the app and install the downloaded update.
*/
function installUpdate() {
	if (currentStatus !== "downloaded") throw new Error("No update downloaded to install");
	autoUpdater.quitAndInstall(false, true);
}
/**
* Initialize the auto-updater.
* Should be called once after app.whenReady().
*/
function initializeUpdater() {
	if (process.env.CHEATER_LOCAL === "1") {
		currentStatus = "not-available";
		console.log(`[updater] Local replica mode: update checks are disabled (version: ${app.getVersion()})`);
		return;
	}
	if (is.dev) {
		autoUpdater.updateConfigPath = `${app.getAppPath()}/dev-app-update.yml`;
		autoUpdater.forceDevUpdateConfig = true;
	} else if (config.cdnBaseUrl) autoUpdater.setFeedURL({
		provider: "generic",
		url: `${config.cdnBaseUrl}/releases/desktop`
	});
	const channel = detectChannel(app.getVersion());
	if (channel !== "latest") autoUpdater.channel = channel;
	console.log(`[updater] Release channel: ${channel} (version: ${app.getVersion()})`);
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("checking-for-update", () => {
		currentStatus = "checking";
		broadcastEvent({ type: "checking" });
		console.log("[updater] Checking for update...");
	});
	autoUpdater.on("update-available", (info) => {
		currentStatus = "available";
		availableVersion = info.version;
		downloadProgress = null;
		broadcastEvent({
			type: "available",
			info
		});
		console.log(`[updater] Update available: ${info.version}`);
	});
	autoUpdater.on("update-not-available", (info) => {
		currentStatus = "not-available";
		availableVersion = null;
		downloadProgress = null;
		broadcastEvent({
			type: "not-available",
			info
		});
		console.log(`[updater] No update available (current: ${info.version})`);
	});
	autoUpdater.on("download-progress", (progress) => {
		currentStatus = "downloading";
		downloadProgress = progress.percent;
		broadcastEvent({
			type: "download-progress",
			progress
		});
	});
	autoUpdater.on("update-downloaded", (info) => {
		currentStatus = "downloaded";
		downloadProgress = 100;
		broadcastEvent({
			type: "downloaded",
			info
		});
		console.log(`[updater] Update downloaded: ${info.version}`);
	});
	autoUpdater.on("error", (error) => {
		currentStatus = "error";
		broadcastEvent({
			type: "error",
			message: error.message
		});
		console.error("[updater] Error:", error.message);
	});
	setTimeout(() => {
		checkForUpdates();
		checkTimer = setInterval(() => {
			checkForUpdates();
		}, CHECK_INTERVAL_MS);
	}, STARTUP_CHECK_DELAY_MS);
}
/**
* Cleanup updater resources.
* Call when the app is about to quit.
*/
function cleanupUpdater() {
	if (checkTimer) {
		clearInterval(checkTimer);
		checkTimer = null;
	}
}
//#endregion
//#region src/main/ipc/updater.ts
/**
* Register updater IPC handlers.
*/
function registerUpdaterIpc() {
	ipcMain.handle(IPC_UPDATER.CHECK, async () => {
		return checkForUpdates();
	});
	ipcMain.handle(IPC_UPDATER.INSTALL, () => {
		installUpdate();
	});
	ipcMain.handle(IPC_UPDATER.STATUS, () => {
		return getUpdateStatus();
	});
}
//#endregion
//#region src/main/ipc/window-state.ts
/**
* Register window state IPC handlers
*/
function registerWindowStateIpc() {
	ipcMain.handle(IPC_WINDOW_STATE.RESET, () => {
		windowStateStore.reset();
		return { success: true };
	});
}
//#endregion
//#region src/main/ipc/index.ts
/**
* Register all IPC handlers.
* Should be called when the app is ready.
*/
function registerIpcHandlers() {
	registerOnboardIpc();
	registerAudioDevicesIpc();
	registerAuthIpc();
	registerAccentIpc();
	registerThemeIpc();
	registerLocaleIpc();
	registerFilesIpc();
	registerOverlayIpc();
	registerPermissionIpc();
	registerSessionIpc();
	registerShortcutIpc();
	registerUpdaterIpc();
	registerWindowStateIpc();
	applyStartupTheme();
}
//#endregion
//#region src/main/index.ts
var QUIT_INTERVIEW_CLEANUP_TIMEOUT_MS = 2500;
var quitCleanupStarted = false;
var quitCleanupComplete = false;
function logProcessCrash(event, details) {
	console.error("[process-crash]", JSON.stringify({
		timestamp: (/* @__PURE__ */ new Date()).toISOString(),
		event,
		...details
	}));
}
app.on("render-process-gone", (_event, webContents, details) => {
	logProcessCrash("render-process-gone", {
		processType: "renderer",
		reason: details.reason,
		exitCode: details.exitCode,
		windowId: BrowserWindow.fromWebContents(webContents)?.id ?? null
	});
});
app.on("child-process-gone", (_event, details) => {
	logProcessCrash("child-process-gone", {
		processType: details.type,
		reason: details.reason,
		exitCode: details.exitCode,
		serviceName: details.serviceName ?? null,
		name: details.name ?? null
	});
});
process.on("uncaughtException", (error) => {
	logProcessCrash("uncaught-exception", {
		processType: "main",
		reason: error.message,
		exitCode: null,
		stack: error.stack ?? null
	});
});
process.on("unhandledRejection", (reason) => {
	const error = reason instanceof Error ? reason : new Error(String(reason));
	logProcessCrash("unhandled-rejection", {
		processType: "main",
		reason: error.message,
		exitCode: null,
		stack: error.stack ?? null
	});
});
registerProtocolScheme();
registerIpcHandlers();
app.whenReady().then(async () => {
	await globalThis.__CHEATER_BOOT_READY__;
	electronApp.setAppUserModelId("com.cheater.desktop");
	setupProtocolHandler();
	app.on("browser-window-created", (_, window) => {
		optimizer.watchWindowShortcuts(window);
		window.webContents.on("before-input-event", (event, input) => {
			if ((input.control || input.meta) && [
				"+",
				"=",
				"-",
				"0"
			].includes(input.key)) event.preventDefault();
		});
		window.webContents.on("zoom-changed", () => window.webContents.setZoomLevel(0));
		let reopeningDetachedDevtools = false;
		window.webContents.on("devtools-opened", () => {
			if (window.isDestroyed()) return;
			if (reopeningDetachedDevtools) {
				reopeningDetachedDevtools = false;
				return;
			}
			reopeningDetachedDevtools = true;
			setImmediate(() => {
				if (window.isDestroyed()) {
					reopeningDetachedDevtools = false;
					return;
				}
				if (!window.webContents.isDevToolsOpened()) {
					reopeningDetachedDevtools = false;
					return;
				}
				window.webContents.closeDevTools();
				window.webContents.openDevTools({ mode: "detach" });
			});
		});
	});
	initializeWindows();
	initializeUpdater();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) initializeWindows();
	});
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
	if (quitCleanupComplete) return;
	event.preventDefault();
	if (quitCleanupStarted) return;
	quitCleanupStarted = true;
	waitForBoundedInterviewShutdown().finally(() => {
		quitCleanupComplete = true;
		app.quit();
	});
});
app.on("will-quit", () => {
	cleanupUpdater();
});
async function waitForBoundedInterviewShutdown() {
	let timeout = null;
	try {
		await Promise.race([shutdownInterviewSession().catch(() => {}), new Promise((resolve) => {
			timeout = setTimeout(resolve, QUIT_INTERVIEW_CLEANUP_TIMEOUT_MS);
		})]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
//#endregion
export { spawnSidecarProcess as n, buildAudioDeviceArgs as r, parseSidecarHealthLine as t };
