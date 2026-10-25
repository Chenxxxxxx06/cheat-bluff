import {BRAND} from "./brand.mjs";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AiSettingsStore } from "./ai-settings.mjs";
import { KnowledgeIndex } from "./knowledge/knowledge-index.mjs";
import { LocalDataCipher } from "./local-data-cipher.mjs";
import { createPaddleOcrService } from "./knowledge/paddle-ocr.mjs";
import { scanKnowledgeFolder } from "./knowledge/folder-source.mjs";
import { startReplicaApiServer } from "./local-api/server.mjs";
import { createParaformerAsrService } from "./paraformer-asr.mjs";
import { createAiService } from "./ai-service.mjs";
import { registerInterviewExportIpc, authorizeRecordExport } from "./interview-export.mjs";
import { registerInterviewWorkflowIpc } from "./interview-workflow.mjs";
import { InterviewBudgetStore, registerInterviewBudgetIpc } from "./interview-budget.mjs";

const API_PORT = 43149;
const LOCAL_API_TOKEN = randomBytes(32).toString("base64url");
process.env.CHEATER_LOCAL = "1";
app.setName(BRAND.name);
app.setAboutPanelOptions({applicationName:BRAND.name,applicationVersion:BRAND.version,copyright:`Original modifications © 2026 ${BRAND.author}`});
app.on("browser-window-created",(_event,window)=>{window.setIcon(join(app.getAppPath(),"out/renderer/assets/cheat-bluff-icon.png"));});
console.info("[cheater] Starting local desktop services...");
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  const windows = BrowserWindow.getAllWindows().filter((candidate) => !candidate.isDestroyed());
  const activeOverlay = windows.find((candidate) => candidate.isVisible() && candidate.webContents.getURL().includes("#/overlay"));
  if (activeOverlay) return;
  const window = windows.find((candidate) => !candidate.webContents.getURL().includes("#/overlay"));
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
const explicitUserData = process.argv.some((argument) => argument.startsWith("--user-data-dir="));
if (!explicitUserData) {
  app.setPath("userData", join(app.getPath("appData"), "CheatBluff"));
}

const userDataDirectory = app.getPath("userData");
seedDesktopPreferences(userDataDirectory, LOCAL_API_TOKEN);
let releaseBootGate;
globalThis.__CHEATER_BOOT_READY__ = new Promise((resolve) => { releaseBootGate = resolve; });
void import("./index.mjs")
  .then(async () => {
    console.info("[cheater] Main application module loaded.");
    await initializeLocalServices();
  })
  .catch((error) => {
    console.error("[cheater] Startup failed:", error);
    app.exit(1);
  });

async function initializeLocalServices() {
  await app.whenReady();
  console.info("[cheater] Electron is ready.");

  const replicaDataDirectory = join(userDataDirectory, "replica-service");
  const dataCipher = await new LocalDataCipher({
    keyFilePath: join(replicaDataDirectory, "protected-data-key.json"),
    safeStorage,
  }).initialize();
  console.info("[cheater] Local encryption initialized.");
  const paddleOcr = createPaddleOcrService({
    runtimeDirectory: app.isPackaged
      ? join(process.resourcesPath, "ocr-runtime")
      : join(app.getAppPath(), "resources", "ocr-runtime"),
  });
  registerKnowledgeFolderIpc(paddleOcr);
  const aiSettings = await new AiSettingsStore({
    filePath: join(userDataDirectory, "ai-settings.json"),
    safeStorage,
  }).initialize();
  console.info("[cheater] AI settings initialized.");
  const interviewBudget = await new InterviewBudgetStore({filePath:join(userDataDirectory,"interview-budget.json"),safeStorage,getAiSettings:()=>aiSettings.getPublicSettings()}).initialize();
  registerInterviewBudgetIpc({ipcMain,BrowserWindow,shell,store:interviewBudget});
  const aiService = createAiService(aiSettings);
  void aiService.warmup().catch((error) => {
    console.warn("[cheater] Pi/Copilot fallback warmup failed:", error?.message ?? error);
  });
  const asrService = createParaformerAsrService(aiSettings);
  const knowledgeIndex = await new KnowledgeIndex({
    filePath: join(replicaDataDirectory, "knowledge-index.json"),
    aiService,
    cipher: dataCipher,
    ocr: paddleOcr,
  }).initialize();
  console.info("[cheater] Knowledge index initialized.");
  registerAiSettingsIpc(aiSettings, aiService, asrService);
  app.once("will-quit", () => {
    void aiService.dispose().catch(() => undefined);
  });

  const localApi = await startReplicaApiServer({
    host: "127.0.0.1",
    port: API_PORT,
    authToken: LOCAL_API_TOKEN,
    dataCipher,
    dataDirectory: replicaDataDirectory,
    aiService,
    asrService,
    knowledgeIndex,
    ocr: paddleOcr,
    onClearLocalData: async () => {await aiSettings.clearApiKey(); await interviewBudget.clearAll();},
  });
  console.info("[cheater] Local API initialized.");
  registerInterviewExportIpc({ ipcMain, BrowserWindow, dialog, store: localApi.store });
  registerInterviewWorkflowIpc({ ipcMain, BrowserWindow, dialog, store: localApi.store });
  ipcMain.handle("personal-library:invoke", async (event, action, input = {}) => {
    if (!authorizeRecordExport(event, BrowserWindow)) throw new Error("当前页面无权访问个人知识库。");
    if (action === "pick-folder" || action === "pick-files") {
      if (!localApi.personalLibrary.snapshot(input.profileId).profile) throw new Error("请先创建个人档案。");
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title: action === "pick-folder" ? "导入个人资料文件夹" : "批量导入个人材料",
        properties: action === "pick-folder" ? ["openDirectory", "dontAddToRecent"] : ["openFile", "multiSelections", "dontAddToRecent"],
      });
      if (result.canceled || !result.filePaths.length) return {canceled:true};
      return action === "pick-folder"
        ? localApi.personalLibrary.importFolder(input.profileId, result.filePaths[0], input.relationship)
        : localApi.personalLibrary.importFiles(input.profileId, result.filePaths, input.relationship);
    }
    return localApi.personalLibrary.dispatch(action, input);
  });
  releaseBootGate();

  if (localApi) {
    app.once("will-quit", () => {
      void localApi.close().catch(() => undefined);
    });
  }
}

