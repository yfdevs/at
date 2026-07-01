# Baidu Netdisk Automation

Windows Baidu Netdisk CDP automation package.

The copied CLI flow lives in `src/download-baidu-folder.ts`. The package entry
exports CDP status and launch helpers used by the Electron main process.

```powershell
pnpm --filter @drama/baidu-netdisk-automation check
pnpm --filter @drama/baidu-netdisk-automation build
pnpm --filter @drama/baidu-netdisk-automation download:share -- --share-file=D:\path\share.txt
```
