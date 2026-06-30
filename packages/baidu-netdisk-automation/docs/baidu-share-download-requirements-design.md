# 百度网盘分享目录自动下载需求与实现设计

## 1. 文档目的

本文说明当前 `src/download-baidu-folder.ts` 的需求背景、功能边界、实现思路和核心原理，方便后续维护、排查和扩展。

当前实现的目标不是做一个通用网盘爬虫，而是在 Windows 环境中，借助百度网盘客户端自身的 Electron 页面和 Chromium DevTools Protocol（CDP），自动完成“读取分享链接 -> 输入提取码 -> 保存到我的网盘 -> 调用客户端下载 -> 等待本地下载完成”的流程。

## 2. 背景与问题

百度网盘分享目录的完整下载通常需要人工完成以下步骤：

1. 打开分享链接。
2. 输入提取码。
3. 进入分享文件列表。
4. 将分享目录保存到自己的网盘。
5. 回到百度网盘客户端文件列表。
6. 选择保存后的目录并点击下载。
7. 在下载路径确认窗口中确认。
8. 等待客户端下载完成。

如果用固定坐标或键盘模拟实现，稳定性会受窗口位置、缩放比例、弹窗遮挡、焦点状态影响。当前实现改为直接连接百度网盘 Electron 的 CDP 调试端口，通过 DOM、页面内数据和客户端页面事件完成操作，尽量减少对屏幕坐标的依赖。

## 3. 需求范围

### 3.1 功能需求

当前脚本需要支持：

- 从文本文件中读取百度网盘分享链接、提取码和分享文件名。
- 校验指定 CDP 端口确实属于百度网盘客户端。
- 通过 CDP 打开或复用百度网盘分享页面。
- 自动输入提取码并进入分享文件列表。
- 将分享目录保存到用户自己的百度网盘根目录。
- 如果目标目录已经在自己网盘中存在，则跳过重复保存。
- 在百度网盘客户端文件列表中定位保存后的目录。
- 选择该目录并点击客户端下载按钮。
- 识别独立下载设置窗口并确认下载。
- 根据客户端已完成列表或本地文件系统状态判断下载是否完成。
- 支持已有本地目录的幂等处理，避免无意义重复点击下载。

### 3.2 非目标

当前脚本不做以下事情：

- 不绕过百度验证码。
- 不破解百度网盘下载限制。
- 不直接解析或下载百度网盘文件真实下载地址。
- 不模拟登录，也不管理账号状态。
- 不做跨平台桌面自动化，当前实现明确限定 Windows。
- 不保证百度网盘客户端升级后选择器和页面全局变量仍然可用。

## 4. 运行前提

### 4.1 系统环境

- 操作系统：Windows。
- Node.js：需要支持内置 `fetch`、`WebSocket` 和 `AbortController` 的版本。
- 百度网盘客户端：需要已登录。
- 百度网盘客户端需要手动以远程调试端口启动，例如：

```powershell
$engineDir = "$env:APPDATA\baidu\BaiduNetdisk\module\BrowserEngine"
Start-Process -WorkingDirectory $engineDir -FilePath "$engineDir\BaiduNetdiskUnite.exe" -ArgumentList "--remote-debugging-port=9337"
```

Windows 版百度网盘的 `BaiduNetdisk.exe` 不会把 `--remote-debugging-port` 可靠传给实际 Electron 内核进程；需要直接启动 `module\BrowserEngine\BaiduNetdiskUnite.exe`。脚本只检测指定 CDP 端口是否可用，不负责启动或重启客户端。如果客户端已经用不带调试端口的方式启动，需要先退出百度网盘后手动重启。

### 4.2 输入文件

默认读取项目根目录下的 `baudi.txt`，格式示例：

```text
通过网盘分享的文件：寻壶乌龙
链接: https://pan.baidu.com/s/xxxx?pwd=abcd 提取码: abcd
```

脚本会从文本中提取：

