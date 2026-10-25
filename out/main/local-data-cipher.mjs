import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MAGIC = Buffer.from("CHEATER-ENC-1\n", "utf8");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class LocalDataCipher {
  constructor({ keyFilePath, safeStorage }) {
    this.keyFilePath = keyFilePath;
    this.safeStorage = safeStorage;
    this.key = null;
  }

  async initialize() {
    if (!(await encryptionAvailable(this.safeStorage))) {
      throw new Error("系统安全存储不可用，Cheater 不会以明文方式保存面试数据。");
    }
    try {
      const envelope = JSON.parse(await readFile(this.keyFilePath, "utf8"));
      if (envelope?.version !== 1 || typeof envelope.protectedKey !== "string") {
        throw new Error("本地数据密钥文件格式无效。");
      }
      this.key = Buffer.from(await decryptProtected(this.safeStorage, envelope.protectedKey), "base64");
      if (this.key.byteLength !== KEY_BYTES) throw new Error("本地数据密钥长度无效。");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.key = randomBytes(KEY_BYTES);
      const protectedKey = await encryptProtected(this.safeStorage, this.key.toString("base64"));
      await mkdir(dirname(this.keyFilePath), { recursive: true });
      const temporaryPath = `${this.keyFilePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify({ version: 1, protectedKey })}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.keyFilePath);
    }
    return this;
  }

  isEncrypted(value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
    return bytes.subarray(0, MAGIC.length).equals(MAGIC);
  }

  encryptText(value) {
    return this.encryptBuffer(Buffer.from(String(value ?? ""), "utf8")).toString("utf8");
  }

  decryptText(value) {
    const bytes = Buffer.from(String(value ?? ""), "utf8");
    return this.isEncrypted(bytes) ? this.decryptBuffer(bytes).toString("utf8") : bytes.toString("utf8");
  }

  encryptBuffer(value) {
    if (!this.key) throw new Error("本地数据加密器尚未初始化。");
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);
    const envelope = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    return Buffer.concat([MAGIC, Buffer.from(envelope.toString("base64"), "utf8")]);
  }

  decryptBuffer(value) {
    if (!this.key) throw new Error("本地数据加密器尚未初始化。");
    const bytes = Buffer.from(value);
    if (!this.isEncrypted(bytes)) return bytes;
    const envelope = Buffer.from(bytes.subarray(MAGIC.length).toString("utf8"), "base64");
    if (envelope.byteLength < IV_BYTES + TAG_BYTES) throw new Error("本地加密数据已损坏。");
    const tagStart = IV_BYTES;
    const payloadStart = tagStart + TAG_BYTES;
    const encrypted = envelope.subarray(payloadStart);
    const decipher = createDecipheriv("aes-256-gcm", this.key, envelope.subarray(0, tagStart));
    decipher.setAuthTag(envelope.subarray(tagStart, payloadStart));
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}

async function encryptionAvailable(safeStorage) {
  if (typeof safeStorage?.isAsyncEncryptionAvailable === "function") {
    return await safeStorage.isAsyncEncryptionAvailable();
  }
  return safeStorage?.isEncryptionAvailable?.() === true;
}

async function encryptProtected(safeStorage, value) {
  const encrypted = typeof safeStorage.encryptStringAsync === "function"
    ? await safeStorage.encryptStringAsync(value)
    : safeStorage.encryptString(value);
  return Buffer.from(encrypted).toString("base64");
}

async function decryptProtected(safeStorage, value) {
  const bytes = Buffer.from(value, "base64");
  if (typeof safeStorage.decryptStringAsync === "function") {
    const decrypted = await safeStorage.decryptStringAsync(bytes);
    return decrypted.result;
  }
  return safeStorage.decryptString(bytes);
}
