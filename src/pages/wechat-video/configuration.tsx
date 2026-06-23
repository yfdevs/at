import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  RotateCcw,
  Save,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  wechatVideoService,
  type WechatVideoConfig,
  type WechatVideoConfigResult,
} from "@/platforms/wechat-video/service"

const emptyConfig: WechatVideoConfig = {
  apiBaseUrl: "http://180.184.76.232:19090",
  videoAccountContractSubjects: "MINGXINGSHUO,MISU,WEITAO",
  localEpisodeVideoRoot: "",
  closeFailedTaskPages: "false",
  runDataDir: ".drama-runs",
  logRetentionDays: "3",
  workerEmptyClaimDelaySeconds: "5",
  workerSlowEmptyClaimThreshold: "30",
  workerSlowEmptyClaimDelaySeconds: "30",
  videoAccountSyncIntervalSeconds: "600",
  idlePageRefreshIntervalSeconds: "10800",
  idlePageRefreshTimeoutSeconds: "60",
  idlePageRefreshJitterSeconds: "300",
  basicInfoStepTimeoutSeconds: "600",
  remoteFileDownloadTimeoutSeconds: "120",
  episodeUploadWaitTimeoutSeconds: "7200",
  episodeUploadFailedRetryAttempts: "3",
  feishuBotWebhookUrl: "",
}

type TextField = {
  kind?: "text"
  key: keyof WechatVideoConfig
  label: string
  description?: string
  type?: "text" | "number" | "url"
  suffix?: string
}

type SelectField = {
  kind: "select"
  key: keyof WechatVideoConfig
  label: string
  description?: string
  options: Array<{ value: string; label: string }>
}

type SwitchField = {
  kind: "switch"
  key: keyof WechatVideoConfig
  label: string
  description?: string
  activeLabel: string
  inactiveLabel: string
}

type SubjectField = {
  kind: "subjects"
  key: "videoAccountContractSubjects"
  label: string
  description?: string
  options: Array<{ value: string; label: string }>
}

type ConfigField = TextField | SelectField | SwitchField | SubjectField
type MessageTone = "success" | "error"

const contractSubjectOptions = [
  { label: "明星说", value: "MINGXINGSHUO" },
  { label: "米苏", value: "MISU" },
  { label: "微淘", value: "WEITAO" },
]

