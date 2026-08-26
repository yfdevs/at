# 百度短剧自动化

百度短剧上剧平台的独立 Playwright 运行时。运行时使用独立 Chromium 登录态，并通过
`@drama/drama-media-assets` 校验、准备本地剧集与海报资源。

后端领取和上报接口目前为测试实现。`createMockBaiduDramaTask()` 会生成一条 64 集的假任务，
`claimNextBaiduDramaTaskApi()` 在进程内只返回该任务一次，避免轮询重复发布。真实接口就绪后只需替换该领取函数的内部实现。
上报接口仍为无操作占位实现，响应约定沿用 QQ 平台：

```json
{ "code": 0, "msg": "success", "data": null }
```

领取任务的 `data` 后续应返回 `accountTaskId`、`originalTitle` 和 `payloadJson`；任务结构由
`claimedBaiduDramaTaskSchema` 校验。所有文件上传均定位页面中的 `input[type=file]` 并调用
Playwright `setInputFiles`，不会操作系统文件选择窗口。

领取响应示例：

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "accountTaskId": 1001,
    "originalTitle": "示例短剧",
    "accountId": "baidu-account-1",
    "accountName": "百度账号一",
    "payloadJson": {
      "title": "示例短剧",
      "summary": "剧情简介",
      "episodeCount": 10,
      "baiduPanResourceLink": "百度网盘分享文本",
      "audienceType": "男频",
      "secondaryCategory": "都市",
      "updateStatus": "已完结",
      "director": { "name": "导演名", "gender": "男" },
      "producers": ["制片人名"],
      "screenwriters": ["编剧名"],
      "actors": [
        { "name": "演员一", "roleName": "角色一" },
        { "name": "演员二", "roleName": "角色二" }
      ],
      "productionCostWan": 10,
      "productionOrganization": "制作机构",
      "authorAgreement": true,
      "submit": true
    }
  }
}
```
