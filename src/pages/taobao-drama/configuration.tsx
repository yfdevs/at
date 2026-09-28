import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  taobaoDramaService,
  type TaobaoDramaConfig,
} from "@/platforms/taobao-drama/service"

const emptyConfig: TaobaoDramaConfig = {
  accountProfileName: "default",
  headless: "false",
  operationDelaySeconds: "0",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  closeFailedTaskPages: "false",
  runDataDir: ".drama-runs/taobao-drama",
  logRetentionDays: "3",
}

const sections: ConfigSectionDefinition<TaobaoDramaConfig>[] = [
  {
    title: "账号与素材",
    description: "淘宝使用独立浏览器登录态；Excel 只负责导入，上传任务统一从本地数据库读取。",
    fields: [
      { key: "accountProfileName", label: "浏览器账号标识", type: "text", description: "用于隔离淘宝登录态，本地单账号运行，不再读取后台账号。" },
      { key: "baiduNetdiskDownloadRetryAttempts", label: "网盘下载重试", type: "number", suffix: "次", min: 0, description: "百度网盘素材准备失败后的重试次数。" },
    ],
  },
  {
    title: "浏览器与上传",
    description: "直接进入淘宝批量发布页面，不创建合集，也不填写剧目资料。素材根目录使用全局配置。",
    fields: [
      { key: "episodeUploadWaitTimeoutMinutes", label: "视频上传等待", type: "number", suffix: "分钟", min: 1, description: "等待全部剧集上传完成的最长时间。" },
      { key: "operationDelaySeconds", label: "操作延迟", type: "number", suffix: "秒", step: "0.01", description: "每一步 Playwright 操作之间的延迟。" },
      { kind: "switch", key: "headless", label: "浏览器窗口", description: "登录和安全校验需要显示浏览器。", activeLabel: "无头运行", inactiveLabel: "显示浏览器" },
    ],
  },
  {
    title: "失败现场",
    description: "成功任务在两次10秒结算与成功校验完成后关闭；失败任务默认保留页面。",
    fields: [
      { kind: "switch", key: "closeFailedTaskPages", label: "失败任务页面", description: "是否在失败结果回写后关闭对应标签页。", activeLabel: "自动关闭失败页", inactiveLabel: "保留失败页" },
      { key: "logRetentionDays", label: "日志保留", type: "number", suffix: "天", min: 1, description: "自动清理超过期限的淘宝运行日志。" },
    ],
  },
]

export function TaobaoDramaConfigurationPage() {
  const state = usePlatformConfig({
    emptyConfig,
    getConfig: taobaoDramaService.getConfig,
    saveConfig: taobaoDramaService.saveConfig,
  })
  return (
    <ConfigurationPageFrame
      hasChanges={state.hasChanges}
      loading={state.loading}
      restartRequired={state.restartRequired}
      title="淘宝短剧配置"
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
