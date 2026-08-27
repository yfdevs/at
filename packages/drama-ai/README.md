# @drama/ai

平台无关的 AI 能力包。通过 OpenAI Node SDK 连接任意 OpenAI 兼容模型服务，为各平台自动化复用文本生成、封面识别等能力。

```ts
import { createOpenAiCompatibleClient } from "@drama/ai";

const ai = createOpenAiCompatibleClient({
  apiKey: projectConfig.aiApiKey,
  baseURL: projectConfig.aiBaseURL,
  model: projectConfig.aiModel,
});

const result = await ai.analyzeImages({
  images: [{ type: "file", path: coverPath }],
  prompt: "识别封面中的剧名",
});
```

`apiKey`、`baseURL` 和 `model` 均由应用主进程从项目配置注入，不从环境变量读取。分析图片时，应使用服务商提供的、支持视觉输入的模型。

为了兼容既有调用，包内仍保留 `createDoubaoAiClient` 和豆包默认地址；新代码优先使用通用的 `createOpenAiCompatibleClient`。
