# 百度网盘 Electron 与 CDP 自动化记录

本文记录从“百度网盘是不是 Electron 应用”开始，到最终改成 CDP 自动化下载方案的排查过程。

## 结论

当前 macOS 百度网盘客户端是 Electron 应用，并且可以通过 Chromium DevTools Protocol 自动化操作。

最终方案不再依赖固定屏幕坐标，而是：

1. 用 `--remote-debugging-port=9222` 启动百度网盘。
2. 通过 `http://127.0.0.1:9222/json/list` 找到 Electron 页面。
3. 用 CDP 访问 DOM。
4. 填搜索框、选中目标文件夹、点击下载、确认下载路径。

目标文件夹 `开发者必备的 Docker 实践指南` 已成功下载到：

```text
~/Downloads/开发者必备的 Docker 实践指南
```

## 如何确认它是 Electron

检查本机 App 包：

```bash
find /Applications/BaiduNetdisk.app/Contents -maxdepth 4 \
  \( -iname '*electron*' -o -iname 'app.asar' -o -iname '*.asar' -o -iname 'package.json' \) \
  -print
```

发现了这些关键文件：

```text
/Applications/BaiduNetdisk.app/Contents/Resources/app.asar
/Applications/BaiduNetdisk.app/Contents/Resources/core.asar
/Applications/BaiduNetdisk.app/Contents/Frameworks/Electron Framework.framework
```

`Info.plist` 里也有 Electron 痕迹：

```text
ElectronAsarIntegrity
ElectronTeamID
NSPrincipalClass => AtomApplication
```

运行时 UA 显示：

```text
baidunetdisk/8.5.8 Chrome/116.0.5845.179 Electron/26.2.0
```

所以它是 Electron 应用。

## 为什么 nut-js 坐标方案不可靠

一开始的脚本用 `nut-js` 模拟鼠标键盘：

- 打开百度网盘。
- 点搜索框。
- 粘贴目录名。
- 点第一条结果。
- 点下载。

实际问题：

- 百度网盘窗口可能没有置前，点击会落到终端或编辑器上。
- 搜索框坐标写错时，脚本仍会继续执行。
- Electron UI 对 macOS Accessibility 暴露很少，只能看到大块 `AXGroup`，读不到可靠的“搜索框/下载按钮”控件。
- 弹窗、广告、容量提示会遮挡界面。

所以纯坐标点击只能作为兜底，不适合作为主方案。

## CDP 方案验证过程

先尝试给当前实例追加参数：

```bash
open -a BaiduNetdisk --args --remote-debugging-port=9222
```

当前实例没有监听端口，因为 Electron 通常只在首次启动时读取启动参数。

然后正常退出并带参数重启：

```bash
osascript -e 'tell application "BaiduNetdisk" to quit'
open -a BaiduNetdisk --args --remote-debugging-port=9222
```

验证端口：

```bash
lsof -nP -iTCP:9222 -sTCP:LISTEN
curl -sS http://127.0.0.1:9222/json/version
```

成功后返回：

```json
{
  "Browser": "Chrome/116.0.5845.179",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 ... baidunetdisk/8.5.8 ... Electron/26.2.0 ..."
}
```

列出可调试页面：

```bash
curl -sS http://127.0.0.1:9222/json/list
```

其中主页面类似：

```text
file:///Applications/BaiduNetdisk.app/Contents/Resources/core.asar/index.html#/?category=all&path=%2F
```

搜索结果页面类似：

```text
file:///Applications/BaiduNetdisk.app/Contents/Resources/core.asar/index.html#/searchNew?...
```

下载确认弹窗不是主页面里的普通 DOM 弹层，而是另一个独立 Electron page/window：

```text
file:///Applications/BaiduNetdisk.app/Contents/Resources/core.asar/index.html#/downloadingSetting?is_from_manual=1
```

## DOM 自动化关键点

搜索框可以直接用 DOM 找到：

```js
document.querySelector('input[placeholder*="搜"]')
```

写入搜索词后触发事件：

