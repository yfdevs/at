import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  tencentHuolongDramaService,
  type TencentHuolongDramaConfig,
} from "@/platforms/tencent-huolong-drama/service"

const emptyConfig: TencentHuolongDramaConfig = {
  accountProfileName: "default",
  apiBaseUrl: "http://180.184.76.232:19090",
  localMaterialRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  episodeUploadFailedRetryAttempts: "3",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  closeFailedTaskPages: "false",
  runDataDir: ".drama-runs/tencent-huolong-drama",
  logRetentionDays: "3",
}

const sections: ConfigSectionDefinition<TencentHuolongDramaConfig>[] = [
  {
    title: "任务接口",
    description: "读取启用账号并自动领取腾讯火龙漫剧上剧任务。",
    fields: [
      { key: "apiBaseUrl", label: "接口地址", description: "后端 RPA 任务接口根地址。", type: "url" },
      { key: "taskPollIntervalSeconds", label: "任务轮询间隔", description: "没有任务时再次领取的间隔。", type: "number", suffix: "秒", min: 1 },
      {
        kind: "switch",
        key: "closeFailedTaskPages",
        label: "失败任务页面",
        description: "任务失败后是否关闭对应标签页；保留页面便于检查失败现场。",
        activeLabel: "自动关闭失败页",
        inactiveLabel: "保留失败页",
      },
      { key: "baiduNetdiskDownloadRetryAttempts", label: "网盘下载重试", description: "百度网盘资源下载失败后的重试次数。", type: "number", suffix: "次", min: 0 },
      { key: "episodeUploadWaitTimeoutMinutes", label: "视频上传等待", description: "等待全部剧集上传完成的最长时间。", type: "number", suffix: "分钟", min: 1 },
      { key: "episodeUploadFailedRetryAttempts", label: "上传失败重试", description: "单集上传失败后的最多重试次数。", type: "number", suffix: "次", min: 0 },
    ],
  },
  {
    title: "浏览器与日志",
    description: "平台使用独立 Chromium 登录态；素材与运行目录由全局配置统一管理。",
    fields: [
      { key: "logRetentionDays", label: "日志保留", description: "自动清理超过期限的日志。", type: "number", suffix: "天", min: 1 },
      { key: "operationDelaySeconds", label: "操作延迟", description: "每一步 Playwright 操作之间的延迟。", type: "number", suffix: "秒", step: "0.01" },
      { kind: "switch", key: "headless", label: "浏览器窗口", description: "首次登录或排查问题时建议显示浏览器。", activeLabel: "无头运行", inactiveLabel: "显示浏览器" },
    ],
  },
]

export function TencentHuolongDramaConfigurationPage() {
  const state = usePlatformConfig({
    emptyConfig,
    getConfig: tencentHuolongDramaService.getConfig,
    saveConfig: tencentHuolongDramaService.saveConfig,
  })
  return (
    <ConfigurationPageFrame
      hasChanges={state.hasChanges}
      loading={state.loading}
      restartRequired={state.restartRequired}
      title="腾讯火龙漫剧配置"
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
