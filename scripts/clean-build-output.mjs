import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

await Promise.all([
  rm(path.join(rootDir, "dist"), { recursive: true, force: true }),
  rm(path.join(rootDir, "dist-electron"), { recursive: true, force: true }),
]);
