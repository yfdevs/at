import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const tag = `v${packageJson.version}`;

const worktreeStatus = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();

if (worktreeStatus) {
  throw new Error("工作区还有未提交改动，请提交后再发版。");
}

const currentBranch = execFileSync("git", ["branch", "--show-current"], {
  encoding: "utf8",
}).trim();

if (!currentBranch) {
  throw new Error("当前不在 Git 分支上，无法创建发版标签。");
}

const headCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const localTag = spawnSync("git", ["rev-parse", "--verify", `${tag}^{commit}`], {
  encoding: "utf8",
});

if (localTag.status === 0) {
  const tagCommit = localTag.stdout.trim();
  if (tagCommit !== headCommit) {
    throw new Error(
      `本地标签 ${tag} 已指向其他提交：${tagCommit}；当前提交=${headCommit}。`,
    );
  }
  console.log(`复用已存在且指向当前提交的本地标签 ${tag}。`);
} else {
  execFileSync("git", ["tag", "-a", tag, "-m", `Release ${tag}`], {
    stdio: "inherit",
  });
}

const transientPushError =
  /schannel|ssl\/tls|tls connection|connection reset|recv failure|failed to connect|could not resolve|timed out/i;

async function pushWithRetry(ref) {
  const maximumAttempts = 3;
  let lastOutput = "";

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const result = spawnSync("git", ["push", "origin", ref], {
      encoding: "utf8",
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status === 0) return;

    lastOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    if (!transientPushError.test(lastOutput)) {
      throw new Error(
        `推送 ${ref} 失败（第 ${attempt}/${maximumAttempts} 次）：${lastOutput}`,
      );
    }

    if (attempt === maximumAttempts) break;

    const delayMs = attempt * 3_000;
    console.warn(
      `推送 ${ref} 遇到临时网络错误，${delayMs / 1_000} 秒后重试 ` +
        `(${attempt}/${maximumAttempts})。`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (process.platform === "win32") {
    console.warn(
      `Schannel 连续 ${maximumAttempts} 次推送失败，改用仅本次命令生效的 OpenSSL 后端重试。`,
    );
    const fallbackResult = spawnSync(
      "git",
      ["-c", "http.sslBackend=openssl", "push", "origin", ref],
      { encoding: "utf8" },
    );
    if (fallbackResult.stdout) process.stdout.write(fallbackResult.stdout);
    if (fallbackResult.stderr) process.stderr.write(fallbackResult.stderr);
    if (fallbackResult.status === 0) return;

    lastOutput = `${fallbackResult.stdout ?? ""}\n${fallbackResult.stderr ?? ""}`.trim();
  }

  throw new Error(
    `推送 ${ref} 失败，已用尽安全重试：${lastOutput}`,
  );
}

await pushWithRetry(currentBranch);
await pushWithRetry(tag);

console.log(`已推送 ${tag}，GitHub Actions 将自动构建并发布 Windows 安装包。`);
