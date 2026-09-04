# @drama/llama-server

平台无关的 llama.cpp `llama-server` 进程托管包。它负责：

- 校验 `llama-server.exe` 与 GGUF 模型路径；
- 使用参数数组安全启动子进程（不经过 shell）；
- 轮询 `/health`，直到模型加载完成；
- 提供可直接交给 OpenAI 兼容客户端的连接信息；
- 优雅停止服务，超时后强制结束；
- 转发 stdout/stderr 日志并暴露稳定的状态与错误码。

包内已固定并内置 llama.cpp `b10728` Windows x64 CPU Runtime，包括
`llama-server.exe`、全部运行时 DLL 和许可证。最终用户不需要安装 llama.cpp；
Electron 安装包会把这些文件部署到 `resources/llama-server/win-x64`。GGUF 模型通常
体积较大，仍由用户在应用全局配置中选择。目前仅在用户主动点击本地模型测试时启动，
不会替换现有平台任务使用的云端文本或图片理解模型。

```ts
import { app } from "electron";
import {
  assertBundledLlamaServerRuntime,
  findAvailableLlamaServerPort,
  startLlamaServer,
} from "@drama/llama-server";

const executablePath = await assertBundledLlamaServerRuntime({
  appRoot: process.env.APP_ROOT!,
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
});

const server = await startLlamaServer({
  executablePath,
  modelPath: localConfig.ggufModelPath,
  modelAlias: "local-drama-model",
  contextSize: 8192,
  port: await findAvailableLlamaServerPort(),
});

// 可传给 @drama/ai：
const aiOptions = {
  apiKey: server.connection.apiKey,
  baseURL: server.connection.openAiBaseURL,
  model: server.connection.model,
};

await server.stop();
```

应用集成默认只监听本机回环地址，并自动选择 `18080–18100` 范围内的空闲端口。
如需额外的 llama.cpp 参数，使用
`additionalArguments`；`--model`、`--host`、`--port` 等由包管理的参数不能重复。
未显式传入 `modelAlias` 时，包会使用 GGUF 文件名作为模型别名，确保返回的连接配置
与 llama-server 暴露的 OpenAI 模型 ID 一致。

llama.cpp 官方服务文档：<https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>

## Runtime 维护

```bash
# 按 runtime-manifest.json 下载、校验并展开固定版本
pnpm --filter @drama/llama-server runtime:prepare

# 校验 exe、DLL 和实际版本
pnpm --filter @drama/llama-server runtime:check

# 使用指定 GGUF 完成一次真实的 @drama/ai 文本推理
pnpm --filter @drama/llama-server runtime:smoke -- D:\models\model.gguf
```
