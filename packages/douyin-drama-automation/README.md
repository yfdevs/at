# 抖音短剧自动化

独立负责抖音集团短剧创作者中心的漫剧上传流程，不复用或扩展 TikTok 平台代码。

## 页面

- 上剧：`https://www.shortdramas.com/page/copyright/short-play/motion-comic-manage-edit-page/?from=book`
- 登录：`https://www.shortdramas.com/page/login?redirect=%2Fcopyright%2Fshort-play%2Fmotion-comic-manage-edit-page%2F%3Ffrom%3Dbook`

## 测试任务与 API

抖音与仓库中的快手、淘宝、腾讯火龙果、爱奇艺适配器保持同一职责边界：后台 RPA 页面负责账号和业务字段，桌面端按后台启用账号启动独立浏览器，并执行 `READY 列表 -> claim -> Zod 校验 -> report`。

- 启用账号：`POST /dramaAiRpa/douyin/accountConfig/page`；
- 待执行任务：`POST /dramaAiRpa/douyin/accountTask/page`；
- 领取任务：`POST /dramaAiRpa/douyin/rpa/claim`；
- 结果回报：`POST /dramaAiRpa/douyin/rpa/report`。

用户选择的 `是否 AI、分类、男女频、是否系列剧、版权专区 IP 改编、版权书名` 均由后台任务页写入 `payloadJson.douyinPlaylet`，不在桌面配置页重复维护。桌面配置只保留接口地址、运行和排障参数。

后端接口开发期间，`src/api/mock-task.ts` 单独提供几个只返回假任务对象的方法，不接入桌面配置和正式任务领取流程。后端数据就绪后可直接删除这个文件及其导出：

- `createMockDouyinSelfProducedAiTask()`：自制 AI 漫剧；
- `createMockDouyinSelfProducedNonAiTask()`：自制非 AI 漫剧；
- `createMockDouyinCopyrightSeriesTask({ copyrightIpName })`：番茄版权 IP 系列剧。
- `createMockDouyinNetdiskTestTask()`：真实网盘样例任务，故意不返回简介和角色，用于验证 TXT/图片名的一次性 AI 整理链路。

账号接口开发期间，正式账号请求失败时 Electron 启动流程会临时调用 `src/api/mock-account.ts` 中的 `createMockDouyinDramaAccounts()`，返回手机号为 `17732354154` 的独立测试账号。该假账号会直接领取一次 `createMockDouyinNetdiskTestTask()` 返回的本地测试任务，领取和结果回报不会请求尚未完成的后台接口；每次重新启动服务会重置一次，单次运行不会重复执行。假任务的成本配置和不侵权承诺函使用可下载的公开测试 PNG，权属文件使用公开测试 PDF，未指定合同名时自动选择页面第一个可用合同，且 `submit=false`。正式接口可用后，删除假账号、假任务文件及对应回退调用即可，不需要保留 Mock 配置项。

后端可直接按 `douyinDramaTaskPayloadSchema` 对齐 payload 合同；固定字段即使被后台传入其他值，也会在运行端归一化为平台要求值。

## 百度网盘素材约定

剧集下载到 `<剧集视频根目录>/<原始剧名>/`。运行时会校验连续集数，并查找：

- 文件名或目录名包含“封面”或“海报”的图片；
- “工程”或“权属”目录下至少 4 张工程截图；
- 可选的“片酬承诺”图片。

成本配置、权属文件和不侵权承诺函属于任务接口必须提供的业务材料引用，领取任务并进行 Zod 解析时就会校验，缺少时不会开始网盘下载。下载后的资源准备阶段只负责把 HTTP(S) 引用下载为本地文件并验证文件是否真实可用。封面和工程截图仍从网盘素材中识别。

网盘中可放一张或两张封面。两张时会按宽高比分别匹配红果 7:10 和抖音 2:3；一张时复用源图。随后生成红果 `700×1000` 和抖音 `720×1080` 两个小于 5 MB 的 JPEG 版本，若页面仍弹出裁剪框会自动确认。网盘没有封面时，统一网盘服务会根据剧名和简介调用已配置的 AI 图片模型生成源图。剧集上传使用硬链接临时文件，结束后自动清理。

抖音任务的 `summary` 和 `roles` 可以不传。简介未传或不足 101 字时，运行时会读取网盘素材中的 TXT；TXT 可以放在与“海报”并列的“简介”子目录中，下载器会把该小目录及同目录角色图片一起下载，不会为补简介重复下载正片。运行时同时保留封面目录内所有图片的原始文件名，用于识别角色头像。简介、角色名称、角色性质、角色简介和头像候选会合并成一次文本模型请求，并用 Zod 校验结构化 JSON。后台已经提供且符合要求的字段优先保留。标准化目录会额外生成 `海报封面/原始图片/`、`海报封面/剧情资料/` 和 `海报封面/素材清单.json`，避免原始文件名在封面重命名时丢失。

## 表单约束

- 只写必填字段，更新状态固定“已完结”；
- AI 作品固定关联“红果漫剧创作Agent”；
- 系列剧固定为“季播剧”，系列剧名、封面和简介复用外层内容；
- 版权 IP 改编按用户提供的已审核书名搜索并精确选择；
- 制作机构固定为“明星说(北京)科技有限公司”，制片人和导演固定为“明星说”；编剧非必填，保持为空；
- 制作金额范围固定“30万以下”，剧目制作成本固定 `1` 万元；
- 最终提交后，必须同时满足平台成功信号和至少 10 秒停留才会关闭成功页；失败页默认保留，可在配置中改为自动关闭。

## 下拉数据记录

已从真实页面确认并由 Zod/常量固化的选项：

- 更新状态：已完结、连载中；
- 是否 AI / 是否系列剧 / 版权专区 IP 改编：是、否；
- AIGC 工具：红果漫剧创作Agent；
- 男女频：男频、女频、通用；
- 制作金额范围：30 万以下、30 万（含）- 80 万、80 万及以上；
- 发布方式：自主发布、平台发布。

分类、版权 IP、绑定合同、红果厂牌账号和抖音发布账号属于动态账号数据。脚本每次打开这些下拉时读取页面真实选项，并把完整快照写入：

`<运行数据目录>/assets/<账号配置名>/observations/dropdown-options.json`

页面选项变化时，日志中也会记录快照文件更新位置。

发布配置由任务接口的 `scheduledPublishAt` 和 `publishAccountName` 驱动。发布时间按上海时区规范化为 `YYYY-MM-DD HH:mm:ss`；自主发布时优先精确选择接口返回的发布账号，旧任务未返回账号名称时回退为下拉中的第一个可用账号。
