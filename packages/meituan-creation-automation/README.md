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
  "copyrightProofUrl": "https://example.com/copyright-proof.png",
  "premiereProofUrl": "https://example.com/premiere-proof.png",
  "backgroundText": "现代",
  "plotSettingTexts": ["打脸虐渣", "重生"],
  "storyThemeText": "脑洞",
  "totalEpisodes": 12,
  "checkpointEpisodes": [8, 6, 5],
  "productionCompanyText": "明星说漫剧",
  "directorNames": ["张三"],
  "producerNames": ["李四"],
  "screenwriterNames": ["王五"],
  "actorNames": ["赵六", "钱七"],
  "averageEpisodeDurationMinutes": 2,
  "plotSynopsisText": "该剧讲述主角历经困境后逆袭成长，揭开真相并收获亲情与爱情的故事。",
  "premiereStatus": "美团联合首发",
  "expectedPremiereTimeText": "2026-06-25 12:30:00"
}
```

当前 schema 支持：

- `真人短剧（含AI）` -> `真人短剧`、`AI真人短剧`
- `动漫短剧` -> `动态漫`、`沙雕漫`、`PPT漫`

`authorNicknameText`、`audience`、`collectionType`、`collectionSubType`、`collectionTitle`、`collectionCoverUrl`、`copyrightProofUrl`、`premiereProofUrl`、`backgroundText`、`plotSettingTexts`、`storyThemeText`、`totalEpisodes`、`checkpointEpisodes`、`productionCompanyText`、`directorNames`、`producerNames`、`screenwriterNames`、`actorNames`、`averageEpisodeDurationMinutes`、`plotSynopsisText`、`expectedPremiereTimeText` 都是必填字段。
`audience` 支持 `男频`、`女频`。
`collectionTitle` 是合集标题，也就是剧名称。
`collectionCoverUrl` 是合集封面图片 URL，运行时会下载到平台运行数据目录后通过文件控件上传。
`copyrightProofUrl` 是版权证明文件 URL，运行时会下载到平台运行数据目录后通过文件控件上传。
`premiereProofUrl` 是首发证明材料 URL，运行时会下载到平台运行数据目录后通过文件控件上传。
`backgroundText` 是时代背景，支持 `现代`、`都市`、`古代`、`乡村`、`年代`、`架空`、`职场`、`民国`、`宫廷`、`校园`、`荒岛`、`古装`、`末世`。
`plotSettingTexts` 是剧情设定，最多 2 个，按美团下拉选项文本传入。
`storyThemeText` 是故事主题，按美团下拉选项文本传入。
`totalEpisodes` 是总集数；`checkpointEpisodes` 是卡点集，最多 3 个，取值不能超过总集数。
`directorNames`、`producerNames`、`screenwriterNames`、`actorNames` 是自定义多选 tag 输入，按输入后下拉选项文本点击。
`averageEpisodeDurationMinutes` 是单集平均时长，单位分钟。
`plotSynopsisText` 是剧情简介。
`premiereStatus` 是全网首发情况，支持 `美团独家`、`美团联合首发`、`非美团首发`，不传时默认 `美团联合首发`。
`expectedPremiereTimeText` 是预计首发时间，格式示例 `2026-06-25 12:30:00`。
