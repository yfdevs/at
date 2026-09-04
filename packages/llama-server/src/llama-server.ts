import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { buildLlamaServerArguments } from "./arguments.js";
import { LlamaServerError } from "./errors.js";
import { checkLlamaServerHealth } from "./health.js";
import type {
  LlamaServerConnection,
  LlamaServerOptions,
  LlamaServerState,
} from "./types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const HEALTH_POLL_INTERVAL_MS = 250;
const MAX_RECENT_OUTPUT_LENGTH = 16_384;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatHostForURL(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function assertFile(
  filePath: string,
  code:
    | "LLAMA_SERVER_EXECUTABLE_NOT_FOUND"
    | "LLAMA_SERVER_MODEL_NOT_FOUND"
    | "LLAMA_SERVER_MM_PROJ_NOT_FOUND",
): Promise<void> {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile()) return;
  } catch (error) {
    throw new LlamaServerError(code, `File does not exist: ${filePath}`, { cause: error });
  }
  throw new LlamaServerError(code, `Path is not a file: ${filePath}`);
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

export class LlamaServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private recentOutput = "";
  private startPromise: Promise<this> | null = null;
  private stopPromise: Promise<void> | null = null;
  private _state: LlamaServerState = "idle";

  readonly executablePath: string;
  readonly modelPath: string;
  readonly multimodalProjectorPath: string | undefined;
  readonly cwd: string;
  readonly host: string;
  readonly port: number;
  readonly modelAlias: string;
  readonly baseURL: string;
  readonly openAiBaseURL: string;

  constructor(readonly options: LlamaServerOptions) {
    this.executablePath = path.resolve(options.executablePath);
    this.modelPath = path.resolve(options.modelPath);
    this.multimodalProjectorPath = options.multimodalProjectorPath
      ? path.resolve(options.multimodalProjectorPath)
      : undefined;
    this.cwd = path.resolve(options.cwd ?? path.dirname(this.executablePath));
    this.host = options.host?.trim() || "127.0.0.1";
    this.port = options.port ?? 8080;
    this.modelAlias = options.modelAlias?.trim() || path.basename(this.modelPath, path.extname(this.modelPath));
    this.baseURL = `http://${formatHostForURL(this.host)}:${this.port}`;
    this.openAiBaseURL = `${this.baseURL}/v1`;

    // Validate all synchronous options at construction time.
    buildLlamaServerArguments({
      ...options,
      multimodalProjectorPath: this.multimodalProjectorPath,
    }, this.modelPath);
  }

  get state(): LlamaServerState {
    return this._state;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get connection(): LlamaServerConnection {
    return {
      baseURL: this.baseURL,
      openAiBaseURL: this.openAiBaseURL,
      apiKey: this.options.apiKey?.trim() || "sk-no-key-required",
      model: this.modelAlias,
    };
  }

  async start(): Promise<this> {
    if (this._state === "running") return this;
    if (this.startPromise) return this.startPromise;
    if (this.stopPromise) await this.stopPromise;

    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (!this.child && !this.startPromise) {
      this._state = "stopped";
      return;
    }

    this.stopPromise = this.stopInternal();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private async startInternal(): Promise<this> {
    this._state = "starting";
    this.recentOutput = "";
    try {
      await Promise.all([
        assertFile(this.executablePath, "LLAMA_SERVER_EXECUTABLE_NOT_FOUND"),
        assertFile(this.modelPath, "LLAMA_SERVER_MODEL_NOT_FOUND"),
        ...(this.multimodalProjectorPath
          ? [assertFile(this.multimodalProjectorPath, "LLAMA_SERVER_MM_PROJ_NOT_FOUND")]
          : []),
      ]);
    } catch (error) {
      this._state = "failed";
      throw error;
    }

    const llamaArguments = buildLlamaServerArguments({
      ...this.options,
      multimodalProjectorPath: this.multimodalProjectorPath,
    }, this.modelPath);
    const child = spawn(
      this.executablePath,
      [...(this.options.launcherArguments ?? []), ...llamaArguments],
      {
        cwd: this.cwd,
        env: process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;
    const spawnFailure: { error?: Error } = {};

    child.once("error", (error) => {
      spawnFailure.error = error;
    });
    child.stdout.on("data", (chunk: Buffer) => this.recordOutput("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => this.recordOutput("stderr", chunk));
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this._state !== "stopping" && this._state !== "stopped") {
        this._state = "failed";
        this.options.logger?.error?.("llama-server exited", { code, signal });
      }
    });

    this.options.logger?.info?.("starting llama-server", {
      executablePath: this.executablePath,
      host: this.host,
      modelPath: this.modelPath,
      port: this.port,
    });

    try {
      const deadline = Date.now() + (this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
      while (Date.now() < deadline) {
        if (this.isStoppingOrStopped()) {
          throw new LlamaServerError("LLAMA_SERVER_START_FAILED", "llama-server startup was stopped.");
        }
        if (spawnFailure.error) {
          throw new LlamaServerError(
            "LLAMA_SERVER_START_FAILED",
            `Cannot start llama-server: ${spawnFailure.error.message}`,
            { cause: spawnFailure.error },
          );
        }
        if (child.exitCode !== null || child.signalCode !== null || this.child !== child) {
          throw new LlamaServerError(
            "LLAMA_SERVER_START_FAILED",
            `llama-server exited before becoming ready.${this.outputSuffix()}`,
          );
        }

        const health = await checkLlamaServerHealth(this.baseURL);
        if (health.status === "ready") {
          this._state = "running";
          this.options.logger?.info?.("llama-server is ready", {
            baseURL: this.baseURL,
            pid: child.pid,
          });
          return this;
        }
        await sleep(HEALTH_POLL_INTERVAL_MS);
      }

      throw new LlamaServerError(
        "LLAMA_SERVER_START_TIMEOUT",
        `llama-server did not become ready within ${this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS}ms.${this.outputSuffix()}`,
      );
    } catch (error) {
      if (!this.isStoppingOrStopped()) this._state = "failed";
      if (this.child === child && child.exitCode === null && child.signalCode === null) child.kill();
      if (error instanceof LlamaServerError) throw error;
      throw new LlamaServerError(
        "LLAMA_SERVER_START_FAILED",
        `Failed to start llama-server: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  private async stopInternal(): Promise<void> {
    this._state = "stopping";
    const child = this.child;

    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      child.kill("SIGTERM");
      const exited = await waitForExit(child, this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
      if (!exited) {
        this.options.logger?.warn?.("llama-server did not stop gracefully; forcing termination", {
          pid: child.pid,
        });
        child.kill("SIGKILL");
        await waitForExit(child, 1_000);
      }
    }

    if (this.startPromise) await this.startPromise.catch(() => undefined);
    if (this.child === child) this.child = null;
    this._state = "stopped";
    this.options.logger?.info?.("llama-server stopped");
  }

  private recordOutput(source: "stdout" | "stderr", chunk: Buffer): void {
    const message = chunk.toString("utf8");
    this.recentOutput = `${this.recentOutput}${message}`.slice(-MAX_RECENT_OUTPUT_LENGTH);
    this.options.onLog?.({ message, source });
    this.options.logger?.debug?.("llama-server output", { message: message.trimEnd(), source });
  }

  private isStoppingOrStopped(): boolean {
    const state: LlamaServerState = this._state;
    return state === "stopping" || state === "stopped";
  }

  private outputSuffix(): string {
    const output = this.recentOutput.trim();
    return output ? `\nRecent output:\n${output}` : "";
  }
}

export async function startLlamaServer(options: LlamaServerOptions): Promise<LlamaServer> {
  const server = new LlamaServer(options);
  return server.start();
}
