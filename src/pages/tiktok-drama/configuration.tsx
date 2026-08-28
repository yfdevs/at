import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  tiktokDramaCenterService,
  type TiktokDramaCenterConfig,
} from "@/platforms/tiktok-drama/service"

const emptyConfig: TiktokDramaCenterConfig = {
  feishuBotWebhookUrl: "",
  headless: "false",
  localEpisodeVideoRoot: "",
  operationDelaySeconds: "0.02",
  runDataDir: ".drama-runs/tiktok-drama",
}

const sections: ConfigSectionDefinition<TiktokDramaCenterConfig>[] = [
  {
    title: "浏览器与通知",
    description: "TikTok 使用独立登录态；共享目录在全局配置中统一管理。",
    fields: [
      {
        key: "feishuBotWebhookUrl",
        label: "飞书机器人 Webhook",
        type: "url",
        description: "留空不推送运行通知。",
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

export function TiktokDramaCenterConfigurationPage() {
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
    getConfig: tiktokDramaCenterService.getConfig,
    saveConfig: tiktokDramaCenterService.saveConfig,
  })

  return (
    <ConfigurationPageFrame
      hasChanges={hasChanges}
      loading={loading}
      restartRequired={restartRequired}
      title="TikTok 配置"
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
        />
      ))}
    </ConfigurationPageFrame>
  )
}
