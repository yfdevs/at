import type { Icon } from "@mynaui/icons-react";
import { FineTune, Terminal } from "@mynaui/icons-react";

export type PlatformId = "wechat" | "meituan" | "kuaishou" | "tiktok-drama-center";

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

export type PlatformNavigationItem = {
  id: PlatformId;
  title: string;
  routePrefix: string;
  serviceRoute: AppRoute;
  configRoute: AppRoute;
  logoSrc: string;
};

export const defaultRoute: AppRoute = "wechat/service";

export function routePath(route: AppRoute) {
  return `/${route}`;
}

export const platformNavigation: PlatformNavigationItem[] = [
  {
    id: "wechat",
    title: "微信视频号",
    routePrefix: "wechat",
    serviceRoute: "wechat/service",
    configRoute: "wechat/config",
    logoSrc: `${import.meta.env.BASE_URL}wx.svg`,
  },
  {
    id: "meituan",
    title: "美团创作平台",
    routePrefix: "meituan",
    serviceRoute: "meituan/service",
    configRoute: "meituan/config",
    logoSrc: `${import.meta.env.BASE_URL}meituan.svg`,
  },
  {
    id: "kuaishou",
    title: "快手短剧",
    routePrefix: "kuaishou",
    serviceRoute: "kuaishou/service",
    configRoute: "kuaishou/config",
    logoSrc: `${import.meta.env.BASE_URL}kuaishou.svg`,
  },
  {
    id: "tiktok-drama-center",
    title: "TikTok Drama Center",
    routePrefix: "tiktok-drama-center",
    serviceRoute: "tiktok-drama-center/service",
    configRoute: "tiktok-drama-center/config",
    logoSrc: `${import.meta.env.BASE_URL}tiktok.svg`,
  },
];

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

export function platformForPath(route: string) {
  return (
    platformNavigation.find((platform) => route.startsWith(`${platform.routePrefix}/`)) ??
    platformNavigation[0]
  );
}
