下面是对你这个自动化“批量上剧程序”的**工程化需求整理与拆解**，我会按**架构 → 核心流程 → 模块设计 → 技术选型 → 风险点**来做结构化说明，便于你直接进入实现阶段。

---

# 一、总体目标

构建一个基于：

* **TypeScript**
* **pnpm**
* **Playwright**
* **Zod**
* **Pino**

的自动化系统，实现：

> 从后端接口领取“短剧发布任务（scheme）” → 自动打开目标网站 → 填充表单 → 上传视频 → 提交 → 记录结果

---

# 二、核心业务流程（主流程）

```text
[1] 拉取任务 (scheme API)
        ↓
[2] 校验数据结构 (Zod)
        ↓
[3] 本地匹配视频文件 (glob)
        ↓
[4] 校验视频数量/完整性
        ↓
[5] 启动 Playwright 浏览器
        ↓
[6] 登录（如果需要）
        ↓
[7] 打开上传页面
        ↓
[8] 自动填写表单
        ↓
[9] 上传视频文件
        ↓
[10] 提交表单
        ↓
[11] 记录日志 + 状态回传
```

---

# 三、任务数据结构（Scheme）

后端会提供，但你需要**提前定义 Zod schema 做约束**

### 示例（推测字段）

```ts
const SchemeSchema = z.object({
  id: z.string(),
  title: z.string(),            // 剧名
  description: z.string(),      // 简介
  coverImages: z.array(z.string()), // 图片 URL
  episodeCount: z.number(),     // 集数
  tags: z.array(z.string()).optional(),
});
```

### 关键点

* 所有字段必须**严格校验（Zod parse）**
* 不合法 → 直接标记任务失败
* 支持 schema 版本升级（建议加 version 字段）

---

# 四、本地视频匹配规则

### 文件命名规则（你给的例子）

```
我的谁- 第1集.mp4
我的谁- 第2集.mp4
...
```

### 实现策略

#### 1. 使用 glob

```ts
glob(`${baseDir}/${title}- 第*.mp4`)
```

#### 2. 提取集数

```ts
const match = file.match(/第(\d+)集/)
```

#### 3. 校验逻辑

* 文件数量 === `episodeCount`
* 集数连续（1 ~ N）
* 不允许缺集 / 重复

#### 4. 判定失败条件

```text
- 文件数量不匹配
- 存在缺失集数
- 文件名不规范
```

---

# 五、Playwright 自动化设计

## 1. 浏览器策略

* 使用 **Chromium**
* 支持：

  * headless: false（调试）
  * headless: true（生产）

---

## 2. 页面流程拆解

你后面需要用 Chrome DevTools MCP 去确认：

### 关键操作节点：

1. 登录（是否有验证码？）
2. 进入上传页面
3. 表单字段：

   * 剧名
   * 简介
   * 封面上传
   * 标签
4. 视频上传控件（重点）
5. 提交按钮
6. 成功提示

---

## 3. 自动化策略

### 表单填充

```ts
await page.fill('input[name="title"]', scheme.title);
await page.fill('textarea[name="desc"]', scheme.description);
```

---

### 图片上传（URL → 文件）

需要：

```text
URL → download → temp file → upload
```

---

### 视频上传

```ts
await input.setInputFiles(files);
```

⚠️ 注意：

* 多文件上传是否支持
* 是否需要逐个上传
* 是否有进度条等待

---

### 等待机制

必须做：

```ts
await page.waitForSelector(...)
await page.waitForLoadState('networkidle')
```

---

# 六、日志系统设计（Pino）

### 日志分层

```text
INFO  - 正常流程
WARN  - 可恢复问题
ERROR - 任务失败
DEBUG - 调试信息
```

---

### 日志内容建议

```ts
logger.info({
  taskId,
  step: 'upload_video',
  fileCount,
});
```

---

### 必须记录

* 任务ID
* 剧名
* 文件路径
* 错误堆栈
* 执行时间

---

# 七、模块划分（推荐结构）

```text
src/
├── main.ts                # 入口
├── config/               # 配置
├── api/
│   └── fetchScheme.ts    # 拉任务
├── schema/
│   └── scheme.ts         # Zod
├── file/
│   └── matchVideos.ts    # 文件匹配
├── browser/
│   ├── launch.ts
│   ├── login.ts
│   ├── upload.ts
├── utils/
│   ├── logger.ts         # Pino
│   ├── retry.ts
│   └── sleep.ts
├── tasks/
│   └── runTask.ts
```

---

# 八、错误处理策略

### 分类

| 类型   | 处理      |
| ---- | ------- |
| 数据错误 | 直接 fail |
| 文件缺失 | fail    |
| 页面异常 | retry   |
| 上传失败 | retry   |
| 登录失败 | 终止      |

---

### Retry 机制

```ts
retry(fn, { retries: 3, delay: 2000 })
```

---

# 九、并发策略（可选）

初期建议：

```text
串行执行（避免风控）
```

后期：

* 队列 + worker
* 限流（例如 2~3 并发）

---

# 十、关键风险点（非常重要）

## 1. 网站风控

* 自动化检测（Playwright 指纹）
* 上传频率限制
* 登录验证（验证码）

👉 解决：

* 使用真实 user-agent
* 控制速率
* 持久化 cookie

---

## 2. 上传控件复杂

可能情况：

* iframe
* React controlled input
* 分片上传

👉 需要 DevTools 具体分析

---

## 3. 文件过大

* 上传超时
* 浏览器崩溃

👉 需要：

```ts
setDefaultTimeout(0)
```

---

## 4. 页面结构变化

👉 必须：

* selector 抽象
* 可配置化

---

# 十一、下一步建议（你接下来要做）

1. ✅ 用 Playwright 打开网站
2. ✅ 用 Chrome DevTools MCP 分析：

   * 表单字段 selector
   * 上传控件
3. ✅ 确认：

   * 是否支持多文件上传
   * 是否需要逐集提交
4. ✅ 把页面结构发给我（或截图 DOM）

---

# 十二、你这个系统的本质

这是一个：

> **“任务驱动 + 文件系统 + 浏览器自动化 + 强校验”的批处理系统**

核心难点不在代码，而在：

* 页面自动化稳定性
* 文件匹配正确性
* 异常处理

---

如果你下一步把页面 DOM 或 DevTools 信息给我，我可以直接帮你：

* 写 Playwright 具体 selector
* 封装 upload 流程
* 甚至给你一版可运行代码框架
