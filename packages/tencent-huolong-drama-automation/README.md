# 腾讯火龙漫剧自动化

独立负责腾讯视频创作平台“漫剧创作（火龙漫剧）”的专辑资料和剧集上传，不复用或扩展 QQ 短剧平台代码。

## 页面

- 登录：`https://mp.v.qq.com/`
- 上剧：`https://mp.v.qq.com/kairos/album/create`

## 任务字段

平台字段位于 `payloadJson.tencentHuolongPlaylet`（同时兼容 `huolongPlaylet` 和 `playlet`）：

- `title`、`summary`、`episodeCount`
- `protagonistName`（可选；缺省时从简介提取）
- `isAiRealPersonShortDrama`（`是` / `否`，也兼容布尔值，缺省为 `否`）
- `themeType`：玄幻、异能、武侠、仙侠、都市、历史、悬疑、末世、重生、穿越、系统、搞笑、灵异、古风、青春、言情
- `keywords`（可选）：仅“内容是否为 AI 真人短剧”为“是”时使用；从火龙平台关键词词库中选择，少于两个时自动结合剧名、简介和题材用 AI 补足两个
- `costAnalysisFiles`、`copyrightProofFiles`、`nonInfringementCommitmentFiles`、`productionProcessFiles`

成本和版权文件也兼容公共结构 `productionCost.proofFiles`、`copyright.productionProofFiles`、`copyright.licenseProofFiles`。缺少显式文件时，会从 `<本地素材目录>/<原始剧名>/` 按文件名查找必传材料。生成过程和工程文件至少需要 8 张。

## 封面与视频

运行时从剧集资源中选取一张海报作为参考，调用全局图片模型分别生成并整理为：

- 横版封面 `1920×1080`
- 竖版封面 `770×1080`（带剧名）
- 榜单封面 `2450×800`（不带文字）
- 横版卡片图 `1500×1200`

所有封面会转为小于 10 MB 的 JPEG。首屏只填写页面必填项，点击“提交并添加视频”后切换到本地上传，上传按集数校验并排序的全部视频。剧集视频按腾讯单次最多 60 个文件的限制自动分批，确认所有批次上传成功后提交；最终提交后至少保留任务标签页 10 秒，并在确认平台成功后关闭。

副标题固定使用“主角名+逆袭人生”，例如主角为“李三”时填写“李三逆袭人生”。网盘有封面或海报时必须作为 AI 参考图；只有网盘没有海报时才使用剧名和简介生成兜底源图。

确认授权合同后先等待上传控件正常加载；若 20 秒后页面仍无上传控件且没有明确表单错误，运行时会记录现场并刷新一次，再重新切换“本地上传”。刷新后仍未恢复才会上报任务失败。

## 后端接口

客户端使用独立命名空间：

- `POST /dramaAiRpa/tencent/accountConfig/page`
- `POST /dramaAiRpa/tencent/accountTask/page`
- `POST /dramaAiRpa/tencent/rpa/claim`
- `POST /dramaAiRpa/tencent/rpa/report`

运行时从账号配置接口加载 `ON` 状态账号，按账号查询 `READY` 任务，领取后消费
`payloadJson`，并以 `{ taskId, success, failStage, resultJson, errorMessage }` 契约回写结果。
账号和任务均来自真实后端，不再生成本地模拟数据。