const sections: Array<{
  title: string
  description: string
  fields: ConfigField[]
}> = [
  {
    title: "接口连接",
    description: "自动化服务连接的后端地址。",
    fields: [
      {
        key: "apiBaseUrl",
        label: "后端接口地址",
        type: "url",
        description: "默认使用线上服务，必要时改成本地或测试地址。",
      },
      {
        kind: "subjects",
        key: "videoAccountContractSubjects",
        label: "主体配置",
        description: "只启动所选主体下的视频号账号。",
        options: contractSubjectOptions,
      },
    ],
  },
  {
    title: "文件与日志",
    description: "视频目录和运行数据目录必须在同一磁盘。",
    fields: [
      {
        key: "localEpisodeVideoRoot",
        label: "剧集视频根目录",
        description: "按剧目名查找本地视频，需与运行数据目录同盘。",
      },
      {
        key: "runDataDir",
        label: "运行数据目录",
        description: "保存临时上传文件、远程素材缓存和日志。",
      },
      {
        key: "logRetentionDays",
        label: "日志保留",
        type: "number",
        description: "超过天数的日志会被清理。",
        suffix: "天",
      },
    ],
  },
  {
    title: "任务调度",
    description: "领取任务和账号同步频率。",
    fields: [
      {
        kind: "switch",
        key: "closeFailedTaskPages",
        label: "任务页面处理",
        description: "新任务开始前是否清理上次失败页面。",
        activeLabel: "自动关闭旧页面",
        inactiveLabel: "保留旧页面",
      },
      {
        key: "workerEmptyClaimDelaySeconds",
        label: "空任务短轮询",
        type: "number",
        description: "没有任务时，前几次领取的等待间隔。",
        suffix: "秒",
      },
      {
        key: "workerSlowEmptyClaimThreshold",
        label: "慢轮询切换次数",
        type: "number",
        description: "连续空任务达到此次数后，改用慢轮询。",
      },
      {
        key: "workerSlowEmptyClaimDelaySeconds",
        label: "空任务慢轮询",
        type: "number",
        description: "长时间无任务后的领取间隔。",
        suffix: "秒",
      },
      {
        key: "videoAccountSyncIntervalSeconds",
        label: "账号同步间隔",
        type: "number",
        description: "定时同步视频号账号状态。",
        suffix: "秒",
      },
    ],
  },
  {
    title: "超时设置",
    description: "页面等待和网络操作上限。",
    fields: [
      {
        key: "idlePageRefreshIntervalSeconds",
        label: "空闲保活间隔",
        type: "number",
        description: "浏览器空闲多久后刷新保活。",
        suffix: "秒",
      },
      {
        key: "idlePageRefreshTimeoutSeconds",
        label: "空闲保活超时",
        type: "number",
        description: "保活刷新超过此时间视为失败。",
        suffix: "秒",
      },
      {
        key: "idlePageRefreshJitterSeconds",
        label: "保活随机错峰",
        type: "number",
        description: "给保活时间增加随机偏移，避免同时刷新。",
        suffix: "秒",
      },
      {
        key: "basicInfoStepTimeoutSeconds",
        label: "基础信息填写超时",
        type: "number",
        description: "填写标题、简介等基础信息的最长等待。",
        suffix: "秒",
      },
      {
        key: "remoteFileDownloadTimeoutSeconds",
        label: "远程素材下载超时",
        type: "number",
        description: "下载远程视频素材的最长等待。",
        suffix: "秒",
      },
    ],
  },
  {
    title: "上传与通知",
    description: "上传等待、失败重试和飞书通知。",
    fields: [
      {
        key: "episodeUploadWaitTimeoutSeconds",
        label: "剧集上传等待",
        type: "number",
        description: "等待平台完成剧集上传处理。",
        suffix: "秒",
      },
      {
        kind: "select",
        key: "episodeUploadFailedRetryAttempts",
        label: "上传失败重试",
        description: "单集上传失败后的最多重试次数。",
        options: [
          { value: "0", label: "不重试" },
          { value: "3", label: "最多 3 次" },
          { value: "5", label: "最多 5 次" },
          { value: "8", label: "最多 8 次" },
          { value: "12", label: "最多 12 次" },
        ],
      },
      {
        key: "feishuBotWebhookUrl",
        label: "飞书机器人 Webhook",
        type: "url",
        description: "留空不推送运行通知。",
      },
    ],
  },
]

