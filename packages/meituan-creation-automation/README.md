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

服务启动时可以只打开发布页并等待/保存登录态。后续执行表单自动化时，后端任务 JSON 需要按 schema 提供作者、受众、合集类型和合集标题。只要传入了任一任务字段，就会完整校验；字段缺失或不合法时运行时会直接报错，不做默认值兜底：

```json
{
  "authorNicknameText": "本人 明星说漫剧",
  "audience": "男频",
  "collectionType": "真人短剧（含AI）",
  "collectionSubType": "真人短剧",
  "collectionTitle": "示例剧名",
  "collectionCoverUrl": "https://example.com/poster.jpg",
  "backgroundText": "现代",
  "storyThemeText": "脑洞",
  "totalEpisodes": 12,
  "checkpointEpisodes": [8, 6, 5]
}
```

当前 schema 支持：

- `真人短剧（含AI）` -> `真人短剧`、`AI真人短剧`
- `动漫短剧` -> `动态漫`、`沙雕漫`、`PPT漫`

`authorNicknameText`、`audience`、`collectionType`、`collectionSubType`、`collectionTitle`、`collectionCoverUrl`、`backgroundText`、`storyThemeText`、`totalEpisodes`、`checkpointEpisodes` 都是必填字段。
`audience` 支持 `男频`、`女频`。
`collectionTitle` 是合集标题，也就是剧名称。
`collectionCoverUrl` 是合集封面图片 URL，运行时会下载到平台运行数据目录后通过文件控件上传。
`backgroundText` 是时代背景，支持 `现代`、`都市`、`古代`、`乡村`、`年代`、`架空`、`职场`、`民国`、`宫廷`、`校园`、`荒岛`、`古装`、`末世`。
`storyThemeText` 是故事主题，按美团下拉选项文本传入。
`totalEpisodes` 是总集数；`checkpointEpisodes` 是卡点集，最多 3 个，取值不能超过总集数。
