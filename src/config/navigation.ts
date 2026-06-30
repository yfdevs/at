import type { Icon } from "@mynaui/icons-react";
import { FineTune, Terminal } from "@mynaui/icons-react";

export type AppRoute =
  | "wechat/publish"
  | "wechat/config"
  | "wechat/accounts"
  | "wechat/service"
  | "meituan/service"
  | "meituan/config"
  | "kuaishou/service"
  | "kuaishou/config"
  | "kuaishou/projects"
  | "kuaishou/schedule"
  | "kuaishou/analytics"
  | "kuaishou/settings"
  | "tiktok-drama-center/service"
  | "tiktok-drama-center/config";

export type NavigationItem = {
  title: string;
  route: AppRoute;
  icon: Icon;
};

export type NavigationGroup = {
  title: string;
  items: NavigationItem[];
};

export const defaultRoute: AppRoute = "wechat/service";

export function routePath(route: AppRoute) {
  return `/${route}`;
}

export const navigationGroups: NavigationGroup[] = [
  {
    title: "微信视频号",
    items: [
      {
        title: "服务控制",
        route: "wechat/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "wechat/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "美团创作平台",
    items: [
      {
        title: "服务控制",
        route: "meituan/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "meituan/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "快手短剧",
    items: [
      {
        title: "服务控制",
        route: "kuaishou/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "kuaishou/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "TikTok Drama Center",
    items: [
      {
        title: "服务控制",
        route: "tiktok-drama-center/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "tiktok-drama-center/config",
        icon: FineTune,
      },
    ],
  },
];

export function isAppRoute(route: string): route is AppRoute {
  return navigationGroups.some((group) => group.items.some((item) => item.route === route));
}
