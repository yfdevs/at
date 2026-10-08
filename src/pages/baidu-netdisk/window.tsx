import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  controlBaiduNetdiskCdp,
  getBaiduNetdiskConfig,
  getBaiduNetdiskStatus,
  saveBaiduNetdiskConfig,
  type BaiduNetdiskCdpStatus,
} from "@/platforms/baidu-netdisk/service";

type BaiduAction = "start" | "restart";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function baiduNetdiskSummary(status: BaiduNetdiskCdpStatus | null, error: string | null) {
  if (error) return "连接失败";
  if (!status) return "正在检查";
  if (status.ready) return "已连接";
  if (!status.appRunning) return "客户端未启动";
  if (!status.cdpRunning) return "需要重新连接";
  return "暂时无法连接";
}

export function BaiduNetdiskPanel() {
  const [status, setStatus] = useState<BaiduNetdiskCdpStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [actionPending, setActionPending] = useState<BaiduAction | null>(null);
  const [installPath, setInstallPath] = useState("");
  const [savedInstallPath, setSavedInstallPath] = useState("");
  const [installPathSaving, setInstallPathSaving] = useState(false);
  const [installPathMessage, setInstallPathMessage] = useState<string | null>(null);
  const [installPathError, setInstallPathError] = useState<string | null>(null);

  const summary = baiduNetdiskSummary(status, statusError);
  const shouldRestart = Boolean(status?.appRunning);
  const normalizedInstallPath = installPath.trim();
  const installPathDirty = normalizedInstallPath !== savedInstallPath;
  const showClientSetup = Boolean(statusError || (status && !status.ready));

  const refreshStatus = async () => {
    setStatusRefreshing(true);

    try {
      const nextStatus = await getBaiduNetdiskStatus();
      setStatus(nextStatus);
      setStatusError(null);
    } catch (error) {
      setStatusError(errorMessage(error));
    } finally {
      setStatusRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const result = await getBaiduNetdiskConfig();
        const nextInstallPath = result.config.executablePath.trim();

        if (!disposed) {
          setInstallPath(nextInstallPath);
          setSavedInstallPath(nextInstallPath);
          setInstallPathError(null);
        }
      } catch (error) {
        if (!disposed) setInstallPathError(errorMessage(error));
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const handleSaveInstallPath = () => {
    void (async () => {
      setInstallPathSaving(true);
      setInstallPathMessage(null);
      setInstallPathError(null);

      try {
        const result = await saveBaiduNetdiskConfig({
          executablePath: normalizedInstallPath,
        });
        const nextInstallPath = result.config.executablePath.trim();

        setInstallPath(nextInstallPath);
        setSavedInstallPath(nextInstallPath);
        setInstallPathMessage(nextInstallPath ? "安装目录已保存。" : "已恢复默认自动查找。");
        void refreshStatus();
      } catch (error) {
        setInstallPathError(errorMessage(error));
      } finally {
        setInstallPathSaving(false);
      }
    })();
  };

  const handleStart = (restart: boolean) => {
    void (async () => {
      setActionPending(restart ? "restart" : "start");
      setStatusError(null);

      try {
        const result = await controlBaiduNetdiskCdp(restart);
        setStatus(result.status);
      } catch (error) {
        setStatusError(errorMessage(error));
      } finally {
        setActionPending(null);
      }
    })();
  };

  return (
    <div className="bg-background">
      <div className="grid gap-3 p-4">
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className={`size-2.5 shrink-0 rounded-full ring-4 ${
                status?.ready
                  ? "bg-emerald-500 ring-emerald-500/10"
                  : statusError || status
                    ? "bg-rose-500 ring-rose-500/10"
                    : "bg-muted-foreground/40 ring-muted-foreground/10"
              }`}
              aria-hidden="true"
            />
            <div className="grid min-w-0 gap-0.5">
              <span className="text-xs text-muted-foreground">CDP 状态</span>
              <span className="truncate text-sm font-medium">{summary}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={statusRefreshing || actionPending !== null}
              onClick={() => void refreshStatus()}
            >
              {statusRefreshing ? "检查中" : "检查"}
            </Button>
            {status ? (
              <Button
                type="button"
                size="xs"
                disabled={actionPending !== null || status.isWindows === false}
                onClick={() => handleStart(shouldRestart)}
              >
                {actionPending ? "连接中…" : shouldRestart ? "重启连接" : "启动并连接"}
              </Button>
            ) : null}
          </div>
        </div>

        {statusError ? (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {statusError}
          </div>
        ) : null}

        {showClientSetup ? (
          <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2 rounded-lg border border-dashed p-2.5">
            <Input
              id="baidu-netdisk-install-path"
              value={installPath}
              onChange={(event) => {
                setInstallPath(event.target.value);
                setInstallPathMessage(null);
                setInstallPathError(null);
              }}
              placeholder="找不到客户端时，填写百度网盘安装目录"
              className="text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={installPathSaving || !installPathDirty}
              onClick={handleSaveInstallPath}
            >
              {installPathSaving ? "保存中" : "保存目录"}
            </Button>
            {installPathError || installPathMessage ? (
              <p
                className={`col-span-2 px-1 text-xs ${installPathError ? "text-destructive" : "text-muted-foreground"}`}
              >
                {installPathError || installPathMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
