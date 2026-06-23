import { useEffect, useState, type ComponentType } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"

import { defaultRoute, isAppRoute, routePath, type AppRoute } from "@/config/navigation"
import { KuaishouAnalyticsPage } from "@/pages/kuaishou-drama/analytics"
import { KuaishouProjectsPage } from "@/pages/kuaishou-drama/projects"
import { KuaishouSchedulePage } from "@/pages/kuaishou-drama/schedule"
import { KuaishouSettingsPage } from "@/pages/kuaishou-drama/settings"
import { WechatAccountsPage } from "@/pages/wechat-video/accounts"
import { WechatConfigurationPage } from "@/pages/wechat-video/configuration"
import { WechatPublishTasksPage } from "@/pages/wechat-video/publish-tasks"
import { WechatServiceControlPage } from "@/pages/wechat-video/service-control"

const appRouteComponents: Record<AppRoute, ComponentType> = {
  "wechat/publish": WechatPublishTasksPage,
  "wechat/config": WechatConfigurationPage,
  "wechat/accounts": WechatAccountsPage,
  "wechat/service": WechatServiceControlPage,
  "kuaishou/projects": KuaishouProjectsPage,
  "kuaishou/schedule": KuaishouSchedulePage,
  "kuaishou/analytics": KuaishouAnalyticsPage,
  "kuaishou/settings": KuaishouSettingsPage,
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
