# Drama Post Auto

Multi-platform desktop automation app built with Electron, React, TypeScript, and Vite+.

## Scripts

- `pnpm dev` starts the WeChat Video automation package build and Vite+ dev server.
- `pnpm build` builds the automation package, installs shared Playwright browsers, builds the renderer with Vite+, and packages Electron.
- `pnpm lint` runs Vite+ linting through Oxlint.
- `vp check --no-fmt` runs Vite+ linting and type checks without rewriting existing formatting.

## GitHub 发版与自动更新

Windows 安装包通过 GitHub Releases 分发，发布目标为 `yfdevs/at`。发版前先修改
`package.json` 的版本号并提交全部改动，然后运行：

```bash
pnpm release
```

脚本会拒绝在工作区存在未提交改动时运行，然后创建并推送 `v<版本号>` 标签。
GitHub Actions 会在 Windows 环境构建安装包，并把安装程序、blockmap 和
`latest.yml` 上传到对应 Release；现有自动更新功能依赖这些文件，请勿单独删除。

Electron Builder 在普通构建和 Actions 构建中默认使用 `--publish never`，只负责生成
发布文件；Release 统一由工作流使用仓库自带的 `GITHUB_TOKEN` 创建，不需要配置个人
访问令牌。需要从本机直接发布时，仍可使用已有的 `pnpm release:win`。
