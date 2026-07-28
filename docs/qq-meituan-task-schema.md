# QQ 与美团短剧任务字段 Schema

本文档梳理 QQ 短剧和美团短剧自动化当前使用的任务字段、页面控件类型、固定选项、文件约束，以及任务领取链路的实现状态。

> 更新时间：2026-07-25

## 当前实现状态

| 平台 | 账号列表 | 任务领取 | 任务轮询 | 成功/失败回调 | 页面填写 |
| --- | --- | --- | --- | --- | --- |
| QQ | 已接真实接口 | 已接 READY 列表与 `/dramaAiRpa/qq/rpa/claim` | 每个账号独立轮询 READY 列表 | 已接统一 `/dramaAiRpa/qq/rpa/report` | 已实现主要字段 |
| 美团 | 已接真实接口 | 已接 `/dramaAiRpa/meituan/rpa/claim` | 每个账号独立轮询 READY 列表 | 已接统一 `/dramaAiRpa/meituan/rpa/report` | 已实现发布配置填写 |

## QQ 任务 Schema

### 领取结果结构

QQ 领取接口返回 `payloadJson.qqPlaylet`，自动化会将它和通用字段归一化为以下内部结构：

```ts
type ClaimedQqDramaTask = {
  accountTaskId: number;
  dramaId?: number;
  originalTitle: string;
  qqAccountId?: string;
  qqAccountName?: string;
  playlet: QqDramaTaskPayload;
};
```

字段说明：

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `accountTaskId` | 是 | 正整数 | 业务任务 ID |
| `dramaId` | 否 | 正整数 | 短剧 ID |
| `originalTitle` | 是 | 非空字符串 | 原始剧名，用于匹配本地剧集视频目录 |
| `qqAccountId` | 否 | 字符串 | QQ 平台账号 ID |
| `qqAccountName` | 否 | 字符串 | QQ 平台账号名称 |
| `playlet` | 是 | 对象 | QQ 发布表单数据 |

### 发布字段

| 字段 | 必填 | 类型 | 页面控件/用途 | 限制或选项 |
| --- | --- | --- | --- | --- |
| `title` | 是 | 字符串 | 文本框，作品名称 | 1～20 字 |
| `summary` | 是 | 字符串 | 多行文本，作品简介 | 最多 200 字 |
| `audienceType` | 是 | 枚举 | 单选 | `男频`、`女频`、`通用` |
| `localCoverFile` | 运行时生成 | 字符串 | 封面文件上传 | 仅从本地/百度网盘剧目资源匹配 |
| `episodeCount` | 是 | 整数 | 数字文本框 | 1～1000 |
| `baiduPanResourceLink` | 否 | 字符串 | 百度网盘资源文本 | 用于准备本地正片 |
| `updateStatus` | 是 | 枚举 | 单选 | `已完结`、`连载中` |
| `isAiGenerated` | 否 | 枚举 | 单选 | `是`、`否`；默认 `是` |
| `primaryCategory` | 是 | 枚举 | 一级分类下拉 | 见“一级分类” |
| `secondaryCategory` | 否 | 枚举 | 联动二级分类下拉 | 当前只确认“都市”二级分类 |
| `isSeries` | 否 | 枚举 | 单选 | `是`、`否`；默认 `否` |
| `comicType` | 否 | 枚举 | 单选 | `漫剧`、`仿真人漫剧`、`真人剧`；默认 `漫剧` |
| `productionOrganization` | 是 | 字符串 | 文本框 | 个人创作者可填 `无` |
| `producers` | 是 | 字符串数组 | 文本框，逗号分隔 | 至少 1 个 |
| `directors` | 是 | 字符串数组 | 文本框，逗号分隔 | 至少 1 个 |
| `screenwriters` | 否 | 字符串数组 | 文本框，逗号分隔 | 默认 `[]` |
| `roles` | 否 | 角色数组 | 角色信息 | 当前页面填写代码被禁用 |
| `productionCostRange` | 是 | 枚举 | 单选 | `< 30 万`、`30 ~ 80 万`、`≥ 80 万` |
| `productionCostWan` | 是 | 数字 | 数字文本框 | 大于等于 0，单位万元 |
| `productionYear` | 是 | 整数 | 数字文本框 | 1900～2100 |
| `costAllocationReportFiles` | 是 | 字符串数组 | 文件批量上传 | 仅取 `productionCost.proofFiles` 的全部文件，至少 1 个 |
| `licenseProofFiles` | 运行时生成 | 字符串数组 | 权属文件上传 | 忽略接口字段；本地工程/权属图片合成为 1 张后上传 |
| `contractName` | 是 | 字符串 | 合同下拉 | 动态选项，取决于当前账号 |
| `submit` | 否 | 布尔值 | 是否提交审核 | 默认 `false` |

