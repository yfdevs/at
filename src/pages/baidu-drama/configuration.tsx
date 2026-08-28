import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import { baiduDramaService, type BaiduDramaConfig } from "@/platforms/baidu-drama/service"

const emptyConfig: BaiduDramaConfig = {
  apiBaseUrl: "http://180.184.76.232:19090",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: ".drama-runs/baidu-drama",
  logRetentionDays: "3",
}

const sections: ConfigSectionDefinition<BaiduDramaConfig>[] = [
  {
    title: "任务接口",
    description: "服务会读取后台启用的百度账号，领取 READY 任务并回写执行结果。",
    fields: [
      {
        key: "apiBaseUrl",
        label: "接口地址",
        description: "百度账号配置与 RPA 任务接口的后端根地址。",
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
        description: "调用 setInputFiles 后等待全部剧集上传完成的最长时间。",
        type: "number",
        suffix: "分钟",
        min: 1,
      },
    ],
  },
  {
    title: "浏览器与日志",
    description: "百度短剧使用独立 Chromium 登录态；共享目录在全局配置中统一管理。",
    fields: [
      {
        key: "logRetentionDays",
        label: "日志保留",
        description: "服务启动时清理超过指定天数的日志文件。",
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
        description: "首次登录和排查页面变化时建议显示浏览器。",
        activeLabel: "无头运行",
        inactiveLabel: "显示浏览器",
      },
    ],
  },
]

export function BaiduDramaConfigurationPage() {
  const configState = usePlatformConfig({
    emptyConfig,
    getConfig: baiduDramaService.getConfig,
    saveConfig: baiduDramaService.saveConfig,
  })

  return (
    <ConfigurationPageFrame
      hasChanges={configState.hasChanges}
      loading={configState.loading}
      restartRequired={configState.restartRequired}
      title="百度短剧配置"
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
