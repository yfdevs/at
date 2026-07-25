# Meituan Creation Automation

美团创作平台视频上架流程自动化服务骨架。

当前发布入口：

```text
https://czz.meituan.com/new/publishVideo
```

该包后续承载美团创作平台的 Playwright/runtime 实现。业务配置应由平台主进程模块注入，不从环境文件或业务 `process.env` 读取。

## 运行目录

桌面端默认把美团创作平台运行数据保存到 `.drama-runs/meituan-drama`。浏览器真实登录态位于该目录下的 `auth/chromium-profile`，登录成功后还会写入调试快照 `auth/storage-state.json`。后续日志、缓存和临时文件也应继续放在该平台目录内，避免和其他平台混在一起。

## 后端任务 Schema

服务启动时可以只打开发布页并等待/保存登录态。后续执行表单自动化时，后端任务使用 `ClaimedMeituanDramaTask` 包装层；外层保存任务和资源标识，`playlet` 保存发布配置。字段缺失或不合法时运行时会直接报错：

```json
{
  "accountTaskId": 15173,
  "originalTitle": "示例剧名",
  "playlet": {
    "baiduPanResourceLink": "https://pan.baidu.com/s/xxxx?pwd=1234",
    "authorNicknameText": "本人 明星说漫剧",
    "audience": "男频",
    "collectionType": "真人短剧（含AI）",
    "collectionSubType": "真人短剧",
    "collectionTitle": "示例剧名",
    "productionProofFiles": ["https://example.com/production-proof.png"],
    "licenseProofFiles": ["https://example.com/license-proof.png"],
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
    "averageEpisodeDurationMinutes": 2,
    "plotSynopsisText": "该剧讲述主角历经困境后逆袭成长，揭开真相并收获亲情与爱情的故事。",
    "premiereStatus": "美团联合首发"
  }
}
```

当前 schema 支持：

- `真人短剧（含AI）` -> `真人短剧`、`AI真人短剧`
- `动漫短剧` -> `动态漫`、`沙雕漫`、`PPT漫`

`authorNicknameText`、`audience`、`collectionType`、`collectionSubType`、`collectionTitle`、`premiereProofUrl`、`backgroundText`、`plotSettingTexts`、`storyThemeText`、`totalEpisodes`、`checkpointEpisodes`、`productionCompanyText`、`directorNames`、`producerNames`、`screenwriterNames`、`averageEpisodeDurationMinutes`、`plotSynopsisText` 都是必填字段。
`audience` 支持 `男频`、`女频`。
`collectionTitle` 是合集标题，也就是剧名称。
`collectionCoverUrl` 是可选的兼容字段。领取任务后，运行时会优先要求百度网盘同时下载
正片和至少 1 张封面，并在 `{localEpisodeVideoRoot}/{originalTitle}` 下递归匹配
文件名或目录名包含“封面/海报”的图片。匹配结果写入运行时
`collectionCoverFile`，校验通过后才通过文件控件上传。
`productionProofFiles` 和 `licenseProofFiles` 分别来自领取任务
`payloadJson.copyright` 下的制作合同与授权委托合同 URL 数组。运行时还会从
`{localEpisodeVideoRoot}/{originalTitle}` 的工程/权属目录扫描全部图片并合成一张
纵向排列的图片，合成文件保存在剧集对应的工程/权属目录下，最后取最多两张合同和
一张工程合成图上传到“版权证明”。
`premiereProofUrl` 从领取任务 `payloadJson.meituanImages` 中
`key="premiereProof"` 对应的 `url` 生成，运行时会下载到平台运行数据目录后通过文件控件上传。
`backgroundText` 是时代背景，支持 `现代`、`都市`、`古代`、`乡村`、`年代`、`架空`、`职场`、`民国`、`宫廷`、`校园`、`荒岛`、`古装`、`末世`。
`plotSettingTexts` 是剧情设定，最多 2 个，按美团下拉选项文本传入。
`storyThemeText` 是故事主题，按美团下拉选项文本传入。
`totalEpisodes` 是总集数；`checkpointEpisodes` 是卡点集，最多 3 个，取值不能超过总集数。
`directorNames`、`producerNames`、`screenwriterNames` 是自定义多选 tag 输入，按输入后下拉选项文本点击；美团创建合集页面没有演员字段，`actorNames` 不参与填写。
`averageEpisodeDurationMinutes` 是单集平均时长，单位分钟。
`plotSynopsisText` 是剧情简介。
`premiereStatus` 是全网首发情况，支持 `美团独家`、`美团联合首发`、`非美团首发`，不传时默认 `美团联合首发`。
`expectedPremiereTimeText` 是可选的预计首发时间，格式示例 `2026-06-25 12:30:00`。不传时，程序会在填写页面前自动生成当前时间加 1 分钟；传入时间过早时也会自动调整。

`baiduPanResourceLink` 是可选的百度网盘分享文本。存在时，运行时先把资源下载并标准化到
`{localEpisodeVideoRoot}/{originalTitle}`，再用 `originalTitle + totalEpisodes`
严格校验第 1 集到第 N 集，同时要求至少下载 1 张工程/权属图片；校验通过后才开始
页面填写和上传。

## 任务轮询

每个启用账号使用自己的 `accountId` 独立执行：

```text
POST /dramaAiRpa/meituan/accountTask/page（status=READY）
  → POST /dramaAiRpa/meituan/rpa/claim
  → 发布任务
  → POST /dramaAiRpa/meituan/rpa/report
```

单次 READY 查询数量固定为 100。
连续空查前 9 次每 5 秒重试，第 10 次起每 30 秒重试；查到任务后恢复快速轮询。
分页或领取接口异常时等待 10 秒。

领取接口的 `payloadJson` 使用后端通用短剧结构。运行时会合并其中的
`meituanExtraInfo`，并从 `name`、`summary`、`episodeCount`、`producerName`、
`posters`、`copyright`、`meituanImages` 和 `baiduPanResourceLink`
补齐美团发布配置，再通过 `ClaimedMeituanDramaTask` schema 校验。领取后的配置、
资源下载或页面发布失败都会通过 `/rpa/report` 回写失败阶段和错误信息。