QQ 正式任务与美团使用相同的本地封面准备逻辑：从
`{localEpisodeVideoRoot}/{originalTitle}` 中匹配文件名包含“封面”或“海报”的图片；
完全没有文件名匹配时，再查找名称包含“封面”或“海报”的目录并取排序后的第一张。
任务包含百度网盘链接时，下载阶段要求至少 1 张封面并标准化到本地目录。最终上传使用
运行时生成的 `localCoverFile`。后端返回的 `coverImageFile`、`coverImageUrl` 和
`posterImageUrl` 均会被忽略。

正式任务找不到本地封面时以 `poster-material-invalid` 失败，不进入页面填写，并上报后端。

### 一级分类

```text
爱情
都市
喜剧
悬疑
古装
奇幻
玄幻
科幻
末世
动作
军事
惊悚
犯罪
家庭
亲子儿童
传奇
游戏竞技
剧情
```

### 已确认的二级分类

当前只确认了一级分类 `都市` 对应的二级分类：

```text
都市职场
都市日常
都市律政
豪门世家
女性成长
都市玄幻
```

其他一级分类的二级选项尚未进入 schema。

### 角色字段

```ts
type QqDramaRole = {
  name: string;
  description?: string;
  imageFile?: string;
};
```

| 字段 | 必填 | 限制 |
| --- | --- | --- |
| `name` | 是 | 最多 20 字 |
| `description` | 否 | 角色简介 |
| `imageFile` | 否 | 本地路径或 HTTP(S) URL |

注意：角色页面填写逻辑当前被注释，因此接口返回 `roles` 后暂时不会自动填写。

### 文件要求

封面图：

- 比例：7:10。
- 最低分辨率：350×500。
- 最大文件：5 MB。
- 格式：JPG、JPEG、PNG、BMP。

成本配置比例情况报告：

- 后端字段：`payloadJson.productionCost.proofFiles`。
- 至少 1 个；缺失或为空时任务校验失败并上报后端。
- 取全部文件，去重后批量上传。
- 最大文件：10 MB。
- 格式：JPG、PNG、PDF。

版权采买与播出授权证明：

- 忽略接口返回的 `payloadJson.copyright.licenseProofFiles`。
- 从 `{localEpisodeVideoRoot}/{originalTitle}` 下名称包含“工程”或“权属”的目录递归收集图片。
- 有百度网盘链接时，下载阶段要求至少 1 张工程/权属图片。
- 将全部本地权属图片纵向合成为 1 张临时图片后上传，任务结束后清理合成图。
- 本地和百度网盘均找不到权属图片时，任务失败并上报后端。

正片视频：

- `originalTitle` 用于定位本地资源目录。
- `episodeCount` 用于验证第 1 集到第 N 集是否完整。
- 上传时会为文件准备规范化的临时文件名。
- 页面出现失败剧集和“重试”按钮时，按文件分别累计重试次数，默认最多重试 3 次。
- 达到上限后会汇总失败文件名、页面错误信息和实际重试次数，以 `UPLOAD_FILE` 阶段上报后端。

### 状态与失败阶段

任务状态：

```text
READY
RUNNING
SUCCESS
FAILED
```

失败阶段：

```text
LOGIN
FILL_FORM
OTHER
RECOGNIZE_RESULT
UPLOAD_FILE
SUBMIT
```

### 接口链路

QQ 运行时按账号执行以下链路：

1. `/dramaAiRpa/qq/accountTask/page` 查询 `READY` 任务。
2. `/dramaAiRpa/qq/rpa/claim` 按 `accountTaskId` 领取。
3. 解析 `payloadJson.qqPlaylet` 并执行表单填写、剧集上传及可选提交。
4. `/dramaAiRpa/qq/rpa/report` 统一回写成功或失败。
- 指定任务 ID 领取仅复制假任务并替换 `accountTaskId`。
- 成功回调只记录假日志。
- 失败回调只记录假日志。
- `aliases` 存在于页面表单 schema，但不在领取任务 payload 中，也没有页面填写逻辑。
- 非“都市”类别的二级分类选项尚未补齐。

