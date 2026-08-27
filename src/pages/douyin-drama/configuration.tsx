import { toast } from "sonner"

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
  accountProfileName: "default",
  apiBaseUrl: "",
  useMockTask: "false",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
  episodeUploadWaitTimeoutMinutes: "120",
  headless: "false",
  operationDelaySeconds: "0",
  taskPollIntervalSeconds: "10",
  runDataDir: ".drama-runs/douyin-drama",
  logRetentionDays: "3",
}

const sections: ConfigSectionDefinition<DouyinDramaConfig>[] = [
  {
    title: "任务与素材",
    description: "领取接口接入前可启用内置测试任务；网盘素材会按原始剧名下载并校验。",
    fields: [
      {
        key: "apiBaseUrl",
        label: "接口地址",
        description: "预留的抖音 RPA 后端接口根地址，空 API 接入后直接复用。",
        type: "url",
      },
      {
        kind: "switch",
        key: "useMockTask",
        label: "内置测试任务",
        description: "开启后只领取一次真实结构的假数据，submit=false，不会自动点击最终提交。",
        activeLabel: "已启用",
        inactiveLabel: "已关闭",
      },
      {
        key: "localEpisodeVideoRoot",
        label: "剧集视频根目录",
        description: "百度网盘资源与本地剧集按原始剧名建立子目录。",
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
        description: "等待全部剧集上传与处理完成的最长时间。",
        type: "number",
        suffix: "分钟",
        min: 1,
      },
    ],
  },
  {
    title: "浏览器与运行数据",
    description: "抖音短剧使用独立 Chromium 登录态；日志和动态下拉记录保存在运行目录。",
    fields: [
      {
        key: "accountProfileName",
        label: "账号配置名",
        description: "用于隔离浏览器登录态目录。",
      },
      {
        key: "runDataDir",
        label: "运行数据目录",
        description: "保存登录态、素材缓存、日志与 dropdown-options.json。",
        directory: true,
      },
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
    ],
  },
]

export function DouyinDramaConfigurationPage() {
  const configState = usePlatformConfig({
    emptyConfig,
    getConfig: douyinDramaService.getConfig,
    saveConfig: douyinDramaService.saveConfig,
  })

  const selectDirectory = async (key: Extract<keyof DouyinDramaConfig, string>) => {
    try {
      const selected = key === "runDataDir"
        ? await douyinDramaService.selectRunDataDir(configState.config.runDataDir)
        : await douyinDramaService.selectLocalEpisodeVideoRoot(
            configState.config.localEpisodeVideoRoot,
          )
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
          onSelectDirectory={selectDirectory}
        />
      ))}
    </ConfigurationPageFrame>
  )
}
