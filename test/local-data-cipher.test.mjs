import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalDataCipher } from "../out/main/local-data-cipher.mjs";
import { ReplicaDataStore } from "../out/main/local-api/data-store.mjs";

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`os-protected:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^os-protected:/, ""),
};

test("local business data and uploaded bytes are encrypted at rest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cheater-cipher-test-"));
  const keyFilePath = join(directory, "protected-key.json");
  const cipher = await new LocalDataCipher({ keyFilePath, safeStorage: fakeSafeStorage }).initialize();
  const secret = "private interview answer";
  const encrypted = cipher.encryptText(secret);
  assert.doesNotMatch(encrypted, /private interview answer/);
  assert.equal(cipher.decryptText(encrypted), secret);
  const encryptedBytes = cipher.encryptBuffer(Buffer.from(secret));
  assert.equal(cipher.decryptBuffer(encryptedBytes).toString("utf8"), secret);

  const dataDirectory = join(directory, "data");
  const store = await new ReplicaDataStore(dataDirectory, { cipher }).initialize();
  await store.update((state) => state.interviews.push({ id: "encrypted-record", answer: secret }));
  const stored = await readFile(store.filePath, "utf8");
  assert.match(stored, /^CHEATER-ENC-1/);
  assert.doesNotMatch(stored, /private interview answer|encrypted-record/);

  const reopenedCipher = await new LocalDataCipher({ keyFilePath, safeStorage: fakeSafeStorage }).initialize();
  const reopened = await new ReplicaDataStore(dataDirectory, { cipher: reopenedCipher }).initialize();
  assert.equal(reopened.state.interviews[0].answer, secret);
});

test("a failed business-data save rolls back memory and later updates can persist", async (context) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cheater-store-rollback-"));
  const failedTemporaryPath = `${dataDirectory}.${process.pid}.tmp`;
  context.after(async () => {
    await rm(dataDirectory, { recursive: true, force: true });
    await rm(failedTemporaryPath, { force: true });
  });
  const store = await new ReplicaDataStore(dataDirectory).initialize();
  const validFilePath = store.filePath;
  store.filePath = dataDirectory;

  await assert.rejects(
    store.update((state) => state.interviews.push({ id: "must-roll-back" })),
  );
  assert.equal(store.state.interviews.length, 0);

  store.filePath = validFilePath;
  await store.update((state) => state.interviews.push({ id: "persisted-after-failure" }));
  assert.deepEqual(store.state.interviews.map((item) => item.id), ["persisted-after-failure"]);
  const reopened = await new ReplicaDataStore(dataDirectory).initialize();
  assert.deepEqual(reopened.state.interviews.map((item) => item.id), ["persisted-after-failure"]);
});
