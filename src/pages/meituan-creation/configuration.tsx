import { toast } from "sonner"

import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  meituanCreationService,
  type MeituanCreationConfig,
} from "@/platforms/meituan-creation/service"

const emptyConfig: MeituanCreationConfig = {
  headless: "false",
  operationDelaySeconds: "0.02",
  localEpisodeVideoRoot: "",
  runDataDir: ".drama-runs/meituan-creation",
}

const sections: ConfigSectionDefinition<MeituanCreationConfig>[] = [
  {
    title: "文件与浏览器",
    description: "视频目录、登录态和临时文件由美团平台配置独立管理。",
    fields: [
      {
        key: "localEpisodeVideoRoot",
        label: "剧集视频目录",
        description: "按合集标题匹配 xxx-第1集.mp4 这类本地视频。",
        directory: true,
      },
      {
        key: "runDataDir",
        label: "运行数据目录",
        description: "默认保存到 .drama-runs/meituan-creation，浏览器登录态位于该目录的 auth 子目录。",
        directory: true,
      },
      {
        key: "operationDelaySeconds",
        label: "操作延迟",
        type: "number",
        description: "每一步 Playwright 操作之间的延迟。",
        suffix: "秒",
        step: "0.01",
      },
      {
        kind: "switch",
        key: "headless",
        label: "浏览器窗口",
        description: "登录和排查问题时建议显示浏览器。",
        activeLabel: "无头运行",
        inactiveLabel: "显示浏览器",
      },
    ],
  },
]

export function MeituanCreationConfigurationPage() {
  const {
    config,
    discardChanges,
    hasChanges,
    loading,
    persistConfig,
    restartRequired,
    updateConfig,
  } = usePlatformConfig({
    emptyConfig,
    getConfig: meituanCreationService.getConfig,
    saveConfig: meituanCreationService.saveConfig,
  })

  const selectDirectory = async (key: keyof MeituanCreationConfig & string) => {
    try {
      const selectedPath =
        key === "localEpisodeVideoRoot"
          ? await meituanCreationService.selectLocalEpisodeVideoRoot(config.localEpisodeVideoRoot)
          : await meituanCreationService.selectRunDataDir(config.runDataDir)

      if (selectedPath) {
        updateConfig(key, selectedPath)
      }
    } catch (error) {
      toast.error("目录选择失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <ConfigurationPageFrame
      hasChanges={hasChanges}
      loading={loading}
      restartRequired={restartRequired}
      title="美团创作平台配置"
      onDiscard={discardChanges}
      onSave={persistConfig}
    >
      {sections.map((section) => (
        <ConfigSection
          key={section.title}
          config={config}
          fields={section.fields}
          section={section}
          onChange={updateConfig}
          onSelectDirectory={selectDirectory}
        />
      ))}
    </ConfigurationPageFrame>
  )
}
