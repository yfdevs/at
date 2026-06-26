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
  tiktokDramaCenterService,
  type TiktokDramaCenterConfig,
  type TiktokDramaCenterConfigResult,
} from "@/platforms/tiktok-drama-center/service"

const emptyConfig: TiktokDramaCenterConfig = {
  headless: "false",
  operationDelaySeconds: "0.02",
  runDataDir: ".drama-runs/tiktok-drama-center",
}

export function TiktokDramaCenterConfigurationPage() {
  const [config, setConfig] = useState<TiktokDramaCenterConfig>(emptyConfig)
  const [savedConfig, setSavedConfig] = useState<TiktokDramaCenterConfig>(emptyConfig)
  const [restartRequired, setRestartRequired] = useState(false)
  const [loading, setLoading] = useState(false)

  const hasChanges = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig]
  )

  const applyResult = (result: TiktokDramaCenterConfigResult) => {
    setConfig(result.config)
    setSavedConfig(result.config)
    setRestartRequired(result.restartRequired)
  }

  useEffect(() => {
    setLoading(true)
    tiktokDramaCenterService
      .getConfig()
      .then(applyResult)
      .catch((error) => {
        toast.error("配置读取失败", {
          description: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const updateConfig = (key: keyof TiktokDramaCenterConfig, value: string) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const saveConfig = async () => {
    setLoading(true)
    try {
      const result = await tiktokDramaCenterService.saveConfig(config)
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

  const selectRunDataDir = async () => {
    try {
      const selectedPath = await tiktokDramaCenterService.selectRunDataDir(config.runDataDir)
      if (selectedPath) updateConfig("runDataDir", selectedPath)
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
            <h1 className="mr-1 text-lg font-semibold tracking-normal">TikTok Drama Center 配置</h1>
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
              <Button className="w-fit" disabled={loading} onClick={() => setConfig(savedConfig)} variant="outline">
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
        <section className="scroll-mt-28 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">浏览器与运行数据</h2>
            <p className="text-xs text-muted-foreground sm:text-sm">登录态和临时文件由 TikTok Drama Center 独立管理。</p>
          </div>
          <Card className="rounded-lg bg-background py-0">
            <CardContent className="py-0">
              <FieldGroup className="gap-0">
                <Field className="gap-2.5 py-3 md:grid md:grid-cols-[minmax(220px,1fr)_280px] md:items-start">
                  <FieldContent>
                    <FieldLabel htmlFor="tiktok-run-data-dir">运行数据目录</FieldLabel>
                    <FieldDescription>浏览器登录态位于该目录的 auth 子目录。</FieldDescription>
                  </FieldContent>
                  <InputGroup>
                    <InputGroupInput
                      id="tiktok-run-data-dir"
                      value={config.runDataDir}
                      onChange={(event) => updateConfig("runDataDir", event.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton aria-label="选择运行数据目录" onClick={selectRunDataDir}>
                        <FolderOpen />
                        选择
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <Separator />
                <Field className="gap-2.5 py-3 md:grid md:grid-cols-[minmax(220px,1fr)_280px] md:items-start">
                  <FieldContent>
                    <FieldLabel htmlFor="tiktok-operation-delay">操作延迟</FieldLabel>
                    <FieldDescription>每一步 Playwright 操作之间的延迟。</FieldDescription>
                  </FieldContent>
                  <InputGroup>
                    <InputGroupInput
                      id="tiktok-operation-delay"
                      min={0}
                      step="0.01"
                      type="number"
                      value={config.operationDelaySeconds}
                      onChange={(event) => updateConfig("operationDelaySeconds", event.target.value)}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>秒</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                <Separator />
                <Field className="gap-2.5 py-3 md:grid md:grid-cols-[minmax(220px,1fr)_280px] md:items-center">
                  <FieldContent>
                    <FieldLabel htmlFor="tiktok-headless">浏览器窗口</FieldLabel>
                    <FieldDescription>登录和排查问题时建议显示浏览器。</FieldDescription>
                  </FieldContent>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                      {config.headless === "true" ? "无头运行" : "显示浏览器"}
                    </span>
                    <Switch
                      id="tiktok-headless"
                      checked={config.headless === "true"}
                      onCheckedChange={(checked) => updateConfig("headless", checked ? "true" : "false")}
                    />
                  </div>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}
