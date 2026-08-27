import { ExternalLink } from "@mynaui/icons-react"
import { useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  returnRouteFromLocationState,
  routePath,
} from "@/config/navigation"
import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page"
import {
  globalAppConfigService,
  type GlobalAppConfig,
} from "@/platforms/app-config/service"

const emptyConfig: GlobalAppConfig = {
  aiApiKey: "",
  aiBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
  aiModel: "doubao-seed-2-0-pro-260215",
}

const sections: ConfigSectionDefinition<GlobalAppConfig>[] = [
  {
    title: "AI 服务",
    description: "各平台共享的 OpenAI SDK 兼容配置，可接入提供兼容接口的任意模型服务。",
    fields: [
      {
        key: "aiApiKey",
        label: "API Key",
        description: "火山方舟请在 API Key 管理页面创建。密钥使用系统凭据加密保存在本机，不写入环境变量或日志。",
        type: "password",
      },
      {
        key: "aiModel",
        label: "模型 ID",
        description: "火山方舟推荐 doubao-seed-2-0-pro-260215，可用于封面理解、主体定位、图片分类和文本推理。",
      },
      {
        key: "aiBaseURL",
        label: "API Base URL",
        description: "火山方舟填写 https://ark.cn-beijing.volces.com/api/v3；其他服务商填写其 OpenAI 兼容接口地址。",
        type: "url",
      },
    ],
  },
]

export function GlobalConfigurationPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [testing, setTesting] = useState(false)
  const returnRoute = returnRouteFromLocationState(location.state)
  const configState = usePlatformConfig({
    emptyConfig,
    getConfig: globalAppConfigService.getConfig,
    saveConfig: globalAppConfigService.saveConfig,
  })

  const testConnection = async () => {
    setTesting(true)
    try {
      const result = await globalAppConfigService.testConfig(configState.config)
      toast.success("AI 服务连接成功", {
        description: `${result.model} · ${result.latencyMs} ms · ${result.responseText}`,
      })
    } catch (error) {
      toast.error("AI 服务连接失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <ConfigurationPageFrame
      hasChanges={configState.hasChanges}
      loading={configState.loading}
      restartRequired={configState.restartRequired}
      title="全局配置"
      onClose={() => {
        void navigate(routePath(returnRoute))
      }}
      onDiscard={configState.discardChanges}
      onSave={configState.persistConfig}
    >
      {sections.map((section) => (
        <ConfigSection
          key={section.title}
          config={configState.config}
          fields={section.fields}
          footer={(
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                className="w-fit"
                onClick={() => {
                  void globalAppConfigService.openArkApiKeyPage()
                }}
                variant="ghost"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
                获取火山方舟 API Key
              </Button>
              <Button
                className="w-fit"
                disabled={configState.loading || testing}
                onClick={() => {
                  void testConnection()
                }}
                variant="outline"
              >
                {testing ? "测试中…" : "测试图片与文本能力"}
              </Button>
            </div>
          )}
          section={section}
          onChange={configState.updateConfig}
        />
      ))}
    </ConfigurationPageFrame>
  )
}
