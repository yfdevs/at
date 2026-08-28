# @drama/iqiyi-drama-automation

爱奇艺创作者平台自动化运行时，按任务类型分别进入：

- 短剧：`https://creator.iqiyi.com/miniPlay/project/create`
- 漫剧：`https://creator.iqiyi.com/comicPlay/project/create`

## 素材策略

- 两类项目均选择“未成片”，不校验、不下载、不上传正片视频。
- 百度网盘任务只下载独立的“封面/海报”和“权属/工程/资质/版权”目录。若素材与视频混放在同一目录，会停止任务以避免误下载视频。
- 权属文件支持爱奇艺当前允许的 JPG、PNG、PDF（BMP/WebP 会先转成 JPEG），最多 20 个、单个不超过 20MB。
- 竖版封面标准化为 `1080×1440`；未提供横版封面时，通过全局 AI 图片生成模型参考竖图生成横图，再标准化为 `1920×1080`。封面都会压缩到 5MB 以内。
- AI 横图按原图内容、模型和提示词版本缓存到平台运行数据目录。

## 任务字段

`payloadJson` 可把爱奇艺字段放在根级、`playlet`、`iqiyiPlaylet` 或 `iqiyiExtraInfo`。核心字段：

- `dramaType`: `short-drama` / `comic-drama`，也兼容“短剧”“漫剧”、`miniPlay`、`comicPlay`。
- `title`（不超过 30 字）、`summary`（100–300 字）、`episodeCount`。
- `shortDescription`：一句话推荐，4–10 字；未提供时从标题生成。
- `productionOrganization`：出品方名称。
- `productionCostYuan`：制作成本，单位为元；也兼容 `productionCostWan` 或 `productionCost.amountWan` 并自动换算。
- `scheduledOnlineTime`：定时上线时间；`releaseDate`：8 位 `YYYYMMDD` 发行日期。
- `baiduPanResourceLink`。
- `verticalCoverFile`, `horizontalCoverFile`, `ownershipFiles`；文件值可为本地路径或 HTTP(S) 地址。
- `audienceType`, `primaryCategory`, `secondaryCategories` 及制作团队字段。短剧必须提供导演、制片人、编剧；声明为非 AI 内容时还必须提供主要演员。漫剧制作团队字段可选。
- `isAiGenerated`: `是` / `否`，默认 `否`；短剧会分别映射为“含AI生成内容”/“无需声明”。
- `submit`: 默认 `true`；设为 `false` 时仅尝试保存草稿。

AI 的 API Key、Base URL、文本理解模型和图片生成模型都由 Electron 主进程从全局 `electron-store` 配置注入，运行时不读取业务环境变量。
