# 淘宝短剧自动化

淘宝光合平台采用“创建合集 → 批量上传剧集 → 批量发布”的独立运行链路。每个启用账号使用独立的持久化 Chromium 用户目录；登录或安全校验期间任务轮询不会启动，只有创建合集页面加载完成后才开始领取任务。

## 后端接口约定

当前客户端使用淘宝专属前缀，需后端提供：

- `POST /dramaAiRpa/taobao/accountConfig/page`
- `POST /dramaAiRpa/taobao/accountTask/page`
- `POST /dramaAiRpa/taobao/rpa/claim`
- `POST /dramaAiRpa/taobao/rpa/report`

`claim` 返回的 `payloadJson.taobaoPlaylet` 包含淘宝动态字段：

```json
{
  "title": "短剧名称",
  "summary": "剧情简介",
  "episodeCount": 60,
  "baiduPanResourceLink": "https://pan.baidu.com/s/...",
  "shortDramaType": "AI仿真人短剧",
  "shortDramaTags": ["都市", "AI真人演绎剧", "逆袭"],
  "audience": "女",
  "sourceCoverUrl": "https://.../reference-cover.jpg"
}
```

`shortDramaType`、`shortDramaTags` 和 `audience` 都直接使用后台保存的用户选项。后台不要求上传封面：运行时会优先匹配百度网盘素材中名称包含“封面”或“海报”的图片作为 AI 参考，没有参考图时按标题和简介直接生成。兼容任务也可通过 `sourceCoverFile`、`sourceCoverUrl`、`posters.main` 或 `taobaoImages` 中 key 为 `collectionCover` 的图片提供参考素材。

固定填写项由自动化运行时管理：合集类型 `短剧合集`、付费方式 `免费`、完结状态 `已完结`、备案类型 `备案号申请`、制片人 `杨爱平`、制作机构和导演 `明星说`、集均时长 `1` 分钟。其他非必填字段不填写。

## 安全与完成判定

- 每次任务都会生成并裁切一张精确 `1080 × 1800`、比例 `3:5` 的 AI 合集封面。
- 上传期间持续读取文件名、百分比和上传状态；检测到失败立即回写失败。
- “创建合集”和“批量发布”点击后都必须同时满足成功信号和至少 10 秒结算期，才会关闭成功任务页并回写成功。
- 失败任务页默认保留，便于人工诊断。
