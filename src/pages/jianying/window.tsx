import { useEffect, useState } from "react";
import { Folder } from "@mynaui/icons-react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  controlJianying,
  getJianyingConfig,
  getJianyingStatus,
  prepareJianyingDramaCollection,
  selectJianyingExecutable,
  selectJianyingDramaDirectory,
  type JianyingStatus,
} from "@/platforms/jianying/service";

type JianyingAction = "start" | "restart" | "collection";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function statusLabel(status: JianyingStatus | null, error: string | null) {
  if (error) return "状态异常";
  if (!status) return "正在检查";
  if (!status.pathValid || !status.installed) return "未找到剪映";
  if (status.appRunning && status.accessibilityPrepared) return "自动化可用";
  if (status.appRunning) return "不可操作，请重新启动";
  return "剪映未运行";
}

export function JianyingPanel() {
  const [status, setStatus] = useState<JianyingStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [actionPending, setActionPending] = useState<JianyingAction | null>(null);
  const [executablePath, setExecutablePath] = useState("");
  const [pathSelecting, setPathSelecting] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [restartConfirmationOpen, setRestartConfirmationOpen] = useState(false);
  const [collectionConfirmationOpen, setCollectionConfirmationOpen] = useState(false);
  const [dramaDirectory, setDramaDirectory] = useState("");
  const [collectionResult, setCollectionResult] = useState<string | null>(null);

  const summary = statusLabel(status, statusError);
  const statusIsHealthy = Boolean(status?.appRunning && status.accessibilityPrepared);

  const refreshStatus = async () => {
    setStatusRefreshing(true);
    try {
      const nextStatus = await getJianyingStatus();
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
        const result = await getJianyingConfig();
        const nextPath = result.config.executablePath.trim();
        if (!disposed) {
          setExecutablePath(nextPath);
        }
      } catch (error) {
        if (!disposed) setPathError(errorMessage(error));
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const handleSelectPath = () => {
    void (async () => {
      setPathSelecting(true);
      setPathError(null);
      try {
        const result = await selectJianyingExecutable();
        if (!result) return;
        const nextPath = result.config.executablePath.trim();
        setExecutablePath(nextPath);
        await refreshStatus();
      } catch (error) {
        setPathError(errorMessage(error));
      } finally {
        setPathSelecting(false);
      }
    })();
  };

  const handleControl = (restart: boolean) => {
    void (async () => {
      setActionPending(restart ? "restart" : "start");
      setStatusError(null);
      try {
        setStatus(await controlJianying(restart));
      } catch (error) {
        setStatusError(errorMessage(error));
      } finally {
        setActionPending(null);
      }
    })();
  };

  const handleSelectDramaDirectory = () => {
    void (async () => {
      setPathSelecting(true);
      setPathError(null);
      try {
        const selectedDirectory = await selectJianyingDramaDirectory();
        if (selectedDirectory) setDramaDirectory(selectedDirectory);
      } catch (error) {
        setPathError(errorMessage(error));
      } finally {
        setPathSelecting(false);
      }
    })();
  };

  const handlePrepareCollection = () => {
    void (async () => {
      setActionPending("collection");
      setStatusError(null);
      setCollectionResult(null);
      try {
        const result = await prepareJianyingDramaCollection(dramaDirectory);
        setStatus(result.status);
        setCollectionResult(`完成 ${result.prepared.length} 集，截图已保存到权属文件`);
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
                statusIsHealthy
                  ? "bg-emerald-500 ring-emerald-500/10"
                  : "bg-rose-500 ring-rose-500/10"
              }`}
              aria-hidden="true"
            />
            <div className="grid min-w-0 gap-0.5">
              <span className="text-xs text-muted-foreground">剪映状态</span>
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
            <Button
              type="button"
              size="xs"
              disabled={actionPending !== null || status?.isWindows === false}
              onClick={() => {
                if (status?.appRunning) setRestartConfirmationOpen(true);
                else handleControl(false);
              }}
            >
              {actionPending
                ? actionPending === "restart" ? "重启中…" : actionPending === "start" ? "启动中…" : "处理中…"
                : status?.appRunning ? "重新启动" : "启动剪映"}
            </Button>
          </div>
        </div>

        {statusError || pathError ? (
          <p className="px-1 text-xs text-destructive">{pathError ?? statusError}</p>
        ) : null}

        <div className="grid gap-1.5">
          <label htmlFor="jianying-executable-path" className="text-xs font-medium">
              剪映路径
          </label>
          <InputGroup>
            <InputGroupInput
              id="jianying-executable-path"
              value={executablePath || status?.executablePath || ""}
              readOnly
              title={executablePath || status?.executablePath}
              placeholder="未找到剪映"
              className="text-xs"
              aria-invalid={Boolean(status && !status.pathValid) || Boolean(pathError)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label="选择剪映应用"
                disabled={pathSelecting || actionPending !== null}
                onClick={handleSelectPath}
              >
                <Folder aria-hidden="true" />
                {pathSelecting ? "选择中" : "选择"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="grid gap-2 border-t pt-3">
          <div className="grid gap-0.5">
            <label htmlFor="jianying-drama-directory" className="text-xs font-medium">
              剧目目录
            </label>
            <span className="text-xs text-muted-foreground">按全局配置生成草稿与窗口截图</span>
          </div>
          <InputGroup>
            <InputGroupInput
              id="jianying-drama-directory"
              value={dramaDirectory}
              readOnly
              title={dramaDirectory}
              placeholder="选择包含剧集视频的目录"
              className="text-xs"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label="选择剧目目录"
                disabled={pathSelecting || actionPending !== null}
                onClick={handleSelectDramaDirectory}
              >
                <Folder aria-hidden="true" />
                {pathSelecting ? "选择中" : "选择目录"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Button
            type="button"
            size="sm"
            disabled={!dramaDirectory || actionPending !== null || !status?.installed}
            onClick={() => setCollectionConfirmationOpen(true)}
          >
            {actionPending === "collection" ? "自动处理中…" : "开始自动处理"}
          </Button>
          {collectionResult ? (
            <p className="break-all text-xs text-emerald-600 dark:text-emerald-400">{collectionResult}</p>
          ) : null}
        </div>
      </div>
      <AlertDialog open={restartConfirmationOpen} onOpenChange={setRestartConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新启动剪映？</AlertDialogTitle>
            <AlertDialogDescription>
              请先保存当前草稿，剪映将被关闭并重新打开。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRestartConfirmationOpen(false);
                handleControl(true);
              }}
            >
              重新启动
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={collectionConfirmationOpen} onOpenChange={setCollectionConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>开始自动处理？</AlertDialogTitle>
            <AlertDialogDescription>
              请先保存当前草稿。将按全局配置生成草稿并依次保存剪映窗口截图，完成后自动清理草稿。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCollectionConfirmationOpen(false);
                handlePrepareCollection();
              }}
            >
              开始处理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
