# @drama/iqiyi-drama-automation

爱奇艺创作者平台自动化运行时，按任务类型分别进入：

- 短剧：`https://creator.iqiyi.com/miniPlay/project/create`
- 漫剧：`https://creator.iqiyi.com/comicPlay/project/create`

## 素材策略

- 真人短剧仍选择“未成片”，因此不上传正片；漫剧必须在“作品内容”之后进入“上传正片”，完成全部剧集上传后才允许保存或提交项目。
- 漫剧会按 `originalTitle` 从本地素材目录校验第 1 集至 `episodeCount` 集，任务带百度网盘链接时会先下载正片。缺集、重复集数或集数不连续会直接失败，不会提前保存项目。
- 漫剧正片使用页面的多文件控件分批选择（每批最多 50 集），临时文件名统一为 `<title>-第N集.mp4`，并等待页面生成的剧集行数、文件名和上传成功终态全部匹配后才继续。爱奇艺页面建议正片使用不低于 1080p 的 SDR 版本。
- 百度网盘任务负责准备封面/海报，并为漫剧准备正片视频；出品方证明材料严格来自任务字段，不扫描或混入百度网盘权属目录。
- `copyright.productionProofFiles` 上传到“知识产权声明文件”，`copyright.licenseProofFiles` 上传到“版权证明文件”；两个数组中的文件都会全部上传，不截断为首个文件。两类文件分别支持 JPG、PNG、PDF（BMP/WebP 会先转成 JPEG），每类最多 20 个、单个不超过 20MB。
- 内置爱奇艺测试任务为上述两个字段分别提供一份真实存在的本地模拟图片，不使用空数组或无效 URL。
- 竖版封面标准化为 `1080×1440`；未提供横版封面时，通过全局 AI 图片生成模型参考竖图生成横图，再标准化为 `1920×1080`。AI 必须在生成海报时直接绘制准确的中文剧名，并根据剧情自动使用海洋奇幻、古装、悬疑、甜宠、都市或漫剧等商业海报艺术字效果，不使用程序后期叠字。封面都会压缩到 5MB 以内。
- AI 横图按原图内容、模型和提示词版本缓存到平台运行数据目录。

## 任务字段

`payloadJson` 可把爱奇艺字段放在根级、`playlet`、`iqiyiPlaylet` 或 `iqiyiExtraInfo`。核心字段：

- `dramaType`: `short-drama` / `comic-drama`，也兼容“短剧”“漫剧”、`miniPlay`、`comicPlay`。
- `title`（不超过 30 字）、`summary`（100–300 字）、`episodeCount`。
- 一句话推荐无需任务返回：`title` 长度为 4–10 个字符时直接使用；不在该范围时调用全局 AI 文本模型生成严格为 4–10 个汉字的新推荐语，并在填写前校验，输出不合格时最多重试 3 次。
- `productionOrganization`：出品方名称。
- `productionCostYuan`：制作成本，单位为元；也兼容 `productionCostWan` 或 `productionCost.amountWan` 并自动换算。
- 定时上线无需任务返回，运行时取执行时间的次日并精确到秒；发行日期取执行当天。
- `baiduPanResourceLink`：漫剧用于下载封面和第 1～`episodeCount` 集正片；未提供时必须已经在本地素材根目录准备同名剧目目录及完整剧集。
- `verticalCoverFile`, `horizontalCoverFile`, `copyright.productionProofFiles`, `copyright.licenseProofFiles`；文件值可为本地路径或 HTTP(S) 地址。
- `audienceType`, `primaryCategory`, `secondaryCategories` 及制作团队字段。短剧必须提供导演、制片人、编剧；声明为非 AI 内容时还必须提供主要演员。漫剧制作团队字段可选。
- `isAiGenerated`: `是` / `否`，默认 `否`；短剧会分别映射为“含AI生成内容”/“无需声明”。
- `submit`: 默认 `true`；设为 `false` 时仅保存草稿。漫剧无论保存还是提交，都必须先确认全部正片上传成功。

AI 的 API Key、Base URL、文本理解模型和图片生成模型都由 Electron 主进程从全局 `electron-store` 配置注入，运行时不读取业务环境变量。