- 分享链接：匹配 `https://pan.baidu.com/s/...`。
- 提取码：优先读取 URL 中的 `pwd`，其次读取文本里的“提取码 / 密码 / pwd”。
- 文件名：优先读取“通过网盘分享的文件：...”或“分享的文件：...”。

### 4.3 命令参数

默认命令：

```powershell
pnpm download:baidu-share
```

可选参数：

```powershell
pnpm download:baidu-share -- --share-file=baudi.txt
pnpm download:baidu-share -- --port=9337
pnpm download:baidu-share -- --wait-complete-ms=0
pnpm download:baidu-share -- --force-click
```

参数含义：

- `--share-file`：指定分享文本文件，默认 `baudi.txt`。
- `--port`：指定百度网盘 CDP 端口，默认 `9337`。
- `--wait-complete-ms`：等待本地下载完成的最长时间，默认 1 小时；小于等于 0 时只提交下载任务，不等待完成。
- `--force-click`：即使检测到本地已有下载目录，也继续走保存和下载点击流程。

## 5. 总体流程

核心流程如下：

```text
读取分享文本
  -> 解析分享链接、提取码、文件名
  -> 检查本地是否已有目标下载目录
  -> 将分享文本复制到剪贴板
  -> 校验 CDP 端口是否属于百度网盘
  -> 打开或复用分享页
  -> 输入提取码
  -> 等待分享文件列表
  -> 调用页面内接口保存到我的网盘
  -> 打开客户端文件列表
  -> 选中保存后的目录
  -> 点击客户端下载
  -> 等待下载设置窗口
  -> 点击确认下载
  -> 判断客户端是否已完成
  -> 轮询本地文件系统直到下载完成
```

## 6. 模块设计

### 6.1 参数与分享信息解析

相关函数：

- `getArg`
- `numberArg`
- `readShareInfo`
- `sanitizeWindowsName`

设计要点：

- 命令行参数只做最小解析，不引入额外依赖。
- 分享文件名会经过 Windows 文件名非法字符过滤。
- 提取码优先从 URL `pwd` 中读取，因为这是百度分享链接最稳定的来源。

### 6.2 CDP 端口校验

相关函数：

- `getJson`
- `getTargets`
- `isBaiduCdpPort`
- `ensureBaiduCdpPort`

实现逻辑：

1. 请求 `http://127.0.0.1:{port}/json/version`。
2. 请求 `http://127.0.0.1:{port}/json/list`。
3. 通过 `User-Agent` 和 target URL 判断是否是百度网盘客户端。

判断依据包括：

- `User-Agent` 中包含 `baidunetdisk`。
- target URL 中包含 `BaiduNetdisk`、`core.asar` 或 `pan.baidu.com`。

这样可以避免误连到其他 Chrome、Edge 或 Electron 应用的调试端口。

### 6.3 CDP 页面封装

相关类型和类：

- `CdpTarget`
- `CdpMessage`
- `CdpPage`
- `withPage`
- `waitForTarget`

`CdpPage` 是脚本里的轻量 CDP 客户端，职责包括：

- 建立 WebSocket 连接。
- 启用 `Runtime` 和 `Page` 域。
- 发送 CDP 命令。
- 执行页面 JS 表达式。
- 发起页面跳转。
- 通过 `Input.dispatchMouseEvent` 点击指定坐标。

脚本没有引入 Puppeteer 或 Playwright，是因为当前操作只需要少量 CDP 能力，直接封装 WebSocket 更轻量，也能减少安装和运行依赖。

### 6.4 打开分享页与输入提取码

相关函数：

- `shareId`
- `openSharePage`
- `enterShareCode`
- `waitForShareList`

实现逻辑：

1. 根据分享链接解析分享 ID。
2. 在已有 target 中查找是否已经打开该分享页。
3. 如果没有，则复用百度网盘中的 `pan.baidu.com` webview 或 `core.asar` 页面并执行 `Page.navigate`。
4. 如果页面 URL 处于 `share/init`，说明需要输入提取码。
5. 通过 DOM 找到 `#accessCode` 和 `#submitBtn`，写入提取码并派发输入和点击事件。
6. 轮询页面状态，直到 URL 包含 `#list` 或正文出现“全部文件”。

