# 抖音短剧自动化

独立负责抖音集团短剧创作者中心的漫剧上传流程，不复用或扩展 TikTok 平台代码。

## 页面

- 上剧：`https://www.shortdramas.com/page/copyright/short-play/motion-comic-manage-edit-page/?from=book`
- 登录：`https://www.shortdramas.com/page/login?redirect=%2Fcopyright%2Fshort-play%2Fmotion-comic-manage-edit-page%2F%3Ffrom%3Dbook`

## 测试任务与 API

`src/api/task.ts` 预留了领取任务、成功回报和失败回报三个空 API 方法。配置中开启“内置测试任务”后，领取方法只返回一次 `createMockDouyinDramaTask()` 创建的真实结构假数据。测试数据固定 `submit=false`，脚本不会点击最终提交。

正式接口接入时保留 Zod 校验和 `normalizeClaimedDouyinDramaTask()`，只替换三个 API 方法内部。

## 百度网盘素材约定

剧集下载到 `<剧集视频根目录>/<原始剧名>/`。运行时会校验连续集数，并查找：

- 文件名或目录名包含“封面”或“海报”的图片；
- “工程”或“权属”目录下至少 4 张工程截图；
- 文件名包含“成本配置”或“制作成本”的成本图片；
- 文件名包含“不侵权承诺”或“承诺函”的签章扫描件；
- 可选的“片酬承诺”图片；
- “版权证明”“权属文件”“制作协议”或“授权协议”材料。

封面会生成红果 `700×1000` 和抖音 `720×1080` 两个小于 5 MB 的 JPEG 版本。剧集上传使用硬链接临时文件，结束后自动清理。

## 下拉数据记录

已从真实页面确认并由 Zod/常量固化的选项：

- 更新状态：已完结、连载中；
- 是否 AI / 是否系列剧 / 版权专区 IP 改编：是、否；
- AIGC 工具：红果漫剧创作Agent；
- 男女频：男频、女频、通用；
- 制作金额范围：30 万以下、30 万（含）- 80 万、80 万及以上；
- 发布方式：自主发布、平台发布。

分类、版权 IP、绑定合同和红果厂牌账号属于动态账号数据。脚本每次打开这些下拉时读取页面真实选项，并把完整快照写入：

`<运行数据目录>/assets/<账号配置名>/observations/dropdown-options.json`

页面选项变化时，日志中也会记录快照文件更新位置。
