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
- `costAnalysisFiles`、`copyrightProofFiles`、`nonInfringementCommitmentFiles`、`productionProcessFiles`

成本和版权文件也兼容公共结构 `productionCost.proofFiles`、`copyright.productionProofFiles`、`copyright.licenseProofFiles`。缺少显式文件时，会从 `<本地素材目录>/<原始剧名>/` 按文件名查找必传材料。生成过程和工程文件至少需要 8 张。

## 封面与视频

运行时从剧集资源中选取一张海报作为参考，调用全局图片模型分别生成并整理为：

- 横版封面 `1920×1080`
- 竖版封面 `770×1080`（带剧名）
- 榜单封面 `2450×800`（不带文字）
- 横版卡片图 `1500×1200`

所有封面会转为小于 10 MB 的 JPEG。首屏只填写页面必填项，点击“提交并添加视频”后切换到本地上传，上传按集数校验并排序的全部视频，等待上传完成后提交。

## 后端接口

客户端使用独立命名空间：

- `POST /dramaAiRpa/tencent/accountConfig/page`
- `POST /dramaAiRpa/tencent/accountTask/page`
- `POST /dramaAiRpa/tencent/rpa/claim`
- `POST /dramaAiRpa/tencent/rpa/report`

这些接口应与其他平台使用相同的分页、领取和回写响应契约。

当前后端接口尚未提供，运行时暂时使用一个本地模拟账号和一条一次性模拟任务；不会请求上述接口。模拟任务被领取一次后，后续轮询返回空，重启应用后重置。
