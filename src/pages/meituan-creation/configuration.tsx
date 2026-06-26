import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, FolderOpen, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  meituanCreationService,
  type MeituanCreationConfig,
  type MeituanCreationConfigResult,
} from "@/platforms/meituan-creation/service"

const emptyConfig: MeituanCreationConfig = {
  headless: "false",
  operationDelaySeconds: "0.02",
  localEpisodeVideoRoot: "",
  runDataDir: ".drama-runs/meituan-creation",
}

type TextField = {
  kind?: "text"
  key: keyof MeituanCreationConfig
  label: string
  description?: string
  type?: "text" | "number"
  suffix?: string
  directory?: boolean
}

type SwitchField = {
  kind: "switch"
  key: keyof MeituanCreationConfig
  label: string
  description?: string
  activeLabel: string
  inactiveLabel: string
}

type ConfigField = TextField | SwitchField

const sections: Array<{
  title: string
  description: string
  fields: ConfigField[]
}> = [
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
  const [config, setConfig] = useState<MeituanCreationConfig>(emptyConfig)
  const [savedConfig, setSavedConfig] = useState<MeituanCreationConfig>(emptyConfig)
  const [restartRequired, setRestartRequired] = useState(false)
  const [loading, setLoading] = useState(false)

  const hasChanges = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig]
  )

  const applyResult = (result: MeituanCreationConfigResult) => {
    setConfig(result.config)
    setSavedConfig(result.config)
    setRestartRequired(result.restartRequired)
  }

  useEffect(() => {
    setLoading(true)
    meituanCreationService
      .getConfig()
      .then(applyResult)
      .catch((error) => {
        toast.error("配置读取失败", {
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const updateConfig = (key: keyof MeituanCreationConfig, value: string) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const discardChanges = () => {
    setConfig(savedConfig)
  }

  const saveConfig = async () => {
    setLoading(true)
    try {
      const result = await meituanCreationService.saveConfig(config)
      applyResult(result)
      if (result.restartRequired) {
        toast.warning("配置已保存", {
          description: "服务正在运行，请重启服务后生效。",
        })
      } else {
        toast.success("配置已保存")
      }
    } catch (error) {
      toast.error("配置保存失败", {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  const selectDirectory = async (key: "localEpisodeVideoRoot" | "runDataDir") => {
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
    <main className="flex min-h-svh flex-1 flex-col bg-muted/20">
      <div className="sticky top-0 z-10 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="mr-1 text-lg font-semibold tracking-normal">美团创作平台配置</h1>
            <span
              className={
                hasChanges
                  ? "inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 text-xs font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                  : "inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium text-muted-foreground"
              }
            >
              {hasChanges ? (
                <AlertTriangle className="size-3.5" />
              ) : (
                <CheckCircle2 className="size-3.5 text-emerald-600" />
              )}
              {hasChanges ? "未保存" : "已保存"}
            </span>
            {restartRequired ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-2 text-xs font-medium text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
                <AlertTriangle className="size-3.5" />
                需重启
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            {hasChanges ? (
              <Button className="w-fit" disabled={loading} onClick={discardChanges} variant="outline">
                <RotateCcw />
                放弃
              </Button>
            ) : null}
            <Button className="w-fit" disabled={loading || !hasChanges} onClick={saveConfig}>
              <Save />
              保存配置
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-7 p-6">
        <div className="flex w-full min-w-0 flex-col gap-4">
          {sections.map((section) => (
            <section id={section.title} key={section.title} className="scroll-mt-28 space-y-3">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">{section.title}</h2>
                <p className="text-xs text-muted-foreground sm:text-sm">{section.description}</p>
              </div>
              <Card className="rounded-lg bg-background py-0">
                <CardContent className="py-0">
                  <FieldGroup className="gap-0">
                    {section.fields.map((field, index) => (
                      <div key={field.key}>
                        {index > 0 ? <Separator /> : null}
                        <ConfigFieldControl
                          config={config}
                          field={field}
                          onChange={updateConfig}
                          onSelectDirectory={selectDirectory}
                        />
                      </div>
                    ))}
                  </FieldGroup>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}

function ConfigFieldControl({
  config,
  field,
  onChange,
  onSelectDirectory,
}: {
  config: MeituanCreationConfig
  field: ConfigField
  onChange: (key: keyof MeituanCreationConfig, value: string) => void
  onSelectDirectory: (key: "localEpisodeVideoRoot" | "runDataDir") => void
}) {
  const value = config[field.key]
  const directoryKey =
    field.key === "localEpisodeVideoRoot" || field.key === "runDataDir"
      ? field.key
      : null

  if (field.kind === "switch") {
    const checked = value === "true"

    return (
      <Field className="gap-2.5 py-3 md:grid md:grid-cols-[minmax(220px,1fr)_280px] md:items-center">
        <FieldContent>
          <FieldLabel htmlFor={field.key}>{field.label}</FieldLabel>
          {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
        </FieldContent>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {checked ? field.activeLabel : field.inactiveLabel}
          </span>
          <Switch
            id={field.key}
            checked={checked}
            onCheckedChange={(nextChecked) => onChange(field.key, nextChecked ? "true" : "false")}
          />
        </div>
      </Field>
    )
  }

  return (
    <Field className="gap-2.5 py-3 md:grid md:grid-cols-[minmax(220px,1fr)_280px] md:items-start">
      <FieldContent>
        <FieldLabel htmlFor={field.key}>{field.label}</FieldLabel>
        {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
      </FieldContent>
      <div className="w-full min-w-0">
        <InputGroup>
          <InputGroupInput
            id={field.key}
            min={field.type === "number" ? 0 : undefined}
            step={field.key === "operationDelaySeconds" ? "0.01" : undefined}
            type={field.type ?? "text"}
            value={value}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
          {field.suffix ? (
            <InputGroupAddon align="inline-end">
              <InputGroupText>{field.suffix}</InputGroupText>
            </InputGroupAddon>
          ) : null}
          {field.directory && directoryKey ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label={`选择${field.label}`}
                onClick={() => onSelectDirectory(directoryKey)}
              >
                <FolderOpen />
                选择
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
    </Field>
  )
}
