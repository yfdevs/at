# nut.js 的工作原理

本文基于本项目安装的 `@nut-tree-fork/nut-js@4.2.6` 说明。重点解释当前脚本为什么能打开微信、搜索联系人、粘贴消息，以及为什么 macOS 会要求辅助功能权限。

## 一句话结论

`nut-js` 不是通过微信接口发消息，也不是调用微信 API。它做的是桌面自动化：让 Node.js 程序模拟真实用户的键盘、鼠标、剪贴板、窗口操作。

我们的脚本当前主要用到两类能力：

- 系统命令：用 `open -a WeChat` 打开微信。
- 桌面输入：用 `nut-js` 模拟 `Command+F`、`Command+V`、`Enter`。

## 分层结构

调用链大致是：

```text
src/send-wechat.ts
  -> @nut-tree-fork/nut-js
    -> ProviderRegistry
      -> @nut-tree-fork/libnut
        -> @nut-tree-fork/libnut-darwin
          -> build/Release/libnut.node
            -> macOS 原生系统事件 API
```

各层职责很简单：

- `src/send-wechat.ts`：业务脚本，决定先搜索谁、再粘贴什么。
- `@nut-tree-fork/nut-js`：给 JS 暴露 `keyboard`、`mouse`、`screen` 等高级对象。
- `ProviderRegistry`：把高级对象和具体实现绑定起来。
- `@nut-tree-fork/libnut`：跨平台适配层，按系统选择 macOS、Linux、Windows 的原生包。
- `libnut.node`：Node 原生扩展，真正调用操作系统能力。

## keyboard 是怎么工作的

本项目里这样导入：

```ts
import { keyboard, Key } from "@nut-tree-fork/nut-js";
```

`nut-js` 的入口文件会创建单例：

```js
const keyboard = new KeyboardClass(providerRegistry);
```

`KeyboardClass` 自己不直接操作系统。它只是做包装，然后转交给 provider：

```js
await this.providerRegistry.getKeyboard().pressKey(...keys);
await this.providerRegistry.getKeyboard().releaseKey(...keys);
```

默认 keyboard provider 来自 `@nut-tree-fork/libnut`：

```js
const { DefaultKeyboardAction } = require("@nut-tree-fork/libnut");
providerRegistry.registerKeyboardProvider(new DefaultKeyboardAction());
```

`DefaultKeyboardAction` 会把 `Key.LeftSuper`、`Key.V` 这类枚举映射成底层能理解的字符串，例如：

```js
[Key.LeftSuper, "meta"]
[Key.V, "v"]
[Key.Enter, "enter"]
```

然后调用原生函数：

```js
libnut.keyToggle(nativeKey, "down", modifierKeys);
libnut.keyToggle(nativeKey, "up", modifierKeys);
libnut.keyTap(nativeKey, modifierKeys);
libnut.typeString(input);
```

所以这句：

```ts
await keyboard.pressKey(Key.LeftSuper, Key.V);
await keyboard.releaseKey(Key.LeftSuper, Key.V);
```

最终等价于让系统收到一组真实键盘事件：按下 `Command+V`，再松开 `Command+V`。

## 为什么要用剪贴板

理论上可以用 `keyboard.type("Hello World")` 逐字输入。但中文、表情、特殊字符在跨平台键盘模拟里容易出问题。

所以当前脚本选择更稳的方式：

```ts
await copy(text);
await keyboard.pressKey(mod, Key.V);
await keyboard.releaseKey(mod, Key.V);
```

在 macOS 上，`copy()` 用的是系统自带的 `pbcopy`：

```ts
const child = execFile("pbcopy");
child.stdin?.end(text);
```

也就是先把文本放到系统剪贴板，再模拟 `Command+V` 粘贴。这样 `书旭`、中文消息、多字节字符都不用靠键盘逐字敲出来。

`nut-js` 自带的默认剪贴板 provider 底层用的是 `clipboardy`，但我们脚本没有走它，直接用了 macOS 的 `pbcopy`，更少一层。

## macOS 权限为什么会报 warning

macOS 对“程序控制键盘、鼠标、窗口”有限制。脚本要模拟按键，就必须有辅助功能权限。

`@nut-tree-fork/libnut-darwin` 在 macOS 上会包一层权限检查。它把这些原生函数列为需要辅助功能权限：

```js
keyTap
keyToggle
typeString
moveMouse
mouseClick
getWindows
focusWindow
captureScreen
```

当权限不是 `authorized` 时，它会调用：

```js
permissions.askForAccessibilityAccess();
```

并打印类似下面的 warning：

```text
The application running this script tries to access accessibility features to execute keyToggle
```

我们之前看到很多条 warning，是因为每次 `pressKey`、`releaseKey` 都会走一次 `keyToggle`。脚本现在加了 `ensureAccessibility()`，在真正按键前先用 AppleScript 检查：

```ts
osascript -e 'tell application "System Events" to return UI elements enabled'
```

如果没权限，就提前退出，只打印一条清楚的错误。

## 当前微信脚本的具体流程

当前 `src/send-wechat.ts` 的动作顺序是：

```text
读取命令行参数
  -> 检查 macOS 辅助功能权限
  -> open -a WeChat / open -a 微信
  -> 等微信激活
  -> 模拟 Command+F
  -> 把联系人写入剪贴板
  -> 模拟 Command+V
  -> 模拟 Enter 进入会话
  -> 把消息写入剪贴板
  -> 模拟 Command+V
  -> 默认停止，不发送
```

默认不发送是为了测试安全。只有显式传 `--send` 才会最后再按一次 `Enter`。

## 它不是微信机器人

这个方案的边界很明确：

- 它看不到微信内部数据结构。
- 它不知道某个联系人是否真的匹配正确。
- 它依赖微信窗口焦点、快捷键和当前 UI 状态。
- 它没有调用微信官方或非官方消息 API。

换句话说，它是“控制桌面上的微信客户端”，不是“连接微信服务端”。

## 关键源码位置

- `src/send-wechat.ts`：本项目脚本。
- `node_modules/@nut-tree-fork/nut-js/dist/index.js`：创建 `keyboard`、`mouse`、`screen` 单例。
- `node_modules/@nut-tree-fork/nut-js/dist/lib/keyboard.class.js`：高级 keyboard API。
- `node_modules/@nut-tree-fork/nut-js/dist/lib/provider/provider-registry.class.js`：注册默认 provider。
- `node_modules/.pnpm/@nut-tree-fork+libnut@4.2.6/node_modules/@nut-tree-fork/libnut/dist/import_libnut.js`：按平台加载原生包。
- `node_modules/.pnpm/@nut-tree-fork+libnut@4.2.6/node_modules/@nut-tree-fork/libnut/dist/lib/libnut-keyboard.class.js`：把 `Key` 映射成底层 key 字符串并调用 `libnut`。
- `node_modules/.pnpm/@nut-tree-fork+libnut-darwin@2.7.5/node_modules/@nut-tree-fork/libnut-darwin/permissionCheck.js`：macOS 权限检查和 warning 来源。
- `node_modules/.pnpm/@nut-tree-fork+libnut-darwin@2.7.5/node_modules/@nut-tree-fork/libnut-darwin/build/Release/libnut.node`：macOS 原生二进制扩展。
