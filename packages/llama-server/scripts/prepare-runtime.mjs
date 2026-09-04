import { spawn } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const manifest = JSON.parse(await readFile(path.join(packageRoot, "runtime-manifest.json"), "utf8"));
const runtimeDirectory = path.join(packageRoot, "vendor", "win-x64");
const executablePath = path.join(runtimeDirectory, "llama-server.exe");
const archivePath = path.join(workspaceRoot, ".cache", "llama-server-downloads", manifest.archive);
const checkOnly = process.argv.includes("--check");

async function sha256(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function validateRuntime() {
  await access(executablePath);
  const files = await readdir(runtimeDirectory);
  const dllFiles = files.filter((file) => file.toLowerCase().endsWith(".dll"));
  if (dllFiles.length === 0) {
    throw new Error(`llama.cpp runtime DLLs are missing from ${runtimeDirectory}`);
  }

  const output = await new Promise((resolve, reject) => {
    const child = spawn(executablePath, ["--version"], {
      cwd: runtimeDirectory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let text = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("llama-server --version timed out."));
    }, 15_000);
    child.stdout.on("data", (chunk) => { text += chunk.toString(); });
    child.stderr.on("data", (chunk) => { text += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(text.trim());
      else reject(new Error(`llama-server --version exited with code ${code}: ${text.trim()}`));
    });
  });

  const totalBytes = (await Promise.all(
    files.map(async (file) => (await stat(path.join(runtimeDirectory, file))).size),
  )).reduce((total, size) => total + size, 0);
  console.log(`Validated bundled llama.cpp ${manifest.version}: ${files.length} files, ${totalBytes} bytes.`);
  console.log(output.split(/\r?\n/, 1)[0]);
}

async function ensureArchive() {
  await mkdir(path.dirname(archivePath), { recursive: true });
  const existingHash = await sha256(archivePath).catch(() => "");
  if (existingHash === manifest.sha256) return;
  if (existingHash) await rm(archivePath, { force: true });

  console.log(`Downloading llama.cpp ${manifest.version} Windows x64 CPU runtime...`);
  const response = await globalThis.fetch(manifest.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Cannot download ${manifest.url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(archivePath));

  const downloadedHash = await sha256(archivePath);
  if (downloadedHash !== manifest.sha256) {
    await rm(archivePath, { force: true });
    throw new Error(`llama.cpp archive SHA-256 mismatch: expected ${manifest.sha256}, received ${downloadedHash}`);
  }
}

async function extractRuntime() {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "autodrama-llama-server-"));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("tar", ["-xf", archivePath, "-C", temporaryDirectory], {
        shell: false,
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => code === 0
        ? resolve()
        : reject(new Error(`tar exited with code ${code}`)));
    });

    const extractedFiles = await readdir(temporaryDirectory, { withFileTypes: true });
    const sourceDirectory = extractedFiles.length === 1 && extractedFiles[0].isDirectory()
      ? path.join(temporaryDirectory, extractedFiles[0].name)
      : temporaryDirectory;
    const runtimeFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((file) => file === "llama-server.exe" || file.toLowerCase().endsWith(".dll"));

    if (!runtimeFiles.includes("llama-server.exe")) {
      throw new Error(`Archive does not contain llama-server.exe: ${archivePath}`);
    }

    await rm(runtimeDirectory, { recursive: true, force: true });
    await mkdir(runtimeDirectory, { recursive: true });
    await Promise.all(runtimeFiles.map((file) => cp(
      path.join(sourceDirectory, file),
      path.join(runtimeDirectory, file),
    )));
    await cp(
      path.join(packageRoot, "LLAMA_CPP_LICENSE.txt"),
      path.join(runtimeDirectory, "LICENSE.llama.cpp.txt"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  if (!checkOnly) {
    await ensureArchive();
    await extractRuntime();
  }
  await validateRuntime();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