验证码处理：

- 如果页面出现“请输入验证码”，脚本直接报错。
- 这是有意设计，脚本不会尝试绕过验证码。

### 6.5 保存分享到自己的网盘

相关函数：

- `saveShareToOwnNetdisk`

实现原理：

分享页加载后，百度前端页面中会暴露一些运行时数据，例如：

- `globalThis.metaData`
- `globalThis.yunData`
- `globalThis.locals`

脚本从这些数据中提取：

- `bdstoken`
- `shareid`
- `share_uk`
- 分享文件的 `fs_id`
- 当前分享凭证 `sekey`

然后执行两类页面内请求：

1. 用 `/api/search` 在自己的网盘中查找是否已经存在同名目录。
2. 如果不存在，则调用 `/share/transfer` 将分享目录保存到自己的网盘根目录。

这里使用页面内 `fetch`，并带上 `credentials: "include"`，让请求自动复用百度网盘客户端当前登录态和 cookie。脚本不直接读取账号密码，也不保存登录凭据。

幂等策略：

- 如果根目录已有同名文件或目录，认为已经保存过。
- 如果没有，则保存。
- 保存后再次搜索确认目标存在。

### 6.6 调用客户端下载

相关函数：

- `openOwnFileList`
- `downloadOwnFolderFromClientPage`
- `confirmDownloadSetting`
- `waitForDownloadSubmitted`

实现逻辑：

1. 找到百度网盘客户端原生页面，即 URL 包含 `core.asar` 的 target。
2. 将页面 hash 切到 `#/?category=all&path=`，进入全部文件列表。
3. 在 `.itemWrap` 行中查找包含目标目录名的行。
4. 点击该行的 checkbox 或行本身，使目录进入选中状态。
5. 点击 `.downloadBtn`。
6. 等待独立的 `#/downloadingSetting` target 出现。
7. 在该 target 中读取下载路径文本，并点击 `.down-btn` 确认下载。
8. 等待下载设置窗口关闭，确认下载任务已提交。

关键点：

- 百度网盘的下载设置窗口不是原页面内的普通弹层，而是一个独立 Electron 页面。
- 所以点击下载后不能继续在原 target 中查找确认按钮，必须重新扫描 CDP target。
- 点击确认后该 target 可能立即关闭，脚本允许页面关闭作为正常结果。

### 6.7 下载完成判断

相关函数：

- `isCompletedInClient`
- `sharePageNeedsDownloadCaptcha`
- `candidateDownloadRoots`
- `findExistingDownloadPath`
- `getDownloadStatus`
- `walkDownload`
- `isPartialName`
- `waitForLocalDownloadComplete`

判断分两层：

1. 客户端层：如果传输页面“已完成”列表中已经出现目标文件名，则认为成功。
2. 文件系统层：轮询本地下载目录，直到文件存在、文件数大于 0、没有临时下载文件，并且连续两次状态稳定。

候选下载目录按优先级包括：

- 下载设置窗口中解析出的路径。
- 环境变量 `BAIDU_DOWNLOAD_DIR`。
- `D:\BaiduNetdiskDownload`。
- `%USERPROFILE%\Downloads`。
- `%USERPROFILE%\BaiduNetdiskDownload`。
- `C:\BaiduNetdiskDownload`。

临时文件判断包括：

- 文件名包含 `.downloading`。
- 文件名以 `.baiduyun.p.downloading` 结尾。
- 文件名以 `.bdtmp` 结尾。
- 文件名以 `.tmp` 结尾。

## 7. 核心原理

### 7.1 为什么使用 CDP

百度网盘客户端是 Electron 应用。Electron 内部页面基于 Chromium，可以通过启动参数暴露 DevTools 调试端口。

CDP 能做的事情包括：