function registerKnowledgeFolderIpc(ocr) {
  const channel = "files:open-knowledge-folder";
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event) => {
    const senderFrame = event.senderFrame;
    const mainFrame = event.sender?.mainFrame;
    if (!senderFrame || !mainFrame
      || senderFrame.processId !== mainFrame.processId
      || senderFrame.routingId !== mainFrame.routingId) {
      throw new Error("当前页面无权读取本地知识文件夹。");
    }
    const senderUrl = String(senderFrame.url ?? event.sender?.getURL?.() ?? "");
    let sender;
    try {
      sender = new URL(senderUrl);
    } catch {
      throw new Error("当前页面无权读取本地知识文件夹。");
    }
    let authorized = sender.protocol === "cheater:" && sender.hostname === "localhost";
    if (!authorized && process.env.ELECTRON_RENDERER_URL) {
      try {
        authorized = sender.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin;
      } catch {
        authorized = false;
      }
    }
    if (!authorized) {
      throw new Error("当前页面无权读取本地知识文件夹。");
    }
    const result = await dialog.showOpenDialog({
      title: "选择要导入知识库的文件夹",
      buttonLabel: "扫描并导入",
      properties: ["openDirectory", "dontAddToRecent"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return scanKnowledgeFolder(result.filePaths[0], { ocr });
  });
}

function registerAiSettingsIpc(settingsStore, service, speechService) {
  ipcMain.handle("ai-settings:get", () => settingsStore.getPublicSettings());
  ipcMain.handle("ai-settings:save", (_event, input) => settingsStore.save(input));
  ipcMain.handle("ai-settings:clear-key", () => settingsStore.clearApiKey());
  ipcMain.handle("ai-settings:test", async () => {
    const requestedChecks = [
      { name: "回答模型", promise: service.testFastConnection() },
      { name: "图片模型", promise: service.testFastVisionConnection() },
      { name: "Embedding", promise: service.embed(["面试模型连接测试"]) },
      { name: "实时语音", promise: speechService.testConnection() },
    ];

    const checks = await Promise.allSettled(requestedChecks.map((check) => check.promise));
    const names = requestedChecks.map((check) => check.name);
    const components = Object.fromEntries(checks.map((result, index) => {
      if (result.status === "fulfilled") {
        const detail = names[index] === "Embedding"
          ? `${result.value.vectors[0]?.length ?? 0} 维`
          : result.value.reply ?? "已就绪";
        return [names[index], { ok: true, detail }];
      }
      return [names[index], {
        ok: false,
        detail: result.reason?.publicMessage ?? result.reason?.message ?? "连接失败",
      }];
    }));
    const message = Object.entries(components)
      .map(([name, result]) => `${name}${result.ok ? "✓" : "✗"} ${result.detail}`)
      .join("；");
    return { ok: checks.every((result) => result.status === "fulfilled"), components, message };
  });
}

function seedDesktopPreferences(directory, localApiToken) {
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, "cheater-desktop-v1.json");
  const legacyFilePath = join(directory, "aether-desktop-v4.json");
  let current = {};
  const sourcePath = existsSync(filePath) ? filePath : legacyFilePath;
  if (existsSync(sourcePath)) {
    try {
      current = JSON.parse(readFileSync(sourcePath, "utf8"));
    } catch {
      current = {};
    }
  }
  const next = {
    ...current,
    onboard: {
      ...(current.onboard ?? {}),
      completed: true,
      milestones: { welcome: true, account: true, permissions: true },
    },
    onboarding: { ...(current.onboarding ?? {}), completed: true },
    auth: { access_token: localApiToken },
    locale: current.locale ?? "zh-CN",
  };
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
