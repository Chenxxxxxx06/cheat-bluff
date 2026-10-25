import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OCR_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 30 * 1024 * 1024;

export function createPaddleOcrService(options = {}) {
  const root = options.runtimeDirectory ?? resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../resources/ocr-runtime",
  );
  const python = options.pythonPath ?? join(root, "python", "python.exe");
  const script = options.scriptPath ?? join(root, "ocr_worker.py");
  const bundledModelsDirectory = options.bundledModelsDirectory ?? join(root, "model-cache");
  const ensureBundledModels = async () => {
    const required = ["PP-OCRv5_mobile_det", "PP-OCRv5_mobile_rec"];
    const present = await Promise.all(required.flatMap((name) => ["inference.json", "inference.pdiparams"].map(async (file) => {
      try {
        await access(join(bundledModelsDirectory, "official_models", name, file));
        return true;
      } catch {
        return false;
      }
    })));
    if (present.every(Boolean)) return;
    throw new Error("Cheater 的本地 OCR 模型不完整，请重新安装 OCR 组件。");
  };
  const isAvailable = async () => {
    try {
      await Promise.all([access(python), access(script)]);
      return true;
    } catch {
      return false;
    }
  };
  const recognize = async (bytes, inputExtension, workerOptions = {}) => {
    if (!(await isAvailable())) {
      throw new Error("本地 PaddleOCR 运行时缺失，请重新安装 Cheater 的 OCR 组件。");
    }
    await ensureBundledModels();
    const jobDirectory = join(tmpdir(), `cheater-ocr-${process.pid}-${randomUUID()}`);
    await mkdir(jobDirectory, { recursive: true });
    const inputPath = join(jobDirectory, `input${inputExtension}`);
    const jobModelDirectory = join(jobDirectory, "model-cache");
    await writeFile(inputPath, bytes, { mode: 0o600 });
    try {
      // Paddle's Windows PIR loader cannot open model paths containing
      // non-ASCII characters. Keep the canonical bundled model in Cheater,
      // stage a private per-job copy, and remove it in the finally block.
      await cp(bundledModelsDirectory, jobModelDirectory, { recursive: true, force: false });
      const payload = await runWorker(python, script, inputPath, jobModelDirectory, workerOptions);
      if (!payload.ok || typeof payload.text !== "string" || !payload.text.trim()) {
        throw new Error(payload.error || "PaddleOCR 没有识别到可检索文字。");
      }
      return payload.text.trim();
    } finally {
      await rm(jobDirectory, { recursive: true, force: true });
    }
  };
  return {
    async isAvailable() {
      return isAvailable();
    },

    async recognizePdf(bytes, options = {}) {
      const pages = normalizePdfPages(options.pages);
      return recognize(bytes, ".pdf", { pages });
    },

    async recognizeImage(bytes, extension = ".png") {
      const normalized = String(extension).toLowerCase().match(/^\.(?:png|jpe?g|bmp|webp)$/)?.[0];
      if (!normalized) throw new Error("PaddleOCR 不支持该图片格式。");
      return recognize(bytes, normalized);
    },
  };
}

function normalizePdfPages(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new TypeError("OCR 页码必须是数组。");
  const pages = [...new Set(value.map(Number))];
  if (!pages.length || pages.length > 1_000
    || pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > 1_000)) {
    throw new Error("OCR 页码范围无效。");
  }
  return pages.sort((left, right) => left - right);
}

function runWorker(python, script, inputPath, cacheDirectory, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const workerArguments = [script, inputPath];
    if (options.pages?.length) workerArguments.push("--pages", options.pages.join(","));
    const child = spawn(python, workerArguments, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PADDLE_PDX_CACHE_HOME: cacheDirectory,
        PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
      },
    });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let settled = false;
    const finish = (error, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolvePromise(payload);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("PaddleOCR 处理超时。"));
    }, OCR_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.byteLength > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("PaddleOCR 输出超过安全限制。"));
      }
    });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (settled) return;
      let payload;
      try {
        payload = JSON.parse(stdout.toString("utf8").trim().split(/\r?\n/).at(-1));
      } catch {
        finish(new Error(stderr.trim() || `PaddleOCR 返回了无效结果（${code}）。`));
        return;
      }
      code === 0 && payload.ok
        ? finish(null, payload)
        : finish(new Error(payload.error || stderr.trim() || `PaddleOCR 失败（${code}）。`));
    });
  });
}