export function WechatConfigurationPage() {
  const [config, setConfig] = useState<WechatVideoConfig>(emptyConfig)
  const [savedConfig, setSavedConfig] = useState<WechatVideoConfig>(emptyConfig)
  const [message, setMessage] = useState("")
  const [messageTone, setMessageTone] = useState<MessageTone>("success")
  const [restartRequired, setRestartRequired] = useState(false)
  const [loading, setLoading] = useState(false)

  const applyResult = (result: WechatVideoConfigResult) => {
    setConfig(result.config)
    setSavedConfig(result.config)
    setRestartRequired(result.restartRequired)
  }

  const hasChanges = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig]
  )

  useEffect(() => {
    setLoading(true)
    wechatVideoService
      .getConfig()
      .then(applyResult)
      .catch((error) => {
        setMessageTone("error")
        setMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setLoading(false))
  }, [])

  const updateConfig = (key: keyof WechatVideoConfig, value: string) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setMessage("")
  }

  const discardChanges = () => {
    setConfig(savedConfig)
    setMessage("")
  }

  const saveConfig = async () => {
    setLoading(true)
    setMessage("")
    try {
      const result = await wechatVideoService.saveConfig(config)
      applyResult(result)
      setMessageTone("success")
      setMessage(result.restartRequired ? "配置已保存。服务正在运行，请重启服务后生效。" : "配置已保存。")
    } catch (error) {
      setMessageTone("error")
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const selectDirectory = async (key: "localEpisodeVideoRoot" | "runDataDir") => {
    try {
      const selectedPath =
        key === "localEpisodeVideoRoot"
          ? await wechatVideoService.selectLocalEpisodeVideoRoot(config.localEpisodeVideoRoot)
          : await wechatVideoService.selectRunDataDir(config.runDataDir)

      if (!selectedPath) {
        return
      }

      updateConfig(key, selectedPath)
    } catch (error) {
      setMessageTone("error")
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main className="flex min-h-svh flex-1 flex-col bg-muted/20">
      <div className="sticky top-0 z-10 border-b bg-background/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-normal">配置管理</h1>
            <p className="text-sm text-muted-foreground">
              配置会缓存到本机，保存后由服务启动时读取。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={hasChanges ? "hidden text-sm text-destructive sm:inline" : "hidden text-sm text-muted-foreground sm:inline"}>
              {hasChanges ? "有未保存更改" : "当前配置已保存"}
            </span>
            {hasChanges ? (
              <Button
                className="w-fit"
                disabled={loading}
                onClick={discardChanges}
                variant="outline"
              >
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
          {restartRequired ? (
            <StatusNotice
              icon={<AlertTriangle className="size-4 text-amber-600" />}
              tone="warning"
            >
              配置已变化，当前服务需要停止后重新启动才能使用新配置。
            </StatusNotice>
          ) : null}

          {message ? (
            <StatusNotice
              icon={
                messageTone === "error" ? (
                  <AlertTriangle className="size-4 text-destructive" />
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                )
              }
              tone={messageTone}
            >
              {message}
            </StatusNotice>
          ) : null}

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

function StatusNotice({
  children,
  icon,
  tone = "default",
}: {
  children: ReactNode
  icon: ReactNode
  tone?: "default" | "warning" | "success" | "error"
}) {
  const className =
    tone === "warning"
      ? "flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      : tone === "error"
        ? "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        : "flex items-start gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground"

  return (
    <div className={className}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  )
}

function ConfigFieldControl({
  config,
  field,
  onChange,
  onSelectDirectory,
}: {
  config: WechatVideoConfig
  field: ConfigField
  onChange: (key: keyof WechatVideoConfig, value: string) => void
  onSelectDirectory: (key: "localEpisodeVideoRoot" | "runDataDir") => void
}) {
  const value = config[field.key]
  const directoryKey =
    field.key === "localEpisodeVideoRoot" || field.key === "runDataDir"
      ? field.key
      : null

  if (field.kind === "subjects") {
    const selectedSubjects = new Set(
      value
        .split(",")
        .map((subject) => subject.trim())
        .filter(Boolean)
    )

    const toggleSubject = (subject: string, checked: boolean) => {
      const nextSubjects = new Set(selectedSubjects)

      if (checked) {
        nextSubjects.add(subject)
      } else {
        nextSubjects.delete(subject)
      }

      onChange(
        field.key,
        field.options
          .map((option) => option.value)
          .filter((subject) => nextSubjects.has(subject))
          .join(",")
      )
    }

    return (
      <Field className="gap-2.5 py-3 md:grid md:grid-cols-[minmax(220px,1fr)_280px] md:items-start">
        <FieldContent>
          <FieldLabel>{field.label}</FieldLabel>
          {field.description ? (
            <FieldDescription>{field.description}</FieldDescription>
          ) : null}
        </FieldContent>
        <div className="flex min-w-0 flex-wrap gap-2">
          {field.options.map((option) => (
            <label
              key={option.value}
              className="flex h-8 w-auto min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <Checkbox
                checked={selectedSubjects.has(option.value)}
                onCheckedChange={(checked) => toggleSubject(option.value, checked === true)}
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
      </Field>
    )
  }

  if (field.kind === "switch") {
    const checked = value === "true"

    return (
      <Field className="gap-2.5 py-3 md:grid md:grid-cols-[minmax(220px,1fr)_280px] md:items-center">
        <FieldContent>
          <FieldLabel htmlFor={field.key}>{field.label}</FieldLabel>
          {field.description ? (
            <FieldDescription>{field.description}</FieldDescription>
          ) : null}
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
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
      </FieldContent>
      <div className="w-full min-w-0">
        {field.kind === "select" ? (
          <Select value={value} onValueChange={(nextValue) => onChange(field.key, String(nextValue ?? ""))}>
            <SelectTrigger id={field.key} className="w-full bg-background" size="default">
              <SelectValue placeholder="请选择">
                {field.options.find((option) => option.value === value)?.label ?? "请选择"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <InputGroup>
            <InputGroupInput
              id={field.key}
              min={field.type === "number" ? 0 : undefined}
              type={field.type ?? "text"}
              value={value}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
            {field.suffix ? (
              <InputGroupAddon align="inline-end">
                <InputGroupText>{field.suffix}</InputGroupText>
              </InputGroupAddon>
            ) : null}
            {directoryKey ? (
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
        )}
      </div>
    </Field>
  )
}