## 美团任务 Schema

### 后端任务接口

美团运行时使用以下真实接口：

```text
POST /dramaAiRpa/meituan/accountTask/page
POST /dramaAiRpa/meituan/rpa/claim
POST /dramaAiRpa/meituan/rpa/report
```

分页请求按当前浏览器账号查询：

```json
{
  "page": 1,
  "pageSize": 100,
  "dramaId": null,
  "originalTitle": null,
  "accountId": "15173",
  "accountName": null,
  "status": "READY",
  "auditStatus": null
}
```

`pageSize` 固定为 100。查询结果会按返回顺序逐条使用 `accountTaskId`
领取。连续未查到任务时，前 9 次每 5 秒查询一次，第 10 次起
每 30 秒查询一次；查到并领取任务后计数清零。接口异常时等待 10 秒。

领取接口返回的 `payloadJson` 是通用短剧字段与 `meituanExtraInfo` 的组合：

```ts
type MeituanBackendPayload = {
  name?: string;
  summary?: string;
  episodeCount?: number;
  producerName?: string;
  baiduPanResourceLink?: string;
  posters?: {
    main?: string;
    promotion?: string;
  };
  copyright?: {
    productionProofFiles?: string[];
    licenseProofFiles?: string[];
  };
  meituanImages?: Array<{
    key?: string;
    url?: string;
  }>;
  meituanExtraInfo?: Partial<MeituanCreationTaskConfig>;
};
```

运行时会把这些字段规范化成下面的 `ClaimedMeituanDramaTask`。后端封面 URL
只作为兼容输入；实际发布前会按 `originalTitle` 从百度网盘下载并在本地资源目录
匹配封面。版权证明优先取
`meituanExtraInfo.copyrightProofUrl`，其次取 `meituanImages` 或
`copyright.licenseProofFiles`；首发证明优先取
`meituanExtraInfo.premiereProofUrl`，其次取 `meituanImages[key=premiereProof]`。
规范化后仍缺少必填素材时，任务会以 `UPLOAD_FILE` 阶段失败并回写错误；其他领取数据错误以
`OTHER` 阶段回写，均不进入页面发布。

### 领取结果结构

美团任务已经使用与 QQ 一致的两层结构：外层保存任务和账号元数据，`playlet` 保存发布配置。

```ts
type ClaimedMeituanDramaTask = {
  accountTaskId: number;
  dramaId?: number;
  originalTitle: string;
  meituanAccountId?: string;
  meituanAccountName?: string;
  playlet: MeituanCreationTaskConfig;
};
```

字段说明：

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `accountTaskId` | 是 | 正整数 | 业务任务 ID |
| `dramaId` | 否 | 正整数 | 短剧 ID |
| `originalTitle` | 是 | 非空字符串 | 原始剧名，用于标识业务任务和本地剧集资源 |
| `meituanAccountId` | 否 | 字符串 | 美团平台账号 ID |
| `meituanAccountName` | 否 | 字符串 | 美团平台账号名称 |
| `playlet` | 是 | 对象 | 美团发布表单配置 |

`playlet` 的结构如下：

```ts
type MeituanCreationTaskConfig = {
  baiduPanResourceLink?: string;
  authorNicknameText: string;
  audience: "男频" | "女频";
  collectionType: "真人短剧（含AI）" | "动漫短剧";
  collectionSubType:
    | "真人短剧"
    | "AI真人短剧"
    | "动态漫"
    | "沙雕漫"
    | "PPT漫";
  collectionTitle: string;
  collectionCoverUrl?: string;
  collectionCoverFile?: string;
  copyrightProofUrl: string;
  premiereProofUrl: string;
  backgroundText: MeituanCreationBackground;
  plotSettingTexts: MeituanCreationPlotSetting[];
  storyThemeText: MeituanCreationStoryTheme;
  totalEpisodes: number;
  checkpointEpisodes: number[];
  productionCompanyText: string;
  directorNames: string[];
  producerNames: string[];
  screenwriterNames: string[];
  actorNames: string[];
  averageEpisodeDurationMinutes: number;
  plotSynopsisText: string;
  premiereStatus?: "美团独家" | "美团联合首发" | "非美团首发";
  expectedPremiereTimeText?: string;
  otherPlatformPremiereDateText?: string;
};
```

