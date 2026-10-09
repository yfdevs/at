import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(packageRoot, "native", "bin");
const python = process.env.JIANYING_DRAFT_PYTHON || "python";
const temporaryRoot = path.join(process.env.TEMP || process.cwd(), "jianying-draft-worker-build");

await mkdir(outputDirectory, { recursive: true });
await execFileAsync(python, [
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--name",
  "JianyingDraftWorker",
  "--distpath",
  outputDirectory,
  "--workpath",
  path.join(temporaryRoot, "work"),
  "--specpath",
  path.join(temporaryRoot, "spec"),
  "--collect-all",
  "pyJianYingDraft",
  path.join(packageRoot, "native", "JianyingDraftWorker.py"),
], {
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024,
});

process.stdout.write(`Built ${path.join(outputDirectory, "JianyingDraftWorker.exe")}\n`);
