import type { Icon } from "@mynaui/icons-react";
import { FineTune, Terminal } from "@mynaui/icons-react";

export type PlatformId =
  | "wechat-drama"
  | "wechat-miniprogram-drama"
  | "meituan-drama"
  | "kuaishou-drama"
  | "qq-drama"
  | "iqiyi-drama"
  | "baidu-drama"
  | "douyin-drama"
  | "tiktok-drama"
  | "pinduoduo-drama";

export type AppRoute =
  | "app/config"
  | "wechat-drama/publish"
  | "wechat-drama/config"
  | "wechat-drama/accounts"
  | "wechat-drama/service"
  | "wechat-miniprogram-drama/service"
  | "wechat-miniprogram-drama/config"
  | "meituan-drama/service"
  | "meituan-drama/config"
  | "kuaishou-drama/service"
  | "kuaishou-drama/config"
  | "kuaishou-drama/projects"
  | "kuaishou-drama/schedule"
  | "kuaishou-drama/analytics"
  | "kuaishou-drama/settings"
  | "qq-drama/service"
  | "qq-drama/config"
  | "iqiyi-drama/service"
  | "iqiyi-drama/config"
  | "baidu-drama/service"
  | "baidu-drama/config"
  | "douyin-drama/service"
  | "douyin-drama/config"
  | "tiktok-drama/service"
  | "tiktok-drama/config"
  | "pinduoduo-drama/service"
  | "pinduoduo-drama/config";

const appRoutes = [
  "app/config",
  "wechat-drama/publish",
  "wechat-drama/config",
  "wechat-drama/accounts",
  "wechat-drama/service",
  "wechat-miniprogram-drama/service",
  "wechat-miniprogram-drama/config",
  "meituan-drama/service",
  "meituan-drama/config",
  "kuaishou-drama/service",
  "kuaishou-drama/config",
  "kuaishou-drama/projects",
  "kuaishou-drama/schedule",
  "kuaishou-drama/analytics",
  "kuaishou-drama/settings",
  "qq-drama/service",
  "qq-drama/config",
  "iqiyi-drama/service",
  "iqiyi-drama/config",
  "baidu-drama/service",
  "baidu-drama/config",
  "douyin-drama/service",
  "douyin-drama/config",
  "tiktok-drama/service",
  "tiktok-drama/config",
  "pinduoduo-drama/service",
  "pinduoduo-drama/config",
] as const satisfies readonly AppRoute[];

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

export const defaultRoute: AppRoute = "wechat-drama/service";
export const globalConfigRoute: AppRoute = "app/config";

export function routePath(route: AppRoute) {
  return `/${route}`;
}

export function returnRouteFromLocationState(state: unknown): AppRoute {
  if (!state || typeof state !== "object" || !("returnRoute" in state)) {
    return defaultRoute;
  }

  const returnRoute = (state as { returnRoute?: unknown }).returnRoute;
  return typeof returnRoute === "string" &&
    returnRoute !== globalConfigRoute &&
    isAppRoute(returnRoute)
    ? returnRoute
    : defaultRoute;
}

export function platformContextRoute(route: AppRoute, state: unknown): AppRoute {
  return route === globalConfigRoute ? returnRouteFromLocationState(state) : route;
}

export const platformNavigation: PlatformNavigationItem[] = [
  {
    id: "wechat-drama",
    title: "微信视频号",
    routePrefix: "wechat-drama",
    serviceRoute: "wechat-drama/service",
    configRoute: "wechat-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}wx.svg`,
  },
  {
    id: "wechat-miniprogram-drama",
    title: "微信小程序",
    routePrefix: "wechat-miniprogram-drama",
    serviceRoute: "wechat-miniprogram-drama/service",
    configRoute: "wechat-miniprogram-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}wx.svg`,
  },
  {
    id: "meituan-drama",
    title: "美团创作平台",
    routePrefix: "meituan-drama",
    serviceRoute: "meituan-drama/service",
    configRoute: "meituan-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}meituan.svg`,
  },
  {
    id: "kuaishou-drama",
    title: "快手短剧",
    routePrefix: "kuaishou-drama",
    serviceRoute: "kuaishou-drama/service",
    configRoute: "kuaishou-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}kuaishou.svg`,
  },
  {
    id: "qq-drama",
    title: "QQ 短剧",
    routePrefix: "qq-drama",
    serviceRoute: "qq-drama/service",
    configRoute: "qq-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}QQ.svg`,
  },
  {
    id: "iqiyi-drama",
    title: "爱奇艺",
    routePrefix: "iqiyi-drama",
    serviceRoute: "iqiyi-drama/service",
    configRoute: "iqiyi-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}iqiyi.png`,
  },
  {
    id: "baidu-drama",
    title: "百度短剧",
    routePrefix: "baidu-drama",
    serviceRoute: "baidu-drama/service",
    configRoute: "baidu-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}baijiahao.jpg`,
  },
  {
    id: "douyin-drama",
    title: "抖音短剧",
    routePrefix: "douyin-drama",
    serviceRoute: "douyin-drama/service",
    configRoute: "douyin-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}douyin.png`,
  },
  {
    id: "tiktok-drama",
    title: "TikTok",
    routePrefix: "tiktok-drama",
    serviceRoute: "tiktok-drama/service",
    configRoute: "tiktok-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}tiktok.svg`,
  },
  {
    id: "pinduoduo-drama",
    title: "拼多多短剧",
    routePrefix: "pinduoduo-drama",
    serviceRoute: "pinduoduo-drama/service",
    configRoute: "pinduoduo-drama/config",
    logoSrc: `${import.meta.env.BASE_URL}pdd.svg`,
  },
];

export const navigationGroups: NavigationGroup[] = [
  {
    title: "微信视频号",
    items: [
      {
        title: "服务控制",
        route: "wechat-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "wechat-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "微信小程序",
    items: [
      {
        title: "服务控制",
        route: "wechat-miniprogram-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "wechat-miniprogram-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "美团创作平台",
    items: [
      {
        title: "服务控制",
        route: "meituan-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "meituan-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "快手短剧",
    items: [
      {
        title: "服务控制",
        route: "kuaishou-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "kuaishou-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "QQ 短剧",
    items: [
      {
        title: "服务控制",
        route: "qq-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "qq-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "爱奇艺",
    items: [
      {
        title: "服务控制",
        route: "iqiyi-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "iqiyi-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "百度短剧",
    items: [
      {
        title: "服务控制",
        route: "baidu-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "baidu-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "抖音短剧",
    items: [
      {
        title: "服务控制",
        route: "douyin-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "douyin-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "TikTok",
    items: [
      {
        title: "服务控制",
        route: "tiktok-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "tiktok-drama/config",
        icon: FineTune,
      },
    ],
  },
  {
    title: "拼多多短剧",
    items: [
      {
        title: "服务控制",
        route: "pinduoduo-drama/service",
        icon: Terminal,
      },
      {
        title: "配置管理",
        route: "pinduoduo-drama/config",
        icon: FineTune,
      },
    ],
  },
];

export function isAppRoute(route: string): route is AppRoute {
  return appRoutes.includes(route as AppRoute);
}

export function platformForPath(route: string) {
  return (
    platformNavigation.find((platform) => route.startsWith(`${platform.routePrefix}/`)) ??
    platformNavigation[0]
  );
}