### 发布字段

| 字段 | 必填 | 类型 | 页面控件/用途 | 限制或选项 |
| --- | --- | --- | --- | --- |
| `baiduPanResourceLink` | 否 | 字符串 | 百度网盘资源文本 | 存在时先下载并标准化正片，再执行本地视频校验 |
| `authorNicknameText` | 是 | 字符串 | 作者下拉 | 动态选项，取决于当前账号 |
| `audience` | 是 | 枚举 | 单选/下拉 | `男频`、`女频` |
| `collectionType` | 是 | 枚举 | 合集类型级联下拉 | 见“合集类型” |
| `collectionSubType` | 是 | 枚举 | 合集子类型级联下拉 | 由合集类型决定 |
| `collectionTitle` | 是 | 字符串 | 文本框 | 同时用于匹配本地视频 |
| `collectionCoverUrl` | 否 | URL | 兼容后端封面地址 | 实际任务优先使用网盘下载后匹配出的本地封面 |
| `collectionCoverFile` | 运行时生成 | 字符串 | 上传合集封面 | 从 `{localEpisodeVideoRoot}/{originalTitle}` 中匹配 |
| `copyrightProofUrl` | 是 | URL | 上传版权证明 | 有效 HTTP(S) URL |
| `premiereProofUrl` | 是 | URL | 上传首发证明 | 有效 HTTP(S) URL |
| `backgroundText` | 是 | 枚举 | 单选标签 | 见“时代背景” |
| `plotSettingTexts` | 是 | 枚举数组 | 多选标签 | 1～2 个 |
| `storyThemeText` | 是 | 枚举 | 单选标签 | 见“故事主题” |
| `totalEpisodes` | 是 | 整数 | 数字文本框 | 大于等于 1 |
| `checkpointEpisodes` | 是 | 整数数组 | 多选标签 | 1～3 个；每个大于等于 2 且不超过总集数 |
| `productionCompanyText` | 是 | 字符串 | 文本框 | 制作机构 |
| `directorNames` | 是 | 字符串数组 | 自定义多选输入 | 至少 1 个 |
| `producerNames` | 是 | 字符串数组 | 自定义多选输入 | 至少 1 个 |
| `screenwriterNames` | 是 | 字符串数组 | 自定义多选输入 | 至少 1 个 |
| `actorNames` | 是 | 字符串数组 | 自定义多选输入 | 至少 1 个 |
| `averageEpisodeDurationMinutes` | 是 | 数字 | 数字文本框 | 大于 0，单位分钟 |
| `plotSynopsisText` | 是 | 字符串 | 多行文本 | 剧情简介 |
| `premiereStatus` | 否 | 枚举 | 下拉 | 默认 `美团联合首发` |
| `expectedPremiereTimeText` | 联合首发时必填 | 字符串 | 预计首发时间控件 | `YYYY-MM-DD HH:mm:ss` |
| `otherPlatformPremiereDateText` | 非美团首发时必填 | 字符串 | 其他平台首发时间控件 | `YYYY-MM-DD`，只有日期 |

### 合集类型

```text
真人短剧（含AI）
  ├─ 真人短剧
  └─ AI真人短剧

动漫短剧
  ├─ 动态漫
  ├─ 沙雕漫
  └─ PPT漫
```

### 时代背景

```text
现代
都市
古代
乡村
年代
架空
职场
民国
宫廷
校园
荒岛
古装
末世
```

### 剧情设定

`plotSettingTexts` 至少选择 1 个，最多选择 2 个：

```text
打脸虐渣
大男主
大女主
马甲
重生
穿越
系统
先婚后爱
家长里短
小人物
神豪
金手指
猛兽
豪门
破镜重圆
强者回归
传承觉醒
异能
强强联合
逆袭
医生
甜宠
娱乐圈
青梅竹马
神医
追妻火葬场
姐弟恋
玄学
业界精英
萌娃
一见钟情
反派主角
萌宠
捞偏门
白月光
双向救赎
灵魂互换
病娇
反转
暴富
黑道
丧尸
特种兵
霸总
方言
```

