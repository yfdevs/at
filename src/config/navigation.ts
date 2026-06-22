import type { LucideIcon } from "lucide-react"
import {
  ChartSplineIcon,
  ClipboardListIcon,
  Clock3Icon,
  FilmIcon,
  ListVideoIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
  UserCogIcon,
} from "lucide-react"

export type AppRoute =
  | "wechat/publish"
  | "wechat/config"
  | "wechat/materials"
  | "wechat/accounts"
  | "wechat/service"
  | "kuaishou/projects"
  | "kuaishou/schedule"
  | "kuaishou/analytics"
  | "kuaishou/settings"

export type NavigationItem = {
  title: string
  route: AppRoute
  icon: LucideIcon
}

export type NavigationGroup = {
  title: string
  items: NavigationItem[]
}

export const defaultRoute: AppRoute = "wechat/service"

export function routePath(route: AppRoute) {
  return `/${route}`
}

export const navigationGroups: NavigationGroup[] = [
  {
    title: "微信视频号",
    items: [
      {
        title: "服务控制",
        route: "wechat/service",
        icon: TerminalIcon,
      },
      {
        title: "配置管理",
        route: "wechat/config",
        icon: SlidersHorizontalIcon,
      },
      {
        title: "发布任务",
        route: "wechat/publish",
        icon: ClipboardListIcon,
      },
      {
        title: "素材管理",
        route: "wechat/materials",
        icon: ListVideoIcon,
      },
      {
        title: "账号管理",
        route: "wechat/accounts",
        icon: UserCogIcon,
      },
    ],
  },
  {
    title: "快手短剧",
    items: [
      {
        title: "短剧项目",
        route: "kuaishou/projects",
        icon: FilmIcon,
      },
      {
        title: "发布排期",
        route: "kuaishou/schedule",
        icon: Clock3Icon,
      },
      {
        title: "数据看板",
        route: "kuaishou/analytics",
        icon: ChartSplineIcon,
      },
      {
        title: "平台设置",
        route: "kuaishou/settings",
        icon: SlidersHorizontalIcon,
      },
    ],
  },
]

export function isAppRoute(route: string): route is AppRoute {
  return navigationGroups.some((group) =>
    group.items.some((item) => item.route === route)
  )
}
