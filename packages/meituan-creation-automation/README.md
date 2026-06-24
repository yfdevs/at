# Meituan Creation Automation

美团创作平台视频上架流程自动化服务骨架。

当前发布入口：

```text
https://czz.meituan.com/new/publishVideo
```

该包后续承载美团创作平台的 Playwright/runtime 实现。业务配置应由平台主进程模块注入，不从环境文件或业务 `process.env` 读取。

## 运行目录

桌面端默认把美团创作平台运行数据保存到 `.drama-runs/meituan-creation`。浏览器真实登录态位于该目录下的 `auth/chromium-profile`，登录成功后还会写入调试快照 `auth/storage-state.json`。后续日志、缓存和临时文件也应继续放在该平台目录内，避免和其他平台混在一起。

## 后端任务 Schema

后续后端任务 JSON 可通过 `collection` 指定创建新合集时选择的级联类型：

```json
{
  "authorNicknameText": "本人 明星说漫剧",
  "collection": {
    "type": "真人短剧（含AI）",
    "subType": "真人短剧"
  }
}
```

当前 schema 支持：

- `真人短剧（含AI）` -> `真人短剧`、`AI真人短剧`
- `动漫短剧` -> `动态漫`、`沙雕漫`、`PPT漫`

未提供 `collection` 时默认使用 `真人短剧（含AI）` -> `真人短剧`。
未提供 `authorNicknameText` 时默认使用 `本人 明星说漫剧`。
