# Automation Architecture

## Workspace Layout

- `src/`: Electron renderer UI.
- `src/pages/<platform>/`: platform-specific pages.
- `src/platforms/<platform>/`: renderer-side platform API clients and types.
- `electron/main.ts`: Electron shell only.
- `electron/platforms/<platform>.ts`: platform-specific IPC, service lifecycle, local configuration, and runtime startup.
- `packages/<platform>-automation/`: platform-specific Playwright/runtime implementation.

The currently implemented automation platform is WeChat Video Channel:

- Renderer pages: `src/pages/wechat-drama/`
- Renderer service: `src/platforms/wechat-drama/service.ts`
- Main-process platform module: `electron/platforms/wechat-drama.ts`
- Runtime package: `packages/wechat-drama-automation/`
- Package name: `@drama/wechat-drama-automation`

## IPC Boundary

IPC channels are platform-prefixed:

- `wechat-drama:service:start`
- `wechat-drama:service:stop`
- `wechat-drama:service:status`
- `wechat-drama:config:get`
- `wechat-drama:config:save`

Do not add generic `automation:*` IPC channels for platform-specific behavior. Future platforms should add their own channel namespace, for example `kuaishou-drama:*`.

## Main Process

`electron/main.ts` should remain small. It is responsible for:

- creating the main window
- setting app-level menu/lifecycle behavior
- registering platform modules
- stopping platform runtimes during app quit

Platform modules under `electron/platforms/` own:

- Electron IPC handlers
- `electron-store` configuration persistence
- runtime start/stop/status
- runtime environment preparation
- platform-specific Playwright browser resource paths

## Renderer

Renderer pages must call platform services from `src/platforms/<platform>/`. They should not invoke raw IPC channels directly.

For WeChat Video Channel:

```ts
import { wechatVideoService } from "@/platforms/wechat-drama/service"
```

## Configuration

App configuration persistence uses `electron-store`. Do not add hand-rolled JSON cache files for desktop settings.

The WeChat Video Channel config is stored in `wechat-drama-config` through `electron-store`. The UI exposes all duration values in seconds. The Electron platform module reads the store and injects a camelCase settings object into the automation runtime.

Business configuration must not be read from environment files or `process.env`. Environment variables are reserved for infrastructure concerns at the boot boundary, such as `PLAYWRIGHT_BROWSERS_PATH`.

## Developer Scripts

Root scripts are platform-prefixed:

```bash
pnpm wechat-drama:check
pnpm wechat-drama:install-browsers
```

Service start/stop is controlled by Electron IPC and the renderer UI, not by package CLI scripts. No app runtime path shells out to `pnpm`, `npm`, or a user-installed Node binary.

## Playwright Browser Distribution

End users must not run `pnpm exec playwright install`.

Release builds install Chromium on the build machine into:

```text
.cache/playwright-browsers
```

The directory is copied by `electron-builder` to:

```text
resources/playwright-browsers
```

At runtime, the WeChat platform module sets:

```text
PLAYWRIGHT_BROWSERS_PATH=<resources>/playwright-browsers
```

The root `pnpm build` script runs browser installation before `electron-builder`.
