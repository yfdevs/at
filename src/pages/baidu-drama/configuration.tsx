import { toast } from "sonner"

import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import { baiduDramaService, type BaiduDramaConfig } from "@/platforms/baidu-drama/service"

const emptyConfig: BaiduDramaConfig = {
  accountProfileName: "default",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: ".drama-runs/baidu-drama",
}

const sections: ConfigSectionDefinition<BaiduDramaConfig>[] = [
  {
    title: "任务与素材",
    description: "领取接口就绪后会按原始剧名下载、校验并上传百度网盘资源。",
    fields: [
      {
        key: "localEpisodeVideoRoot",
        label: "剧集视频根目录",
        description: "启动服务前必须选择。百度网盘资源与本地剧集会按原始剧名建立子目录。",
        directory: true,
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
    title: "浏览器与运行数据",
    description: "百度短剧使用独立 Chromium 登录态和素材缓存。",
    fields: [
      {
        key: "accountProfileName",
        label: "账号配置名",
        description: "用于隔离浏览器登录态目录。",
      },
      {
        key: "runDataDir",
        label: "运行数据目录",
        description: "保存百度短剧登录态、临时上传文件和日志。",
        directory: true,
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

  const selectDirectory = async (key: keyof BaiduDramaConfig & string) => {
    try {
      const selected = key === "runDataDir"
        ? await baiduDramaService.selectRunDataDir(configState.config.runDataDir)
        : await baiduDramaService.selectLocalEpisodeVideoRoot(configState.config.localEpisodeVideoRoot)
      if (selected) configState.updateConfig(key, selected)
    } catch (error) {
      toast.error("目录选择失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

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
          onSelectDirectory={selectDirectory}
        />
      ))}
    </ConfigurationPageFrame>
  )
}
