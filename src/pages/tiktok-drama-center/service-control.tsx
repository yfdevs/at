import {
  ServiceControlToolbar,
  ServiceDetailCard,
  useServiceControl,
} from "@/pages/shared/service-control"
import {
  tiktokDramaCenterService,
  type TiktokDramaCenterLoginState,
  type TiktokDramaCenterServiceStatus,
} from "@/platforms/tiktok-drama-center/service"

const initialStatus: TiktokDramaCenterServiceStatus = {
  platform: "tiktok-drama-center",
  running: false,
  loginState: "unknown",
  userDataDir: "",
  pid: null,
}

const accentClassName =
  "bg-[linear-gradient(135deg,color-mix(in_oklch,var(--color-sky-500)_8%,var(--card))_0%,var(--card)_58%,color-mix(in_oklch,var(--primary)_5%,var(--card))_100%)]"

function loginStateLabel(loginState: TiktokDramaCenterLoginState) {
  if (loginState === "logged-in") return "已登录"
  if (loginState === "login-required") return "等待登录"
  return "检测中"
}

function successMessage(status: TiktokDramaCenterServiceStatus) {
  return status.running ? "TikTok Drama Center 已启动" : "TikTok Drama Center 已停止"
}

export function TiktokDramaCenterServiceControlPage() {
  const {
    lastRefreshedAt,
    loading,
    refreshStatus,
    status,
    toggleService,
  } = useServiceControl({
    initialStatus,
    service: tiktokDramaCenterService,
    successMessage,
  })
  const activeUrl = status.activeUrl && status.activeUrl !== "about:blank" ? status.activeUrl : "-"

  return (
    <main className="flex min-h-svh flex-1 flex-col gap-6 bg-background p-6">
      <ServiceControlToolbar
        accentClassName={accentClassName}
        activeText={activeUrl}
        activeTitle={activeUrl}
        lastRefreshedAt={lastRefreshedAt}
        loading={loading}
        loginText={loginStateLabel(status.loginState)}
        running={status.running}
        toggleTooltip={status.running ? "停止 TikTok 浏览器" : "启动 TikTok 浏览器"}
        onRefresh={() => void refreshStatus()}
        onToggle={() => void toggleService()}
      />

      <ServiceDetailCard
        rows={[
          { label: "当前页面", value: activeUrl },
          { label: "账号目录", value: status.userDataDir || "-" },
          { label: "业务流程", value: "读取运行目录中的 scheme.local.json 与 videos" },
        ]}
      />
    </main>
  )
}
