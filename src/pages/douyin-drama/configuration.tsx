import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  douyinDramaService,
  type DouyinDramaConfig,
} from "@/platforms/douyin-drama/service"

const emptyConfig: DouyinDramaConfig = {
  apiBaseUrl: "http://180.184.76.232:19090",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  unitPriceYuan: "0.5",
  paidEpisodeStart: "10",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: ".drama-runs/douyin-drama",
  logRetentionDays: "3",
  closeFailedTaskPages: "false",
}

const sections: ConfigSectionDefinition<DouyinDramaConfig>[] = [
  {
    title: "任务与素材",
    description: "剧目业务字段由后台 RPA 任务提供；售卖确认页使用这里配置的期限、价格和付费起始集数。",
    fields: [
      {
        key: "apiBaseUrl",
        label: "接口地址",
        description: "用于读取后台启用账号、领取任务并回报执行结果，默认连接 180.184.76.232:19090。",
        type: "url",
      },
      {
        key: "taskPollIntervalSeconds",
        label: "任务轮询间隔",
        description: "空闲或任务结束后再次调用领取接口的等待时间。",
        type: "number",
        suffix: "秒",
        min: 1,
      },
      {
        key: "baiduNetdiskDownloadRetryAttempts",
        label: "网盘下载重试",
        description: "可重试的百度网盘下载错误最多重试次数。",
        type: "number",
        suffix: "次",
        min: 0,
      },
      {
        key: "episodeUploadWaitTimeoutMinutes",
        label: "上传等待时间",
        description: "等待全部剧集上传与处理完成的最长时间。",
        type: "number",
        suffix: "分钟",
        min: 1,
      },
      {
        key: "unitPriceYuan",
        label: "单集售价",
        description: "填写抖音最终确认页的单集售价。",
        type: "number",
        suffix: "元",
        min: 0.1,
        max: 9999,
        step: "0.1",
      },
      {
        key: "paidEpisodeStart",
        label: "付费起始集数",
        description: "从该集开始到最后一集均设为付费；第 1 集为平台免费集，因此最早从第 2 集开始。",
        type: "number",
        suffix: "集起",
        min: 2,
        max: 300,
      },
    ],
  },
  {
    title: "浏览器与日志",
    description: "抖音短剧使用独立 Chromium 登录态；共享目录在全局配置中统一管理。",
    fields: [
      {
        key: "logRetentionDays",
        label: "日志保留",
        description: "超过天数的日志文件会在服务启动时清理。",
        type: "number",
        suffix: "天",
        min: 1,
      },
      {
        key: "operationDelaySeconds",
        label: "操作延迟",
        description: "每一步 Playwright 操作之间的延迟。",
        type: "number",
        suffix: "秒",
        step: "0.01",
      },
      {
        kind: "switch",
        key: "headless",
        label: "浏览器窗口",
        description: "首次登录、测试任务和排查页面变化时建议显示浏览器。",
        activeLabel: "无头运行",
        inactiveLabel: "显示浏览器",
      },
      {
        kind: "switch",
        key: "closeFailedTaskPages",
        label: "失败任务页面",
        description: "默认保留失败现场，便于结合截图和日志排查页面变化。",
        activeLabel: "自动关闭失败页",
        inactiveLabel: "保留失败页",
      },
    ],
  },
]

export function DouyinDramaConfigurationPage() {
  const configState = usePlatformConfig({
    emptyConfig,
    getConfig: douyinDramaService.getConfig,
    saveConfig: douyinDramaService.saveConfig,
  })
  return (
    <ConfigurationPageFrame
      hasChanges={configState.hasChanges}
      loading={configState.loading}
      restartRequired={configState.restartRequired}
      title="抖音短剧配置"
      onDiscard={configState.discardChanges}
      onSave={configState.persistConfig}
    >
      {sections.map((section) => (
        <ConfigSection
          key={section.title}
          config={configState.config}
          fields={section.fields}
          section={section}
          onChange={configState.updateConfig}
        />
      ))}
    </ConfigurationPageFrame>
  )
}
