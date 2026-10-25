import { n as spawnSidecarProcess, r as buildAudioDeviceArgs, t as parseSidecarHealthLine } from "../index.mjs";
//#region src/main/realtime/sidecar-probe.ts
var PROBE_TIMEOUT_MS = 1e4;
async function probeSidecar(optionsOrTimeout = PROBE_TIMEOUT_MS) {
	const options = typeof optionsOrTimeout === "number" ? { timeoutMs: optionsOrTimeout } : optionsOrTimeout;
	const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
	let spawned;
	try {
		spawned = spawnSidecarProcess({
			mode: "probe",
			args: ["--probe-only", ...buildAudioDeviceArgs(options.devices)]
		});
	} catch (error) {
		return {
			ok: false,
			micState: "ok",
			exitCode: 5,
			stderr: error instanceof Error ? error.message : "Failed to spawn sidecar probe"
		};
	}
	const { child } = spawned;
	let settled = false;
	try {
		return await new Promise((resolve) => {
			const timeout = setTimeout(() => {
				const stderrOutput = spawned.getCollectedStderr() ?? "";
				const parsedProbe = parseProbeMicState(stderrOutput);
				console.error(`[sidecar:probe] Sidecar capture preflight timed out after ${timeoutMs}ms`);
				finish({
					ok: false,
					micState: parsedProbe.micState,
					exitCode: -1,
					stderr: stderrOutput
				}, { kill: true });
			}, timeoutMs);
			const cleanup = () => {
				clearTimeout(timeout);
				child.off("error", handleError);
				child.off("exit", handleExit);
			};
			const finish = (result, options = {}) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (options.kill) try {
					child.kill();
				} catch {}
				resolve(result);
			};
			const handleError = (error) => {
				const stderrOutput = spawned.getCollectedStderr() ?? "";
				const parsedProbe = parseProbeMicState(stderrOutput);
				console.error(`[sidecar:probe] ${error.message}`);
				finish({
					ok: false,
					micState: parsedProbe.micState,
					exitCode: 5,
					stderr: stderrOutput || error.message
				});
			};
			const handleExit = (code, signal) => {
				const exitCode = code ?? 5;
				const stderrOutput = spawned.getCollectedStderr() ?? "";
				const parsedProbe = parseProbeMicState(stderrOutput);
				const ok = exitCode === 0 && parsedProbe.hasProbeResult && parsedProbe.micState === "ok";
				if (!ok) console.error(`[sidecar:probe] Sidecar capture preflight failed: code=${code ?? "null"} signal=${signal ?? "null"}`);
				finish({
					ok,
					micState: parsedProbe.micState,
					exitCode,
					stderr: stderrOutput
				});
			};
			child.once("error", handleError);
			child.once("exit", handleExit);
		});
	} finally {
		spawned.cleanup();
	}
}
function parseProbeMicState(stderrOutput) {
	for (const line of stderrOutput.split(/\r?\n/)) {
		const probeMatch = /\bPROBE_RESULT\b.*\bmic=(ok|denied|degraded|none)\b/i.exec(line);
		if (probeMatch?.[1]) return {
			hasProbeResult: true,
			micState: probeMatch[1].toLowerCase()
		};
		const healthEvent = parseSidecarHealthLine(line);
		if (!healthEvent) continue;
		if (healthEvent.code === "mic_degraded" || healthEvent.micState === "degraded") return {
			hasProbeResult: false,
			micState: "degraded"
		};
		if (healthEvent.code === "mic_unavailable" || healthEvent.micState === "unavailable" || healthEvent.micState === "lost") {
			if (healthEvent.message.toLowerCase().includes("permission")) return {
				hasProbeResult: false,
				micState: "denied"
			};
			return {
				hasProbeResult: false,
				micState: "none"
			};
		}
	}
	return {
		hasProbeResult: false,
		micState: "ok"
	};
}
//#endregion
export { probeSidecar };
