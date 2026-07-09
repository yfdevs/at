import { useEffect, useState, type ComponentType } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"

import { defaultRoute, isAppRoute, routePath, type AppRoute } from "@/config/navigation"
import { BaiduNetdiskWindowPage } from "@/pages/baidu-netdisk/window"
import { KuaishouAnalyticsPage } from "@/pages/kuaishou-drama/analytics"
import { KuaishouDramaConfigurationPage } from "@/pages/kuaishou-drama/configuration"
import { KuaishouDramaServiceControlPage } from "@/pages/kuaishou-drama/service-control"
import { KuaishouProjectsPage } from "@/pages/kuaishou-drama/projects"
import { KuaishouSchedulePage } from "@/pages/kuaishou-drama/schedule"
import { KuaishouSettingsPage } from "@/pages/kuaishou-drama/settings"
import { WechatAccountsPage } from "@/pages/wechat-drama/accounts"
import { WechatConfigurationPage } from "@/pages/wechat-drama/configuration"
import { WechatPublishTasksPage } from "@/pages/wechat-drama/publish-tasks"
import { WechatServiceControlPage } from "@/pages/wechat-drama/service-control"
import { MeituanCreationConfigurationPage } from "@/pages/meituan-drama/configuration"
import { MeituanCreationServiceControlPage } from "@/pages/meituan-drama/service-control"
import { TiktokDramaCenterConfigurationPage } from "@/pages/tiktok-drama/configuration"
import { TiktokDramaCenterServiceControlPage } from "@/pages/tiktok-drama/service-control"

const appRouteComponents: Record<AppRoute, ComponentType> = {
  "baidu-netdisk/window": BaiduNetdiskWindowPage,
  "wechat-drama/publish": WechatPublishTasksPage,
  "wechat-drama/config": WechatConfigurationPage,
  "wechat-drama/accounts": WechatAccountsPage,
  "wechat-drama/service": WechatServiceControlPage,
  "meituan-drama/service": MeituanCreationServiceControlPage,
  "meituan-drama/config": MeituanCreationConfigurationPage,
  "kuaishou-drama/service": KuaishouDramaServiceControlPage,
  "kuaishou-drama/config": KuaishouDramaConfigurationPage,
  "kuaishou-drama/projects": KuaishouProjectsPage,
  "kuaishou-drama/schedule": KuaishouSchedulePage,
  "kuaishou-drama/analytics": KuaishouAnalyticsPage,
  "kuaishou-drama/settings": KuaishouSettingsPage,
  "tiktok-drama/service": TiktokDramaCenterServiceControlPage,
  "tiktok-drama/config": TiktokDramaCenterConfigurationPage,
}

export function AppRoutes() {
  const location = useLocation()
  const currentPath = location.pathname.replace(/^\/+/, "")
  const activeRoute = isAppRoute(currentPath) ? currentPath : defaultRoute
  const [cachedRoutes, setCachedRoutes] = useState<Set<AppRoute>>(() => new Set([activeRoute]))

  useEffect(() => {
    setCachedRoutes((current) => {
      if (current.has(activeRoute)) return current
      return new Set(current).add(activeRoute)
    })
  }, [activeRoute])

  return (
    <>
      <Routes>
        <Route index element={<Navigate to={routePath(defaultRoute)} replace />} />
        <Route
          path="*"
          element={
            currentPath && !isAppRoute(currentPath)
              ? <Navigate to={routePath(defaultRoute)} replace />
              : null
          }
        />
      </Routes>
      {Object.entries(appRouteComponents).map(([route, Page]) => {
        const typedRoute = route as AppRoute
        if (!cachedRoutes.has(typedRoute)) return null

        const active = activeRoute === typedRoute

        return (
          <div key={route} className={active ? "contents" : "hidden"}>
            <Page />
          </div>
        )
      })}
    </>
  )
}
