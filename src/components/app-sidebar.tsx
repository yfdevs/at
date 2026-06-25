import { useEffect, useState, type ComponentProps } from "react"
import { NavLink, useLocation } from "react-router-dom"

import { navigationGroups, routePath } from "@/config/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

type AppRuntimeStatus = {
  pid: number | null
  memory: {
    processRssBytes: number
    systemUsedBytes: number
    systemTotalBytes: number
    systemUsedPercent: number
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function memoryBarClass(percent: number) {
  if (percent >= 90) {
    return "bg-rose-500"
  }

  if (percent >= 75) {
    return "bg-amber-500"
  }

  return "bg-emerald-500"
}

async function getAppRuntimeStatus() {
  if (!window.ipcRenderer) {
    throw new Error("应用运行状态仅在 Electron 应用内可用。")
  }

  return window.ipcRenderer.invoke("app:runtime:status") as Promise<AppRuntimeStatus>
}

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const location = useLocation()
  const [runtimeStatus, setRuntimeStatus] = useState<AppRuntimeStatus | null>(null)

  useEffect(() => {
    let disposed = false

    const refreshRuntimeStatus = async () => {
      try {
        const nextStatus = await getAppRuntimeStatus()
        if (!disposed) {
          setRuntimeStatus(nextStatus)
        }
      } catch {
        if (!disposed) {
          setRuntimeStatus(null)
        }
      }
    }

    void refreshRuntimeStatus()
    const interval = window.setInterval(() => {
      void refreshRuntimeStatus()
    }, 5000)

    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [])

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarContent className="gap-0.5">
        {navigationGroups.map((group) => {
          return (
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel>
                {group.title}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          isActive={location.pathname === routePath(item.route)}
                          className="h-8"
                          render={<NavLink to={routePath(item.route)} />}
                          tooltip={item.title}
                        >
                          <ItemIcon className="size-4" />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="rounded-md bg-sidebar-accent/50 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium">应用进程</span>
            <span className="size-2 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-1 space-y-0.5 text-[11px] text-sidebar-foreground/70">
            <div className="flex items-center justify-between gap-2">
              <span>PID</span>
              <span className="font-medium tabular-nums">{runtimeStatus?.pid ?? "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>应用内存</span>
              <span className="font-medium tabular-nums">
                {formatBytes(runtimeStatus?.memory.processRssBytes ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>系统内存</span>
              <span className="font-medium tabular-nums">
                {formatBytes(runtimeStatus?.memory.systemUsedBytes ?? 0)} /{" "}
                {formatBytes(runtimeStatus?.memory.systemTotalBytes ?? 0)}
              </span>
            </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sidebar-border">
            <div
                className={`h-full rounded-full transition-all ${memoryBarClass(runtimeStatus?.memory.systemUsedPercent ?? 0)}`}
                style={{
                  width: `${Math.min(Math.max(runtimeStatus?.memory.systemUsedPercent ?? 0, 0), 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
