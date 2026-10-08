import { useEffect, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BaiduNetdiskPanel } from "@/pages/baidu-netdisk/window";

const openDialogEventName = "baidu-netdisk:dialog:open";

export function openBaiduNetdiskDialog() {
  window.dispatchEvent(new Event(openDialogEventName));
}

export function BaiduNetdiskDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);

    window.addEventListener(openDialogEventName, handleOpen);
    return () => window.removeEventListener(openDialogEventName, handleOpen);
  }, []);

  return (
    <>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="flex-row items-center gap-2.5 border-b px-4 py-3 pr-12">
            <img
              src={`${import.meta.env.BASE_URL}baidu-netdisk.svg`}
              alt=""
              className="size-5 shrink-0"
            />
            <div className="grid gap-0.5">
              <DialogTitle className="text-sm">百度网盘连接管理</DialogTitle>
            </div>
          </DialogHeader>
          <BaiduNetdiskPanel />
        </DialogContent>
      </Dialog>
    </>
  );
}