- 列出当前 Electron 页面。
- 对目标页面执行 JavaScript。
- 读取 DOM 文本和元素位置。
- 触发页面跳转。
- 派发鼠标事件。

相比固定坐标点击，CDP 的优势是：

- 不依赖屏幕分辨率和窗口位置。
- 可以直接判断页面文本和 URL。
- 可以操作隐藏在 Electron webview 中的 DOM。
- 可以调用页面内接口并复用当前登录态。

### 7.2 为什么先保存到自己的网盘

直接在分享页点击下载容易遇到验证码或网页侧限制。当前方案改成：

1. 先把分享目录保存到自己的网盘。
2. 再从百度网盘客户端自己的文件列表中发起下载。

这样下载动作由客户端完成，脚本只负责把客户端引导到正确状态。

### 7.3 为什么使用页面内接口

`/share/transfer` 是百度分享页自身会使用的接口。脚本在分享页上下文中调用它，具备两个好处：

- 自动带上登录 cookie 和页面上下文。
- 不需要脚本保存或暴露账号凭据。

脚本调用的是客户端页面已经具备权限访问的接口，不做额外鉴权绕过。

### 7.4 为什么还要监控本地文件

客户端下载任务提交成功不等于下载完成。尤其是大目录下载时，客户端可能已经关闭设置窗口，但文件还在持续写入。

因此脚本在提交任务后继续检查本地目录：

- 目录是否存在。
- 是否已有实际文件。
- 是否还存在下载临时文件。
- 文件数、总大小、最后写入时间是否稳定。

连续稳定两次后才认为本地下载完成，降低误判概率。

## 8. 异常与边界处理

### 8.1 CDP 不可用

如果指定端口没有响应，或响应不像百度网盘客户端，脚本直接报错：

```text
端口 9337 不是可用百度网盘 CDP。请先退出百度网盘，再手动使用 --remote-debugging-port=9337 启动客户端。
```

### 8.2 分享文件格式不正确

如果输入文件缺少分享链接或提取码，脚本直接报错，避免进入不确定 UI 状态。

### 8.3 验证码

如果分享页或下载页出现验证码，脚本停止并提示。验证码需要用户手动处理后重试。

### 8.4 选择器失效

当前实现依赖以下页面结构：

- 分享提取码输入框：`#accessCode`
- 分享提取按钮：`#submitBtn`
- 客户端文件行：`.itemWrap`
- 客户端下载按钮：`.downloadBtn`
- 下载确认按钮：`.down-btn`

如果百度网盘升级导致 class 或 DOM 结构变化，需要更新对应选择器。

### 8.5 重复下载

默认情况下，如果本地已经存在目标目录且其中有文件，脚本会优先等待该目录完成，而不是再次点击下载。需要强制重新触发客户端时，可以传 `--force-click`。

## 9. 安全与合规原则

当前实现遵循以下原则：

- 只连接 `127.0.0.1` 本机 CDP 端口。
- 校验端口确实属于百度网盘，避免误操作其他浏览器。
- 不保存账号、密码、cookie 或 token 到本地文件。
- 不绕过验证码。
- 不伪造底层下载地址。
- 不删除本地文件。
- 不自动修改百度网盘客户端设置。

## 10. 可维护性建议

后续如果继续扩展，建议优先处理：

1. 将 CDP 客户端封装拆成独立模块，便于复用和单测。
2. 为百度 DOM 选择器集中定义常量，升级时更容易维护。
3. 增加 `--dry-run`，只完成解析和 CDP 端口校验。
4. 增加更明确的日志级别，例如 `info`、`debug`、`error`。
5. 为分享文本解析增加更多样例测试。
6. 把下载根目录显式参数化，例如新增 `--download-dir`。

## 11. 当前实现文件

- 核心脚本：`src/download-baidu-folder.ts`
- 默认分享文件：`baudi.txt`
- npm 脚本：`package.json` 中的 `download:baidu-share`
- 相关历史记录：`docs/baidu-netdisk-electron-cdp.md`