### 故事主题

`storyThemeText` 为单选，可选值：

```text
现言
成长
脑洞
奇幻
玄幻
古言
战神
宫斗
仙侠
权谋
爱情
种田
悬疑
喜剧
志怪
青春
灵异
法律
家国情怀
刑侦
抗战
传奇
武侠
求生
科幻
动作
惊悚
商战
家庭
亲情
励志
复仇
婚姻
虐恋
爽文
灾难
```

### 首发状态

```text
美团独家
美团联合首发
非美团首发
```

### 预计首发时间

`expectedPremiereTimeText` 在 `premiereStatus="美团联合首发"` 时必须由接口返回：

- 缺失：任务校验失败并上报后端。
- 传入：作为业务指定的预计首发时间使用。
- 运行时按接口值填写，不会因为任务排队或时间已过而自动调整。

支持以下输入格式：

```text
YYYY-MM-DD HH:mm:ss
YYYY-MM-DD HH:mm
YYYY-MM-DDTHH:mm:ss
YYYY-MM-DDTHH:mm
```

内部统一转换为：

```text
YYYY-MM-DD HH:mm:ss
```

填写后会回读页面输入框；页面实际值与接口值不一致时，任务失败并上报期望值和实际值。

### 其他平台首发时间

`otherPlatformPremiereDateText` 在 `premiereStatus="非美团首发"` 时必须由接口返回。
格式固定为 `YYYY-MM-DD`，只填写日期，不包含时分秒。缺失或格式错误时任务校验失败并上报后端。

### 本地视频要求

QQ 和美团都在领取任务后、执行页面发布前按同一顺序处理正片：

```text
百度网盘下载/标准化（有 baiduPanResourceLink 时）
  → 本地剧集严格校验
  → 页面填写和上传
```

美团使用领取结果外层的 `originalTitle` 作为资源名，使用
`playlet.totalEpisodes` 作为应有集数。资源目录必须位于：

```text
{localEpisodeVideoRoot}/{originalTitle}/
```

不再使用 `collectionTitle` 查找视频，也不再回退到
`localEpisodeVideoRoot` 根目录。共享匹配器会扫描资源目录及常见的
`成片`、`成品`、`视频`、`正片` 子目录，识别常见的剧集文件名，
并严格要求：

- 第 1 集到第 N 集全部存在。
- 不存在重复集数。
- 文件非空。
- 不缺集。

任一条件不满足时，任务在打开发布表单操作之前失败，不会继续填写或上传。

### 美团剧集上传失败重试

- 剧集上传完成等待上限为 2 小时。
- 单集出现“上传失败”和“重试”控件时，按文件名单独累计并点击重试。
- 默认最多重试 5 次，可在美团配置页通过“上传失败重试”修改。
- 达到上限仍失败时，汇总失败集号、文件名、页面错误信息和实际重试次数，
  以 `UPLOAD_FILE` 阶段上报后端。

### 美团封面要求

任务包含 `baiduPanResourceLink` 时，百度网盘下载请求会同时要求：

```text
第 1～N 集正片
至少 1 张封面/海报图片
```

下载器会把匹配到的封面标准化到：

```text
{localEpisodeVideoRoot}/{originalTitle}/海报封面/
```

发布前会递归扫描 `{localEpisodeVideoRoot}/{originalTitle}`，匹配：

- 文件名包含“封面”或“海报”的图片。
- 或目录名包含“封面”或“海报”时，该目录内排序后的第一张图片。

支持 `png`、`jpg`、`jpeg`、`bmp`、`webp`，文件必须存在且大小大于 0。
找不到封面时以 `poster-material-invalid` 失败，不进入页面填写。

### 当前执行链路

```text
按账号查询 READY 列表
  → 逐条领取
  → 后端 payloadJson 规范化并校验
  → 百度网盘下载/标准化（存在链接时）
  → 本地第 1～N 集严格校验
  → 页面填写、视频上传和发布
  → 成功或失败统一回写
```

`originalTitle` 用于标识业务任务、百度网盘下载目录和本地视频匹配；
`collectionTitle` 只用于美团页面上的合集标题。
