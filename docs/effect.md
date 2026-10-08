# Effect 是什么？适用场景与示例

先说结论：

**Effect 是一个帮助 TypeScript 开发者编写“更可靠的异步业务程序”的库。**

它不是 React 的 `useEffect`，也不是做网页视觉特效的。它主要解决后端、Node.js、Electron、自动化脚本里这些麻烦：

- 网络请求可能失败
- 错误类型不清楚
- 任务需要重试、超时
- 多个异步任务需要控制并发
- 数据库、浏览器等资源必须可靠释放
- 业务依赖难以替换、难以测试
- 日志、链路追踪散落各处

官方把它概括为：用一个可组合的核心，同时处理类型化错误、结构化并发、资源安全和可观测性。

- [Effect 官方文档](https://www.effect.website/docs/v4/onboarding)

## 最核心的理解

普通 Promise 只告诉 TypeScript“成功会返回什么”：

```ts
function getUser(id: string): Promise<User>
```

你看不出来：

- 可能出现什么错误？
- 需要数据库还是 HTTP 客户端？
- 能不能重试？
- 能不能取消？
- 超时以后任务是否仍在后台运行？

Effect 把这些信息放进一个类型：

```ts
Effect<User, UserNotFound | DatabaseError, UserRepository>
```

可以读成：

> 这个程序成功会得到 `User`，可能因为“用户不存在”或者“数据库错误”失败，运行时需要一个 `UserRepository`。

也就是：

```text
Effect<成功结果, 可预期错误, 运行所需依赖>
```

官方称之为 `Effect<Success, Error, Requirements>`。

- [Effect 类型说明](https://www.effect.website/docs/v4/getting-started/the-effect-type)

特别关键的一点是：

> Effect 首先是“程序的描述”，创建后不会立即执行；最后交给 Effect Runtime 执行。

这使得“重试、超时、并发、日志”等行为都可以组合到程序描述上。

## 场景一：调用不稳定的第三方 API

普通写法经常逐渐变成这样：

```ts
async function requestAI(prompt: string) {
  try {
    return await fetchAI(prompt)
  } catch (error) {
    // 等一下
    // 重试几次？
    // 哪些错误可以重试？
    // 是否需要指数退避？
    // 总时长是否应该有限制？
  }
}
```

Effect 可以表达成：

```ts
const requestAI = Effect.tryPromise({
  try: () => fetchAI(prompt),
  catch: cause => new AiRequestError({ cause })
}).pipe(
  Effect.retry({
    times: 3,
    schedule: Schedule.exponential("500 millis")
  }),
  Effect.timeout("10 seconds")
)
```

它表达的是：

1. 调用 AI 接口；
2. 将失败转成明确的 `AiRequestError`；
3. 指数退避重试三次；
4. 最多执行十秒。

适合：

- AI 服务
- 支付接口
- 短信、邮件服务
- 云存储上传
- 第三方开放平台
- 微服务之间的 HTTP 请求

## 场景二：短剧自动发布程序

Effect 和 Electron + Playwright 自动化项目很搭。

例如发布一个视频可能出现：

```ts
type PublishError =
  | LoginExpired
  | UploadFailed
  | PageChanged
  | PublishTimeout
  | AccountLimited
```

Effect 可以让发布流程写成一个线性工作流：

```ts
const publishVideo = Effect.gen(function* () {
  const browser = yield* BrowserService
  const account = yield* AccountService

  yield* account.ensureLoggedIn()
  yield* browser.openCreatorPage()
  yield* browser.uploadVideo(video.path)
  yield* browser.fillDescription(video.description)
  yield* browser.publish()

  return {
    videoId: video.id,
    status: "published" as const
  }
})
```

然后分别决定错误策略：

```ts
const reliablePublish = publishVideo.pipe(
  Effect.retry({
    while: error => error._tag === "UploadFailed",
    times: 2
  }),
  Effect.timeout("15 minutes"),
  Effect.catchTag("LoginExpired", () =>
    notifyUserToLoginAgain()
  )
)
```

这样可以明确规定：

- 上传失败：可以重试
- 登录失效：不能盲目重试，需要用户重新登录
- 页面结构变化：保存截图并报告
- 发布超时：取消当前任务
- 无论成功失败：关闭 Page、Context 或 Browser

相比大量嵌套的 `try/catch/finally`，复杂流程会更容易管理。

## 场景三：批量发布，但限制并发

假设有 100 个视频需要处理。

直接使用：

```ts
await Promise.all(videos.map(publishVideo))
```

可能瞬间启动 100 个任务，引起：

- 内存暴涨
- 浏览器开出大量页面
- 平台限流
- 一个失败影响整个批次
- 任务取消后留下后台操作

Effect 可以控制并发数量：

```ts
const publishAll = Effect.forEach(
  videos,
  video => publishVideo(video),
  { concurrency: 3 }
)
```

意思是：

> 一共有 100 个视频，但同时最多处理 3 个。

它还支持顺序、限定数量或者无限并发。Effect 官方把这类能力称为结构化并发；相关 API 能明确控制并发度。

- [并发控制文档](https://www.effect.website/docs/v4/concurrency/basic-concurrency)

这很适合：

- 批量视频发布
- 图片压缩
- 文件上传
- 爬虫
- 消息队列消费者
- 批量调用 AI
- 批量数据库操作

## 场景四：保证浏览器、数据库连接一定被关闭

普通代码通常这样写：

```ts
const browser = await chromium.launch()

try {
  await doWork(browser)
} finally {
  await browser.close()
}
```

简单流程没问题，但当出现并发、取消、超时、嵌套资源时，`try/finally` 会越来越复杂。

Effect 可以把资源的“申请—使用—释放”绑定起来：

```ts
const browser = Effect.acquireRelease(
  Effect.promise(() => chromium.launch()),
  browser => Effect.promise(() => browser.close())
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const instance = yield* browser
    yield* runAutomation(instance)
  })
)
```

这样即使：

- 中途报错
- 任务超时
- 用户取消
- 并发任务被中断

释放逻辑依然会执行。

这种能力特别适合：

- Playwright Browser、Page、Context
- 数据库连接
- 文件句柄
- WebSocket
- 临时目录
- 消息队列消费者

## 场景五：根据错误类型采取不同措施

普通 Promise 的 `catch` 接到的通常是 `unknown`：

```ts
try {
  await publish()
} catch (error) {
  // error 到底是什么？
}
```

Effect 会区分“业务上可预期的错误”和“程序缺陷”。

例如：

```ts
yield* publishVideo.pipe(
  Effect.catchTag("LoginExpired", () => showLoginWindow()),
  Effect.catchTag("UploadFailed", error => saveFailedTask(error)),
  Effect.catchTag("AccountLimited", error => disableAccount(error.accountId))
)
```

编译器能够帮助检查不同错误有没有被处理。

官方明确区分：

- Expected Error：用户输入错误、记录不存在、请求被拒绝等正常业务失败
- Defect：断言失败、不可能状态、第三方库 Bug 等程序缺陷

- [Effect 错误模型](https://www.effect.website/docs/v4/error-management/two-error-types)

## 场景六：依赖注入和测试

假设发布逻辑需要：

- 浏览器服务
- 账号仓库
- 日志服务
- 通知服务

传统项目可能使用全局单例：

```ts
import { db } from "./db"
import { browser } from "./browser"
```

测试时很难替换。

Effect 会让依赖进入类型：

```ts
Effect<PublishResult, PublishError, BrowserService | AccountRepository>
```

生产环境提供真实实现：

```ts
program.pipe(
  Effect.provide(PlaywrightBrowserLive),
  Effect.provide(SqliteAccountRepositoryLive)
)
```

测试提供假实现：

```ts
program.pipe(
  Effect.provide(FakeBrowser),
  Effect.provide(InMemoryAccountRepository)
)
```

因此测试可以做到：

- 不真正打开浏览器
- 不真正上传视频
- 模拟登录过期
- 模拟第三次重试成功
- 模拟超时和用户取消

## Effect 可以粗略理解成什么？

它有一点像把下面这些东西整合到了一套统一模型中：

```text
Promise / async-await
+ Result 类型
+ 类型化错误
+ 依赖注入
+ Retry / Timeout
+ 并发和任务取消
+ 资源生命周期
+ 日志 / Metrics / Tracing
+ Schema 数据校验
+ Stream
```

所以它不是一个“小工具库”，而更接近：

> TypeScript 的应用运行时与基础设施工具箱。

这也是它强大的地方，同时也是学习成本的来源。

## 什么项目值得用？

比较适合：

- Node.js 后端
- Electron 主进程
- Playwright 自动化
- AI Agent 和工作流
- 爬虫、任务调度
- 消息队列消费者
- 微服务
- 需要大量重试、超时、并发和资源管理的系统

不一定值得：

- 简单网页展示
- 只有几个接口的小型 CRUD
- 生命周期很短的一次性脚本
- 团队暂时不愿承担新编程模型的学习成本

## 一句话判断

如果你的代码经常出现这些东西：

```ts
try/catch
Promise.all
setTimeout
AbortController
retry()
finally
各种 Service 单例
大量错误字符串
```

并且它们开始互相缠绕，Effect 很可能有价值。

对于短剧自动发布项目，最值得尝试的切入点不是重写整个应用，而是选择一个边界清晰的流程，例如：

```text
发布单个视频
→ 类型化发布错误
→ 上传失败重试
→ 整体超时
→ 保证关闭 Playwright 资源
→ 记录结构化日志
```

## 版本提醒

Effect 官网目前首页主推的是 **Effect 4.0 Release Candidate**，安装示例是 `effect@rc`。如果准备放进正式项目，需要先决定使用稳定版还是 4.0 RC，不要直接照着不同版本的教程混用 API。

- [Effect 官网](https://www.effect.website/)

