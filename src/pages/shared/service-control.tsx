import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RuntimeStatus = {
  running: boolean;
};

type RuntimeService<TStatus extends RuntimeStatus> = {
  status: () => Promise<TStatus>;
  start: () => Promise<TStatus>;
  stop: () => Promise<TStatus>;
};

function ShinyButtonText({ children, disabled }: { children: ReactNode; disabled: boolean }) {
  const shouldReduceMotion = useReducedMotion();
  const showShine = !disabled && !shouldReduceMotion;

  return (
    <span className="relative inline-grid overflow-hidden [grid-template-areas:'stack']">
      <span className="[grid-area:stack] opacity-[0.86]">{children}</span>
      {showShine ? (
        <motion.span
          aria-hidden="true"
          className="service-shiny-text pointer-events-none [grid-area:stack] text-white/90"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.span>
      ) : null}
    </span>
  );
}

export function useServiceControl<TStatus extends RuntimeStatus>({
  initialStatus,
  service,
  successMessage,
}: {
  initialStatus: TStatus;
  service: RuntimeService<TStatus>;
  successMessage: (status: TStatus) => string;
}) {
  const [status, setStatus] = useState<TStatus>(initialStatus);
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(null);
  const statusRefreshInFlightRef = useRef(false);

  const applyStatus = (nextStatus: TStatus) => {
    setStatus(nextStatus);
  };

  const refreshStatus = useCallback(
    async (silent = false) => {
      if (statusRefreshInFlightRef.current) return;

      statusRefreshInFlightRef.current = true;

      try {
        applyStatus(await service.status());
      } catch (error) {
        if (!silent) {
          toast.error("状态刷新失败", {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        statusRefreshInFlightRef.current = false;
      }
    },
    [service],
  );

  const toggleService = useCallback(async () => {
    if (pendingAction) return;

    const action = status.running ? "stop" : "start";
    setPendingAction(action);

    try {
      const nextStatus = await (status.running ? service.stop() : service.start());
      applyStatus(nextStatus);
      toast.success(successMessage(nextStatus));
    } catch (error) {
      toast.error("操作失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, service, status.running, successMessage]);

  useEffect(() => {
    void refreshStatus();

    const statusRefreshInterval = window.setInterval(() => {
      void refreshStatus(true);
    }, 3000);

    return () => {
      window.clearInterval(statusRefreshInterval);
    };
  }, [refreshStatus]);

  return {
    loading: pendingAction !== null,
    pendingAction,
    refreshStatus,
    status,
    toggleService,
  };
}

export function ServiceControlButtonPage({
  loading,
  pendingAction,
  running,
  startLabel = "启动服务",
  stopLabel = "关闭服务",
  onToggle,
}: {
  loading: boolean;
  pendingAction: "start" | "stop" | null;
  running: boolean;
  startLabel?: string;
  stopLabel?: string;
  onToggle: () => void;
}) {
  const label =
    pendingAction === "start"
      ? "启动中"
      : pendingAction === "stop"
        ? "关闭中"
        : running
          ? stopLabel
          : startLabel;

  return (
    <main className="relative flex min-h-svh flex-1 items-center justify-center bg-transparent p-6">
      <Button
        aria-busy={loading}
        aria-label={label}
        aria-pressed={running}
        className={cn(
          "h-10 min-w-32 gap-2 rounded-lg px-6",
          running &&
            "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20",
        )}
        disabled={loading}
        size="lg"
        type="button"
        variant={running ? "destructive" : "default"}
        onClick={onToggle}
      >
        <ThinkingOrb
          aria-label={label}
          state={loading ? "working" : running ? "composing" : "solving"}
          size={20}
          style={
            running
              ? {
                  filter:
                    "brightness(0) saturate(100%) invert(34%) sepia(88%) saturate(1800%) hue-rotate(335deg) brightness(92%) contrast(92%)",
                }
              : undefined
          }
        />
        <ShinyButtonText disabled={loading}>{label}</ShinyButtonText>
      </Button>
    </main>
  );
}
