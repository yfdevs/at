import { useEffect, useState, type ReactNode } from "react";
import { Scissors } from "@mynaui/icons-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JianyingPanel } from "@/pages/jianying/window";
import { JIANYING_DIALOG_OPEN_EVENT } from "@/platforms/jianying/dialog-controller";

export function JianyingDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(JIANYING_DIALOG_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(JIANYING_DIALOG_OPEN_EVENT, handleOpen);
  }, []);

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="flex-row items-center gap-2.5 border-b px-4 py-3 pr-12">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Scissors className="size-4" aria-hidden="true" />
            </span>
            <DialogTitle className="text-sm">剪映</DialogTitle>
          </DialogHeader>
          <JianyingPanel />
        </DialogContent>
      </Dialog>
    </>
  );
}
