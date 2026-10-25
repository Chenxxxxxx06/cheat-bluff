import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronCache = resolve(projectDirectory, ".cache", "electron");
const builderCache = resolve(projectDirectory, ".cache", "electron-builder");
await Promise.all([
  mkdir(electronCache, { recursive: true }),
  mkdir(builderCache, { recursive: true }),
]);

const cli = resolve(projectDirectory, "node_modules", "electron-builder", "out", "cli", "cli.js");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: projectDirectory,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_CACHE: electronCache,
    ELECTRON_BUILDER_CACHE: builderCache,
  },
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`electron-builder stopped by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
