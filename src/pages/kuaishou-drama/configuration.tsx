import { useState } from "react"
import { toast } from "sonner"

import { Separator } from "@/components/ui/separator"
import {
  ConfigPanelSection,
  ConfigSection,
  ConfigurationPageFrame,
  StoragePathRow,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  kuaishouDramaService,
  type KuaishouDramaConfig,
  type KuaishouDramaConfigResult,
  type KuaishouDramaStoragePathKey,
  type KuaishouDramaStoragePaths,
} from "@/platforms/kuaishou-drama/service"

const emptyConfig: KuaishouDramaConfig = {
  accountProfileName: "default",
  headless: "false",
  operationDelaySeconds: "0",
  runDataDir: ".drama-runs/kuaishou-drama",
  logRetentionDays: "3",
  mockTaskEnabled: "true",
}

const emptyStoragePaths: KuaishouDramaStoragePaths = {
  runDataDir: "",
  accountDir: "",
  userDataDir: "",
  credentialStatePath: "",
  assetDownloadDir: "",
  logDir: "",
  logFilePath: "",
}

const configSections: ConfigSectionDefinition<KuaishouDramaConfig>[] = [
  {
    title: "浏览器与运行数据",
    description: "登录态和临时文件由快手短剧平台独立管理。",
    fields: [
      {
        key: "accountProfileName",
        label: "账号配置名",
        description: "每个账号配置名对应一个独立浏览器登录态目录。",
      },
      {
        key: "runDataDir",
        label: "运行数据目录",
        description: "保存账号登录态、日志、素材缓存和调试快照。",
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
        key: "mockTaskEnabled",
        label: "调试任务数据",
        description: "后端任务接口接入前，启动服务后使用模拟任务填充上剧表单。",
        activeLabel: "自动填表示例任务",
        inactiveLabel: "只打开浏览器",
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

const storagePathRows: Array<{
  key: keyof KuaishouDramaStoragePaths
  label: string
  description: string
}> = [
  {
    key: "runDataDir",
    label: "运行数据目录",
    description: "快手平台所有运行文件的根目录。",
  },
  {
    key: "accountDir",
    label: "账号目录",
    description: "当前账号 profile 的独立目录。",
  },
  {
    key: "userDataDir",
    label: "浏览器登录态",
    description: "Chromium 持久化 profile，登录后 cookie、Local Storage 和缓存会保存在这里。",
  },
  {
    key: "credentialStatePath",
    label: "登录态快照",
    description: "用于排查的 storage-state.json，不作为共享登录态注入。",
  },
  {
    key: "logDir",
    label: "日志目录",
    description: "运行日志按日期写入此目录。",
  },
  {
    key: "assetDownloadDir",
    label: "素材缓存",
    description: "远程封面、授权材料、海报下载后临时保存在这里。",
  },
]

export function KuaishouDramaConfigurationPage() {
  const [storagePaths, setStoragePaths] = useState<KuaishouDramaStoragePaths>(emptyStoragePaths)
  const [configFilePath, setConfigFilePath] = useState("")
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
    getConfig: kuaishouDramaService.getConfig,
    saveConfig: kuaishouDramaService.saveConfig,
    onApplyResult: (result: KuaishouDramaConfigResult) => {
      setStoragePaths(result.storagePaths)
      setConfigFilePath(result.path)
    },
  })

  const selectDirectory = async (key: keyof KuaishouDramaConfig & string) => {
    if (key !== "runDataDir") return

    try {
      const selectedPath = await kuaishouDramaService.selectRunDataDir(config.runDataDir)
      if (selectedPath) {
        updateConfig(key, selectedPath)
      }
    } catch (error) {
      toast.error("目录选择失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const openStoragePath = async (key: KuaishouDramaStoragePathKey) => {
    try {
      await kuaishouDramaService.openStoragePath(key)
    } catch (error) {
      toast.error("打开路径失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <ConfigurationPageFrame
      hasChanges={hasChanges}
      loading={loading}
      restartRequired={restartRequired}
      title="快手短剧配置"
      onDiscard={discardChanges}
      onSave={persistConfig}
    >
      {configSections.map((section) => (
        <ConfigSection
          key={section.title}
          config={config}
          fields={section.fields}
          section={section}
          onChange={updateConfig}
          onSelectDirectory={selectDirectory}
        />
      ))}

      <ConfigPanelSection
        description="当前配置会使用这些路径保存登录态、日志和下载素材。"
        title="文件位置"
      >
        <StoragePathRow
          description="electron-store 保存的配置文件。"
          label="配置文件"
          pathText={configFilePath}
          onOpen={() => openStoragePath("configFilePath")}
        />
        {storagePathRows.map((row) => (
          <div key={row.key}>
            <Separator />
            <StoragePathRow
              description={row.description}
              label={row.label}
              pathText={storagePaths[row.key] ?? ""}
              onOpen={() => openStoragePath(row.key)}
            />
          </div>
        ))}
        <Separator />
        <StoragePathRow
          description="打开最近一次运行日志；没有日志时打开日志目录。"
          label="最近日志"
          pathText={storagePaths.logFilePath}
          onOpen={() => openStoragePath("latestLog")}
        />
      </ConfigPanelSection>
    </ConfigurationPageFrame>
  )
}