```js
input.focus();
setValue.call(input, "开发者必备的Docker 实践指南");
input.dispatchEvent(new Event("input", { bubbles: true }));
input.dispatchEvent(new Event("change", { bubbles: true }));
input.dispatchEvent(new KeyboardEvent("keydown", {
  key: "Enter",
  code: "Enter",
  keyCode: 13,
  which: 13,
  bubbles: true,
}));
```

搜索成功后，页面文本里出现：

```text
“开发者必备的Docker 实践指南”搜索结果，共11项
文件夹结果1项
开发者必备的 Docker 实践指南
文件夹
2023.10.18 23:10
web
```

目标文件夹行可以通过这些 class 找：

```js
document.querySelectorAll(".fileItemWrapSearch,.itemWrap")
```

选中后页面出现：

```text
已选中1/1 个
分享
下载
```

第一次点击搜索结果页的“下载”后，会出现独立下载路径确认窗口。它在 CDP 里是一个新的 target，不在搜索结果页 DOM 里：

```text
设置下载存储路径
开发者必备的 Docker 实践指南
下载到： Downloads
取消
下载
```

这个窗口的 URL 是：

```text
file:///Applications/BaiduNetdisk.app/Contents/Resources/core.asar/index.html#/downloadingSetting?is_from_manual=1
```

确认按钮可以在这个新 target 里找：

```js
document.querySelector(".down-btn")
```

注意两点：

- target 出现时 DOM 可能还没加载完，需要轮询等待 `.down-btn`。
- 点击确认按钮后，这个独立 target 会关闭；CDP 请求可能因为页面关闭而中断，脚本需要把这种关闭当成正常结果。

确认后有时会跳到传输页：

```text
下载中(0)
已完成(1)
暂无正在下载的文件
```

但百度网盘也可能只关闭下载设置窗口，不切换主页面。当前脚本的判断是：

- 如果跳到 `#/downloading`，读取传输页状态。
- 如果没有跳转，但 `#/downloadingSetting` 已关闭，也认为下载任务已提交。
- 如果确认后 `#/downloadingSetting` 仍然存在，才算失败。

## 项目里的最终实现

最终脚本：

```text
src/download-baidu-folder.ts
```

运行方式不变：

```bash
pnpm download:baidu-docker
```

只搜索并选中，不下载：

```bash
pnpm download:baidu-docker -- --select-only
```

脚本现在做的事：

1. 检查 macOS。
2. 检查 `9222` 调试端口是否已打开。
3. 如果没有打开，退出百度网盘并用 `--remote-debugging-port=9222` 重启。
4. 找到包含搜索框的主页面。
5. 输入目标目录名并搜索。
6. 找到搜索结果里的文件夹行并选中。
7. 点击搜索结果页下载按钮。
8. 等待独立下载设置窗口 `#/downloadingSetting` 出现。
9. 在这个独立 target 里等待 `.down-btn` 并点击确认下载。
10. 如果进入 `#/downloading`，读取传输页状态；否则确认下载设置窗口已关闭。

## 验证记录

类型检查通过：

```bash
npx tsc --noEmit
```

安全验证通过：

```bash
pnpm download:baidu-docker -- --select-only
```

输出：

```text
[baidu] 搜索目录：开发者必备的Docker 实践指南
[baidu] 选中目标文件夹
[baidu] 已按 --select-only 停在搜索结果，不下载
```

完整下载已实际成功，本地文件包含：

```text
开发者必备的 Docker 实践指南/基础概念：浅谈虚拟化和容器技术.md
开发者必备的 Docker 实践指南/安装运行：搭建 Docker 运行环境.md
开发者必备的 Docker 实践指南/基础概念：这是 Docker 的简历.md
```

后续修复验证输出：

```text
[baidu] 搜索目录：开发者必备的Docker 实践指南
[baidu] 选中目标文件夹
[baidu] 点击下载
[baidu] 确认下载路径
[baidu] 下载任务已提交
```

## 注意事项

- 百度网盘关闭后普通打开不会自动带 `9222`，脚本会在需要时重启它。
- `9222` 只监听本机 `127.0.0.1`。
- 如果百度网盘升级导致 DOM class 改名，可能需要更新选择器。
- 这个方案比坐标点击稳，但仍依赖百度网盘 Electron 页面结构。
