import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  iqiyiDramaService,
  type IqiyiDramaConfig,
} from "@/platforms/iqiyi-drama/service"

const emptyConfig: IqiyiDramaConfig = {
  accountProfileName: "default",
  apiBaseUrl: "http://180.184.76.232:19090",
  localMaterialRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: "D:\\.drama-runs\\iqiyi-drama",
  logRetentionDays: "3",
}

const sections: ConfigSectionDefinition<IqiyiDramaConfig>[] = [
  {
    title: "任务与素材",
    description: "短剧和漫剧共用账号任务队列；只下载封面与权属文件，不下载正片视频。",
    fields: [
      {
        key: "apiBaseUrl",
        label: "接口地址",
        description: "爱奇艺账号与 RPA 任务接口根地址。",
        type: "url",
      },
      {
        key: "taskPollIntervalSeconds",
        label: "任务轮询间隔",
        description: "没有可领取任务或单次任务结束后，再次请求接口的间隔。",
        type: "number",
        suffix: "秒",
        min: 1,
      },
      {
        key: "baiduNetdiskDownloadRetryAttempts",
        label: "网盘下载重试",
        description: "仅重试封面和权属素材；素材与视频混放时会停止，避免下载正片。",
        type: "number",
        suffix: "次",
        min: 0,
      },
    ],
  },
  {
    title: "浏览器与日志",
    description: "每个爱奇艺账号使用独立 Chromium 登录态；共享目录与 AI 模型在全局配置中统一管理。",
    fields: [
      {
        key: "logRetentionDays",
        label: "日志保留",
        description: "超过天数的日志会在服务启动时清理。",
        type: "number",
        suffix: "天",
        min: 1,
      },
      {
        key: "operationDelaySeconds",
        label: "操作延迟",
        description: "每一步 Playwright 页面操作之间的延迟。",
        type: "number",
        suffix: "秒",
        step: "0.01",
      },
      {
        kind: "switch",
        key: "headless",
        label: "浏览器窗口",
        description: "首次登录及调试爱奇艺表单时建议显示浏览器。",
        activeLabel: "无头运行",
        inactiveLabel: "显示浏览器",
      },
    ],
  },
]

export function IqiyiDramaConfigurationPage() {
  const state = usePlatformConfig({
    emptyConfig,
    getConfig: iqiyiDramaService.getConfig,
    saveConfig: iqiyiDramaService.saveConfig,
  })

  return (
    <ConfigurationPageFrame
      hasChanges={state.hasChanges}
      loading={state.loading}
      restartRequired={state.restartRequired}
      title="爱奇艺配置"
      onDiscard={state.discardChanges}
      onSave={state.persistConfig}
    >
      {sections.map((section) => (
        <ConfigSection
          key={section.title}
          config={state.config}
          fields={section.fields}
          section={section}
          onChange={state.updateConfig}
        />
      ))}
    </ConfigurationPageFrame>
  )
}
